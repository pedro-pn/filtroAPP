import { expect, test, type Page } from '@playwright/test';

const admin = {
  id: 'privacy-admin', username: 'privacy-admin', name: 'Gestora de Privacidade',
  email: 'privacy@example.com', role: 'MANAGER', accountType: 'ADMIN',
  moduleRoles: ['privacy:admin'], reportEmissionPermissions: [], isActive: true
};

const openRequest = {
  id: 'request-1', protocol: 'LGPD-2026-001', type: 'ACCESS', status: 'OPEN',
  createdAt: '2026-09-30T12:00:00.000Z', updatedAt: '2026-09-30T12:00:00.000Z',
  name: 'Marina Operações', email: 'marina@example.com', identifier: '123.456.789-00',
  details: 'Solicito acesso aos meus dados pessoais.', source: 'PUBLIC',
  identityVerifiedAt: null, identityVerificationEvidence: null,
  responseNotes: null, responseEmailStatus: null, completionNotes: null,
  responseAttempts: []
};

const reviewedRequest = {
  ...openRequest, id: 'request-2', protocol: 'LGPD-2026-002',
  type: 'CORRECTION', status: 'IN_REVIEW', name: 'Rafael Silva',
  email: 'rafael@example.com', identityVerifiedAt: '2026-09-30T13:00:00.000Z'
};

