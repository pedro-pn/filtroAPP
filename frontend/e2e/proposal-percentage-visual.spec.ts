import { expect, test } from '@playwright/test';

for (const viewport of [
  { name: 'mobile-light', width: 390, height: 844, dark: false },
  { name: 'desktop-dark', width: 1280, height: 900, dark: true }
] as const) {
  test(`Percentual da proposta segue o visual do cronograma · ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/test/browser/proposal-percentage.html');
    if (viewport.dark) await page.evaluate(() => document.documentElement.classList.add('dark'));
    const details = page.locator('.acp-schedule-ds__proposal-details');
    await expect(details).not.toHaveAttribute('open');
    await details.locator('summary').click();
    await expect(details.getByLabel('Percentual da proposta considerado (%)')).toHaveValue('70');
    await expect(details.getByText('Considerado (70%)').first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await expect(page.locator('.acp-schedule-ds')).toHaveScreenshot(`proposal-percentage-${viewport.name}.png`);
  });
}
