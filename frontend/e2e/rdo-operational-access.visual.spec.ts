import { expect, test, type Page } from '@playwright/test';

type Permission = 'SITE_RDO' | 'MAINTENANCE' | 'PRODUCTION';

const viewports = [
  { name: 'mobile', width: 360, height: 800, theme: 'light' },
  { name: 'tablet', width: 768, height: 1024, theme: 'dark' },
  { name: 'desktop', width: 1280, height: 900, theme: 'light' }
] as const;

async function useSyntheticAccount(page: Page, permissions: Permission[], theme: 'light' | 'dark' = 'light') {
  const unexpectedRequests: string[] = [];
  const user = {
    id: `operational-visual-${permissions.join('-') || 'none'}`,
    username: 'operational-visual',
    name: 'Teste Operacional',
    email: 'operational@example.com',
    role: 'COLLABORATOR',
    accountType: 'INTERNAL',
    moduleRoles: [],
    reportEmissionPermissions: permissions,
    isActive: true
  };

  await page.addInitScript(({ id, theme }) => {
    localStorage.setItem('filtrovali-react-token', 'synthetic-visual-token');
    localStorage.setItem('filtrovali-theme', theme);
    localStorage.setItem(`filtrovali:operational-module-tutorial:v1:${id}`, '1');
  }, { id: user.id, theme });

  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith('/api/')) return route.continue();
    if (route.request().method() !== 'GET') {
      unexpectedRequests.push(`${route.request().method()} ${path}`);
      return route.fulfill({ status: 405, body: 'Mutation blocked in visual test' });
    }
    let body: unknown = {};
    if (path === '/api/auth/me') body = { user };
    else if (path === '/api/rdo/operational-reports/context') body = {
      permissions,
      canReviewMaintenance: false,
      canReviewProduction: false,
      maintenanceSupervisor: { id: null, name: null, valid: false, reason: null },
      projects: { maintenance: null, production: null },
      collaborators: [],
      equipment: []
    };
    else if (path === '/api/rdo/operational-reports') body = { items: [], total: 0, page: 1, pageSize: 100 };
    else if (path === '/api/rdo/operational-reports/maintenance') body = { items: [], total: 0, page: 1, pageSize: 100 };
    else if (path === '/api/rdo/operational-reports/maintenance/schedule') body = {
      items: [],
      categories: [],
      summary: { OVERDUE: 0, DUE_TODAY: 0, UPCOMING: 0, NO_HISTORY: 0, UNCONFIGURED: 0, total: 0 },
      pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
      referenceDate: '2026-10-01'
    };
    else unexpectedRequests.push(`GET ${path}`);
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return unexpectedRequests;
}

function expectNoHorizontalOverflow(page: Page) {
  return expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  )).toBeLessThanOrEqual(1);
}

for (const viewport of viewports) {
  for (const permission of ['MAINTENANCE', 'PRODUCTION'] as const) {
    test(`${permission} · ${viewport.name} · abas e formulário autorizados`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.clock.setFixedTime(new Date('2026-10-01T15:00:00.000Z'));
      const unexpectedRequests = await useSyntheticAccount(page, [permission], viewport.theme);
      await page.goto('/manutencao-producao?tab=programacao-manutencao');

      const expectedTab = permission === 'MAINTENANCE' ? 'programacao-manutencao' : 'producao';
      await expect(page).toHaveURL(new RegExp(`tab=${expectedTab}`));
      if (viewport.name === 'tablet') {
        const tabs = page.getByRole('tablist', { name: 'Áreas de manutenção e produção' });
        await expect(tabs).toBeVisible();
        await expect(tabs.getByRole('tab')).toHaveCount(permission === 'MAINTENANCE' ? 3 : 1);
        await expect(tabs.getByRole('tab', { name: permission === 'MAINTENANCE' ? 'Programação' : 'Produção' })).toHaveAttribute('aria-selected', 'true');
      } else if (viewport.name === 'mobile' && permission === 'MAINTENANCE') {
        await expect(page.getByRole('navigation', { name: 'Áreas de Manutenção e produção' })).toBeVisible();
      }
      const maintenanceLink = page.locator('a[href="/manutencao-producao?tab=manutencao"]:visible');
      if (viewport.name !== 'tablet') {
        await expect(maintenanceLink).toHaveCount(permission === 'MAINTENANCE' ? 1 : 0);
      }
      await expectNoHorizontalOverflow(page);

      if (permission === 'MAINTENANCE') {
        if (viewport.name === 'tablet') {
          await page.getByRole('tablist', { name: 'Áreas de manutenção e produção' }).getByRole('tab', { name: 'Manutenção', exact: true }).click();
        } else {
          await maintenanceLink.click();
        }
      }
      await expect(page.getByText('Nenhum relatório encontrado.')).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expect(page).toHaveScreenshot(`${permission.toLowerCase()}-${viewport.name}.png`, { fullPage: true });

      const create = page.locator('[data-operational-new-report]');
      await create.focus();
      await expect(create).toBeFocused();
      await create.press('Enter');
      await expect(page).toHaveURL(new RegExp(`tipo=${permission === 'MAINTENANCE' ? 'manutencao' : 'producao'}`));
      await expect(page.getByRole('heading', { name: permission === 'MAINTENANCE' ? 'RDO de manutenção' : 'RDO de produção' })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect(unexpectedRequests).toEqual([]);
    });
  }
}

test('Emissão sem permissão mostra saída clara e conta sem módulo retorna ao Hub', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const unexpectedRequests = await useSyntheticAccount(page, ['SITE_RDO']);
  await page.goto('/rdo/relatorio/novo?tipo=manutencao');
  await expect(page.getByText('Emissão não autorizada')).toBeVisible();
  await expect(page.getByText('Sua conta não possui a permissão necessária para este relatório.')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Voltar aos módulos' }).click();
  await expect(page).toHaveURL(/\/modulos$/);
  await page.goto('/manutencao-producao?tab=producao');
  await expect(page).toHaveURL(/\/modulos$/);
  expect(unexpectedRequests).toEqual([]);
});