async function useFixtures(page: Page, theme: 'light' | 'dark' = 'light') {
  await page.addInitScript(selectedTheme => {
    localStorage.setItem('filtrovali-react-token', 'synthetic-privacy-token');
    localStorage.setItem('filtrovali-theme', selectedTheme);
  }, theme);
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/')) return route.fallback();
    let body: unknown = {};
    if (url.pathname === '/api/auth/me') body = { user: admin };
    else if (url.pathname === '/api/privacy/requests' && route.request().method() === 'GET') {
      const status = url.searchParams.get('status') || 'OPEN';
      const requests = status === 'OPEN' ? [openRequest] : status === 'IN_REVIEW' ? [reviewedRequest] : status === 'ALL' ? [openRequest, reviewedRequest] : [];
      body = { requests, pagination: { page: 1, pageSize: 25, total: requests.length, totalPages: 1 }, counts: { open: 1, inReview: 1, pending: 2 } };
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

for (const viewport of [
  { name: 'mobile', width: 390, height: 844, theme: 'light' },
  { name: 'tablet', width: 768, height: 1024, theme: 'dark' },
  { name: 'desktop', width: 1280, height: 900, theme: 'light' }
] as const) {
  test(`Privacidade administrativa e pública · ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await useFixtures(page, viewport.theme);

    await page.goto('/privacidade/solicitacoes');
    await expect(page.getByRole('heading', { name: 'Solicitações LGPD' })).toBeVisible();
    await expect(page.getByText('LGPD-2026-001')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await expect(page).toHaveScreenshot(`privacy-admin-${viewport.name}.png`, { fullPage: true });
    await page.locator('.privacy-request-card summary').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Solicito acesso aos meus dados pessoais.')).toBeVisible();
    if (viewport.name === 'mobile') await expect(page).toHaveScreenshot('privacy-admin-expanded-mobile.png', { fullPage: true });
    await page.getByRole('button', { name: 'Em análise' }).click();
    await expect(page.getByText('LGPD-2026-002')).toBeVisible();
    await page.getByRole('searchbox', { name: 'Buscar em solicitações LGPD' }).fill('sem resultado');
    await expect(page.getByText('Nenhuma solicitação encontrada.')).toBeVisible();

    await page.goto('/privacidade');
    await expect(page.getByRole('heading', { name: 'FiltroAPP' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Dados tratados' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    if (viewport.name !== 'tablet') await expect(page).toHaveScreenshot(`privacy-policy-${viewport.name}.png`, { fullPage: true });

    await page.getByRole('link', { name: 'Exercer direitos LGPD' }).click();
    await expect(page.getByRole('heading', { name: 'Solicitação LGPD' })).toBeVisible();
    await expect(page.getByLabel('Tipo de solicitação')).toBeVisible();
    if (viewport.theme === 'dark') {
      const linkColor = await page.getByRole('link', { name: 'Voltar à política' }).evaluate(element => getComputedStyle(element).color);
      const titleColor = await page.locator('.privacy-public-hero .section-title').evaluate(element => getComputedStyle(element).color);
      expect(linkColor).toBe(titleColor);
    }
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await expect(page).toHaveScreenshot(`privacy-rights-${viewport.name}.png`, { fullPage: true });
  });
}

test('Solicitação LGPD: identidade, resposta e evidência de conclusão preservam a API', async ({ page }) => {
  await useFixtures(page);
  let request: Record<string, unknown> = { ...openRequest };
  let identityPayload: Record<string, unknown> | null = null;
  let responsePayload: Record<string, unknown> | null = null;
  let statusPayload: Record<string, unknown> | null = null;
  await page.route('**/api/privacy/requests**', route => {
    if (new URL(route.request().url()).pathname !== '/api/privacy/requests' || route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      requests: [request], pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 }, counts: { open: 1, inReview: 0, pending: 1 }
    }) });
  });
  await page.route('**/api/privacy/requests/request-1/identity-verification', async route => {
    identityPayload = route.request().postDataJSON() as Record<string, unknown>;
    request = { ...request, identityVerifiedAt: '2026-10-01T12:00:00.000Z', identityVerificationEvidence: String(identityPayload.evidence) };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ request }) });
  });
  await page.route('**/api/privacy/requests/request-1/response', async route => {
    responsePayload = route.request().postDataJSON() as Record<string, unknown>;
    request = { ...request, responseNotes: String(responsePayload.message), responseEmailStatus: 'FAILED' };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ request }) });
  });
  await page.route('**/api/privacy/requests/request-1/status', async route => {
    statusPayload = route.request().postDataJSON() as Record<string, unknown>;
    request = { ...request, status: 'COMPLETED', completionNotes: String(statusPayload.offlineResponseEvidence) };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ request }) });
  });

  await page.goto('/privacidade/solicitacoes');
  await page.locator('.privacy-request-card summary').click();
  await page.getByLabel('Resposta ao titular').fill('Resposta final ao pedido de acesso.');
  await page.getByRole('button', { name: 'Enviar resposta' }).click();
  await expect(page.getByText('Verifique a identidade do titular antes de enviar resposta final ou concluir esta solicitação.')).toBeVisible();

  await page.getByRole('button', { name: 'Registrar verificação' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Registrar verificação de identidade');
  await dialog.getByRole('button', { name: 'Salvar evidência' }).click();
  await expect(dialog.getByText('Informe uma evidência de verificação com pelo menos 10 caracteres.')).toBeVisible();
  await dialog.getByLabel('Evidência').fill('Documento conferido pessoalmente.');
  await dialog.getByRole('button', { name: 'Salvar evidência' }).click();
  await expect.poll(() => identityPayload).toEqual({ evidence: 'Documento conferido pessoalmente.' });
  await expect(dialog).toHaveCount(0);

  await page.getByRole('button', { name: 'Enviar resposta' }).click();
  await expect.poll(() => responsePayload).toEqual({ message: 'Resposta final ao pedido de acesso.', resolved: false, responseKind: 'SUBSTANTIVE' });
  await page.getByRole('button', { name: 'Marcar como resolvida', exact: true }).click();
  await expect(dialog).toContainText('Evidência de atendimento');
  await dialog.getByLabel('Evidência').fill('Atendimento externo confirmado por telefone.');
  await dialog.getByRole('button', { name: 'Salvar evidência' }).click();
  await expect.poll(() => statusPayload).toEqual({ resolved: true, offlineResponseEvidence: 'Atendimento externo confirmado por telefone.' });
});

test('Canal público preserva protocolo e dados enviados', async ({ page }) => {
  let submitted: Record<string, unknown> | null = null;
  await page.route('**/api/privacy/requests', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ request: { protocol: 'LGPD-2026-008' } }) });
  });

  await page.goto('/privacidade');
  await expect(page.getByRole('heading', { name: 'FiltroAPP' })).toBeVisible();
  await page.getByRole('link', { name: 'Exercer direitos LGPD' }).click();
  await page.getByLabel('Tipo de solicitação').selectOption('CORRECTION');
  await page.getByLabel('Nome completo').fill('Marina Operações');
  await page.getByLabel('E-mail de contato').fill('marina@example.com');
  await page.getByLabel('CPF, CNPJ, usuário ou projeto relacionado').fill('5917');
  await page.getByLabel('Detalhes da solicitação').fill('Corrigir cadastro do meu projeto.');
  await page.getByRole('button', { name: 'Registrar solicitação' }).click();
  await expect.poll(() => submitted).toEqual({
    type: 'CORRECTION', name: 'Marina Operações', email: 'marina@example.com',
    identifier: '5917', details: 'Corrigir cadastro do meu projeto.'
  });
  await expect(page.getByText('LGPD-2026-008')).toBeVisible();
});

test('Conta sem permissão administrativa não acessa solicitações LGPD', async ({ page }) => {
  await useFixtures(page);
  await page.route('**/api/auth/me', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ user: { ...admin, accountType: 'INTERNAL', moduleRoles: [] } })
  }));
  await page.goto('/privacidade/solicitacoes');
  await expect.poll(() => new URL(page.url()).pathname).not.toBe('/privacidade/solicitacoes');
});
