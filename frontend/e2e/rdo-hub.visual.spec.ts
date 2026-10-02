import { expect, test } from '@playwright/test';

const viewports = [
  { name: 'mobile', width: 360, height: 800 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 900 }
] as const;

const user = {
  id: 'visual-hub-user',
  username: 'visual',
  name: 'Teste Visual',
  email: 'visual@example.com',
  role: 'MANAGER',
  accountType: 'ADMIN',
  moduleRoles: ['rdo:manager', 'acompanhamento:manager', 'efetivo:manager'],
  reportEmissionPermissions: ['SITE_RDO', 'MAINTENANCE', 'PRODUCTION'],
  isActive: true
};

for (const viewport of viewports) {
  for (const theme of ['light', 'dark'] as const) {
    test(`Hub autenticado · ${viewport.name} · ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.clock.setFixedTime(new Date('2026-10-01T15:00:00.000Z'));
      await page.addInitScript(({ selectedTheme, userId }) => {
        localStorage.setItem('filtrovali-react-token', 'synthetic-visual-token');
        localStorage.setItem('filtrovali-theme', selectedTheme);
        localStorage.setItem(`filtrovali:hub-first-login-tutorial:${userId}`, '1');
        localStorage.setItem(`filtrovali:acompanhamento-novelty:${userId}`, '1');
        localStorage.setItem(`filtrovali:efetivo-hub-novelty:v1:${userId}`, '1');
      }, { selectedTheme: theme, userId: user.id });
      await page.route('**/api/auth/me', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user })
      }));

      await page.goto('/modulos');
      const modules = page.locator('.hub-module-grid');
      await expect(modules).toBeVisible();
      await expect(modules.locator('button.hub-module-card')).toHaveCount(5);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('.hub-dashboard__modules').getByRole('heading', { name: 'Módulos' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

      await expect(page).toHaveScreenshot(`${viewport.name}-${theme}.png`, { fullPage: true });

      if (viewport.name === 'mobile' && theme === 'light') {
        const firstModule = modules.locator('button.hub-module-card').first();
        await firstModule.focus();
        await expect(firstModule).toBeFocused();
        await firstModule.press('Enter');
        await expect(page).not.toHaveURL(/\/modulos$/);
      }
    });
  }
}
