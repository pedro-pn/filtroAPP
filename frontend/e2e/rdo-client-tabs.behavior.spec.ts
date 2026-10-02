import { expect, test } from '@playwright/test';

const user = {
  id: 'client-tabs-test', username: '11222333000144', name: 'Cliente Exemplo',
  email: 'financeiro.operacional.nome.extenso@clienteexemplo.com.br', role: 'CLIENT', accountType: 'CLIENT',
  moduleRoles: ['rdo:client'], isActive: true,
  privacyPolicyVersion: 'client_account_privacy_v1', privacyPolicyRequired: false
};

const projects = [
  { id: 'project-one', code: '5917', name: 'Ilha Solteira', clientName: user.name, clientCnpj: user.username, isActive: true, surveys: [] },
  { id: 'project-two', code: '5918', name: 'Ventura', clientName: user.name, clientCnpj: user.username, isActive: true, surveys: [] }
];

const reports = [
  { id: 'rdo-one', projectId: 'project-one', reportType: 'RDO', status: 'SIGNED', sequenceNumber: 1, reportDate: '2026-10-01', project: projects[0] },
  { id: 'rcpu-one', projectId: 'project-one', reportType: 'RCPU', status: 'APPROVED', sequenceNumber: 1, reportDate: '2026-10-01', project: projects[0] },
  { id: 'rdo-two', projectId: 'project-two', reportType: 'RDO', status: 'SIGNED', sequenceNumber: 1, reportDate: '2026-10-01', project: projects[1] }
];

test('cliente vê projetos no menu e somente tipos existentes na barra inferior', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem('filtrovali-react-token', 'synthetic-client-token');
    localStorage.setItem('filtrovali-tutorial-done:financeiro.operacional.nome.extenso@clienteexemplo.com.br', '1');
  });
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith('/api/')) return route.continue();
    let body: unknown = {};
    if (path === '/api/auth/me') body = { user };
    else if (path === '/api/rdo/projects') body = projects;
    else if (path === '/api/rdo/reports/client-tabs') body = [
      { projectId: 'project-one', reportType: 'RDO', available: true },
      { projectId: 'project-one', reportType: 'RTP', available: false },
      { projectId: 'project-one', reportType: 'RLQ', available: false },
      { projectId: 'project-one', reportType: 'RCPU', available: true },
      { projectId: 'project-one', reportType: 'RLM', available: false },
      { projectId: 'project-two', reportType: 'RDO', available: true }
    ];
    else if (path === '/api/rdo/reports') body = {
      items: reports,
      pagination: { page: 1, pageSize: 30, total: reports.length, totalPages: 1 },
      groups: reports.map(report => ({ projectId: report.projectId, reportType: report.reportType, total: 1 }))
    };
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.goto('/rdo/cliente');
  const bottom = page.getByRole('navigation', { name: 'Áreas de Relatórios' });
  await expect(bottom).toBeVisible();
  await expect(page.locator('.rdo-client-report-tabs')).toBeHidden();
  await expect(bottom.getByRole('link', { name: 'RDO' })).toBeVisible();
  await expect(bottom.getByRole('link', { name: /RTP, bloqueado/ })).toHaveClass(/is-locked/);
  await expect(bottom.getByRole('link', { name: 'RLI' })).toHaveCount(0);
  await bottom.getByRole('link', { name: /RTP, bloqueado/ }).click();
  await expect(page.getByText('Relatório bloqueado devido a assinaturas pendentes.')).toBeVisible();

  await bottom.getByRole('button', { name: /Mais áreas/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Áreas de Relatórios' });
  await expect(sheet.getByRole('link', { name: 'RCPU' })).toBeVisible();
  await expect(sheet.getByRole('link', { name: 'RLI' })).toHaveCount(0);
  await sheet.getByRole('link', { name: 'RCPU' }).click();
  await expect(page.locator('.rdo-client-report-section .rtype-badge')).toHaveText('RCPU');

  await page.getByRole('button', { name: 'Abrir menu' }).click();
  const drawer = page.getByRole('dialog', { name: 'Menu' });
  await expect(drawer.getByRole('link', { name: /5917 - Ilha Solteira/ })).toBeVisible();
  await drawer.getByRole('link', { name: /5918 - Ventura/ }).click();
  await expect(page).toHaveURL(/projeto=project-two/);
  await expect(bottom.getByRole('link', { name: 'RDO' })).toBeVisible();
  await expect(bottom.getByRole('button', { name: /Mais áreas/ })).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 720 });
  await expect.poll(() => page.locator('.client-welcome-card').evaluate(card => {
    const cardRight = card.getBoundingClientRect().right;
    return [...card.querySelectorAll('.client-welcome-meta > span')]
      .every(span => span.getBoundingClientRect().right <= cardRight + 1 && span.scrollWidth <= span.clientWidth + 1);
  })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
