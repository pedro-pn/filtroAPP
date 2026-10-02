import { expect, test } from '@playwright/test';

for (const viewport of [
  { name: 'mobile-light', width: 390, height: 844, dark: false },
  { name: 'desktop-dark', width: 1280, height: 900, dark: true }
] as const) {
  test(`Meta semanal usa o visual atual · ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.clock.setFixedTime(new Date('2026-10-01T12:00:00Z'));
    await page.goto('/test/browser/weekly-progress.html');
    if (viewport.dark) await page.evaluate(() => document.documentElement.classList.add('dark'));
    const panel = page.getByRole('region', { name: 'Metas semanais de avanço', exact: true });
    const summary = page.locator('[data-acp-weekly-current]');
    await expect(panel.getByText('Meta semanal de avanço')).toBeVisible();
    await expect(summary).toContainText('Sem meta');
    await panel.getByRole('button', { name: 'Definir meta', exact: true }).click();
    if (viewport.width >= 1024) {
      const weekTop = await panel.locator('.mission-weekly-progress-form input[type="date"]').evaluate(element => element.getBoundingClientRect().top);
      const plannedTop = await panel.locator('.mission-weekly-progress-form input[type="number"]').evaluate(element => element.getBoundingClientRect().top);
      expect(Math.abs(weekTop - plannedTop)).toBeLessThanOrEqual(1);
    }
    await panel.getByLabel('Avanço previsto para a semana (p.p.)').fill('10');
    await panel.getByRole('button', { name: 'Salvar meta' }).click();
    await expect(panel.locator('.mission-weekly-progress-current .mission-weekly-status')).toHaveText('Dentro da meta');
    await expect(summary).toContainText('10 / 10 p.p.');
    await expect(summary.getByRole('progressbar', { name: 'Avanço da meta semanal' })).toHaveAttribute('aria-valuenow', '10');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await expect.poll(() => panel.locator('.mission-weekly-progress-table').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await expect(page).toHaveScreenshot(`weekly-progress-${viewport.name}.png`, { fullPage: true });
  });
}
