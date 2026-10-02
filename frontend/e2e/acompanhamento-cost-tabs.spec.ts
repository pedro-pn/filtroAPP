import { expect, test } from '@playwright/test';

const account = {
  id: 'cost-admin', username: 'cost-admin', name: 'Gestora de custos',
  email: 'cost@example.com', role: 'MANAGER', accountType: 'ADMIN',
  moduleRoles: ['acompanhamento:manager'], reportEmissionPermissions: [], isActive: true
};

for (const viewport of [
  { name: 'mobile-light', width: 390, height: 844, theme: 'light' },
  { name: 'desktop-dark', width: 1280, height: 900, theme: 'dark' }
] as const) {
  test(`Abas de Custo seguem o padrão segmentado · ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.addInitScript(theme => {
      localStorage.setItem('filtrovali-react-token', 'synthetic-cost-token');
      localStorage.setItem('filtrovali-theme', theme);
    }, viewport.theme);
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (!path.startsWith('/api/')) return route.fallback();
      const body = path === '/api/auth/me' ? { user: account }
        : path === '/api/acompanhamento/custo/config' ? { epiAnnualCost: 0, examsTrainingAnnualCost: 0, offshoreExamsTrainingAnnualCost: 0 }
          : path === '/api/acompanhamento/custo/perfis' || path === '/api/acompanhamento/custo/cargos' ? [] : {};
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    await page.goto('/acompanhamento?section=custo');
    const tabs = page.getByRole('tablist', { name: 'Seções de custo' });
    await expect(tabs.getByRole('tab')).toHaveCount(6);
    await expect(tabs.getByRole('tab', { name: 'Cargos' })).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await expect(page).toHaveScreenshot(`acompanhamento-cost-tabs-${viewport.name}.png`, { fullPage: true });
    await tabs.getByRole('tab', { name: 'Simulador' }).click();
    await expect(tabs.getByRole('tab', { name: 'Simulador' })).toHaveAttribute('aria-selected', 'true');
  });
}
