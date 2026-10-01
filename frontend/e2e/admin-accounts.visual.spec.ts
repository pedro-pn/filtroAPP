import { expect, test, type Page } from '@playwright/test';

const viewports = [
  { name: 'mobile-narrow', width: 360, height: 780, theme: 'dark' },
  { name: 'mobile', width: 390, height: 844, theme: 'light' },
  { name: 'tablet', width: 768, height: 1024, theme: 'dark' },
  { name: 'desktop', width: 1280, height: 900, theme: 'light' }
] as const;

const accounts = [
  {
    id: 'admin-1', username: 'administradora', name: 'Ana Administração',
    email: 'ana@example.com', role: 'MANAGER', accountType: 'ADMIN',
    moduleRoles: [], reportEmissionPermissions: [], isActive: true
  },
  {
    id: 'internal-1', username: 'marina', name: 'Marina Operações',
    email: 'marina@example.com', role: 'COLLABORATOR', accountType: 'INTERNAL',
    moduleRoles: ['rdo:collaborator', 'equipamentos:viewer'],
    reportEmissionPermissions: ['SITE_RDO'], isActive: true,
    collaboratorId: null
  },
  {
    id: 'client-1', username: 'cliente', name: 'Cliente Ventura',
    email: 'cliente@example.com', role: 'CLIENT', accountType: 'CLIENT',
    moduleRoles: ['rdo:client'], reportEmissionPermissions: [], isActive: false,
    linkedProjects: [{ code: '5715', name: 'Ventura' }]
  }
];

async function useAccount(page: Page, accountType: 'ADMIN' | 'INTERNAL', theme: 'light' | 'dark') {
  const user = {
    id: accountType === 'ADMIN' ? 'admin-1' : 'internal-no-access',
    username: accountType === 'ADMIN' ? 'administradora' : 'sem-acesso',
    name: accountType === 'ADMIN' ? 'Ana Administração' : 'Sem Acesso',
    email: 'visual@example.com',
    role: accountType === 'ADMIN' ? 'MANAGER' : 'COLLABORATOR',
    accountType,
    moduleRoles: [],
    reportEmissionPermissions: [],
    isActive: true
  };
  const unexpectedRequests: string[] = [];
  await page.addInitScript(selectedTheme => {
    localStorage.setItem('filtrovali-react-token', 'synthetic-admin-visual-token');
    localStorage.setItem('filtrovali-theme', selectedTheme);
  }, theme);
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith('/api/')) return route.continue();
    if (route.request().method() !== 'GET') {
      unexpectedRequests.push(`${route.request().method()} ${path}`);
      return route.fulfill({ status: 405, body: 'Mutation blocked in visual test' });
    }
    let body: unknown;
    if (path === '/api/auth/me') body = { user };
    else if (path === '/api/admin/accounts') body = accounts;
    else if (path === '/api/rdo/collaborators') body = [];
    else if (path === '/api/admin/accounts/internal-1/impacto') body = {
      assinaturas: { toDelete: 1, toPreserve: 2, finalizing: 0 }
    };
    else {
      unexpectedRequests.push(`GET ${path}`);
      body = {};
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return unexpectedRequests;
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  )).toBeLessThanOrEqual(1);
}

for (const viewport of viewports) {
  test(`Gestão de Contas · ${viewport.name} · ${viewport.theme}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const unexpectedRequests = await useAccount(page, 'ADMIN', viewport.theme);
    await page.goto('/admin/accounts');

    await expect(page.getByRole('heading', { name: 'Gestão de contas' })).toBeVisible();
    await expect(page.locator('.admin-account-card-v2')).toHaveCount(3);
    if (viewport.name === 'tablet') {
      await page.getByRole('button', { name: 'Abrir menu' }).click();
      await expect(page.getByRole('link', { name: /Tokens de API/ })).toBeVisible();
      await page.getByRole('button', { name: 'Fechar menu' }).click();
    } else {
      await expect(page.locator(viewport.name === 'desktop' ? '.fv-app-shell__sidebar' : '.fv-bottom-bar').getByRole('link', { name: /Tokens/ })).toBeVisible();
    }
    await expect(page.locator('html')).toHaveAttribute('data-theme', viewport.theme);
    await expectNoHorizontalOverflow(page);
    await expect(page).toHaveScreenshot(`${viewport.name}-${viewport.theme}-list.png`, { fullPage: true });

    await page.getByRole('button', { name: 'Nova conta' }).click();
    await expect(page.getByRole('heading', { name: 'Nova conta' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => {
      const form = document.getElementById('admin-account-form');
      const topbar = document.querySelector('.fv-topbar');
      return Math.round((form?.getBoundingClientRect().top ?? 0) - (topbar?.getBoundingClientRect().bottom ?? 0));
    })).toBeGreaterThanOrEqual(0);
    await expect(page.getByRole('textbox', { name: 'Usuário' })).toBeVisible();
    await expect.poll(() => page.locator('.admin-account-form__header .fv-button__label').evaluate(label => label.scrollWidth - label.clientWidth)).toBeLessThanOrEqual(1);
    await expectNoHorizontalOverflow(page);
    await expect(page).toHaveScreenshot(`${viewport.name}-${viewport.theme}-form.png`, { fullPage: true });
    await page.locator('.admin-account-form__header').getByRole('button', { name: 'Cancelar' }).click();

    const internalCard = page.locator('.admin-account-card-v2').filter({ hasText: 'Marina Operações' });
    await internalCard.getByRole('button', { name: 'Editar' }).click();
    await expect(page.getByRole('heading', { name: 'Editar conta · Marina Operações' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Nome' })).toHaveValue('Marina Operações');
    await page.locator('.admin-account-form__header').getByRole('button', { name: 'Cancelar' }).click();

    await internalCard.getByRole('button', { name: 'Remover conta de Marina Operações' }).click();
    await expect(page.getByText(/2 documento\(s\) concluído\(s\) serão preservados/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('Excluir conta permanentemente?')).toBeHidden();
    expect(unexpectedRequests).toEqual([]);
  });
}

test('conta sem acesso administrativo retorna ao Hub', async ({ page }) => {
  const unexpectedRequests = await useAccount(page, 'INTERNAL', 'light');
  await page.goto('/admin/accounts');
  await expect(page).toHaveURL(/\/modulos$/);
  await expect(page.getByRole('heading', { name: 'Gestão de contas' })).toHaveCount(0);
  expect(unexpectedRequests).toEqual([]);
});

test('cria, edita e remove uma conta com os contratos de API preservados', async ({ page }) => {
  const unexpectedRequests = await useAccount(page, 'ADMIN', 'light');
  let currentAccounts = [...accounts];
  const submitted: Array<{ method: string; payload?: Record<string, unknown> }> = [];
  await page.route('**/api/admin/accounts', async route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(currentAccounts) });
    }
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    submitted.push({ method: 'POST', payload });
    const created = {
      ...payload,
      id: 'created-1',
      passwordSetup: { delivery: 'manual', url: '/definir-senha?token=synthetic', expiresAt: '2026-10-08T00:00:00.000Z' }
    };
    currentAccounts = [...currentAccounts, created] as typeof accounts;
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(created) });
  });
  await page.route('**/api/admin/accounts/created-1', async route => {
    if (route.request().method() === 'DELETE') {
      submitted.push({ method: 'DELETE' });
      currentAccounts = currentAccounts.filter(account => account.id !== 'created-1');
      return route.fulfill({ status: 204 });
    }
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    submitted.push({ method: 'PUT', payload });
    const updated = { ...currentAccounts.find(account => account.id === 'created-1'), ...payload };
    currentAccounts = currentAccounts.map(account => account.id === 'created-1' ? updated : account) as typeof accounts;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(updated) });
  });
  await page.route('**/api/admin/accounts/created-1/impacto', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ assinaturas: { toDelete: 0, toPreserve: 0, finalizing: 0 } })
  }));

  await page.goto('/admin/accounts');
  await page.getByRole('button', { name: 'Nova conta' }).click();
  await page.getByRole('textbox', { name: 'Usuário' }).fill('nova-conta');
  await page.getByRole('textbox', { name: 'Nome' }).fill('Nova Conta');
  await page.getByRole('textbox', { name: 'E-mail' }).fill('nova@example.com');
  await page.getByRole('checkbox', { name: 'Equipamentos - Visualizador' }).check();
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByRole('heading', { name: 'Link para criar a senha' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Link para compartilhar' })).toHaveValue(/\/definir-senha\?token=synthetic$/);
  await expect(page.locator('.admin-account-card-v2')).toHaveCount(4);
  expect(submitted[0]).toMatchObject({
    method: 'POST',
    payload: {
      username: 'nova-conta', name: 'Nova Conta', email: 'nova@example.com',
      accountType: 'INTERNAL', isActive: true,
      moduleRoles: ['equipamentos:viewer']
    }
  });

  const createdCard = page.locator('.admin-account-card-v2').filter({ hasText: 'Nova Conta' });
  await createdCard.getByRole('button', { name: 'Editar' }).click();
  await page.getByRole('textbox', { name: 'Nome' }).fill('Nova Conta Editada');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.locator('.admin-account-card-v2').filter({ hasText: 'Nova Conta Editada' })).toBeVisible();
  expect(submitted[1]).toMatchObject({ method: 'PUT', payload: { name: 'Nova Conta Editada', username: 'nova-conta' } });

  await page.locator('.admin-account-card-v2').filter({ hasText: 'Nova Conta Editada' })
    .getByRole('button', { name: 'Desativar' }).click();
  await expect(page.locator('.admin-account-card-v2').filter({ hasText: 'Nova Conta Editada' }).getByText('Inativo')).toBeVisible();
  expect(submitted[2]).toMatchObject({ method: 'PUT', payload: { isActive: false } });

  await page.locator('.admin-account-card-v2').filter({ hasText: 'Nova Conta Editada' })
    .getByRole('button', { name: 'Remover conta de Nova Conta Editada' }).click();
  await page.getByRole('textbox', { name: /Digite nova-conta para confirmar/ }).fill('nova-conta');
  await page.getByRole('button', { name: 'Excluir conta' }).click();
  await expect(page.locator('.admin-account-card-v2')).toHaveCount(3);
  expect(submitted[3]).toEqual({ method: 'DELETE' });
  expect(unexpectedRequests).toEqual([]);
});

test('filtros e estado vazio mantêm o acesso à criação de contas', async ({ page }) => {
  const unexpectedRequests = await useAccount(page, 'ADMIN', 'light');
  await page.goto('/admin/accounts');
  await page.getByRole('combobox', { name: 'Tipo' }).selectOption('CLIENT');
  await expect(page.locator('.admin-account-card-v2')).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Buscar' }).fill('sem resultados');
  await expect(page.getByText('Nenhuma conta encontrada.')).toBeVisible();
  await page.getByRole('button', { name: 'Limpar filtros' }).click();
  await expect(page.locator('.admin-account-card-v2')).toHaveCount(3);
  await page.getByRole('button', { name: 'Nova conta' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Nova conta' })).toBeVisible();
  expect(unexpectedRequests).toEqual([]);
});

test('carregamento, lista sem contas e falha usam estados claros', async ({ page }) => {
  const unexpectedRequests = await useAccount(page, 'ADMIN', 'light');
  let shouldFail = false;
  await page.route('**/api/admin/accounts', async route => {
    await new Promise(resolve => setTimeout(resolve, 500));
    return route.fulfill(shouldFail
      ? { status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Falha sintética' }) }
      : { status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.goto('/admin/accounts');
  await expect(page.getByText('Carregando contas…')).toBeVisible();
  await expect(page.getByText('Nenhuma conta cadastrada.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nova conta' }).first()).toBeVisible();

  shouldFail = true;
  await page.reload();
  await expect(page.getByText('Não foi possível carregar as contas.')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Tentar novamente' })).toBeVisible();
  expect(unexpectedRequests).toEqual([]);
});
