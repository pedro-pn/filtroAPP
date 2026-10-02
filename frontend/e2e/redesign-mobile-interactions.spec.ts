import { expect, test } from '@playwright/test';
import { useValidationAccount, validationFixture } from './redesign-audit-support';

test('mobile: cabeçalho, comandos de rolagem e gesto de fechar Mais', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const page = await context.newPage();
  try {
    await useValidationAccount(page, 'admin', 'dark');
    await page.goto(`/acompanhamento?section=projetos&project=${validationFixture.project.id}`);
    await expect(page.getByRole('button', { name: 'Voltar', exact: true }).first()).toBeVisible();
    await expect(page.locator('.fv-brand-loading:visible')).toHaveCount(0);
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect(page.locator('.fv-app-shell')).toHaveClass(/is-mobile-header-hidden/);
    await page.evaluate(() => window.scrollTo(0, 300));
    await expect(page.locator('.fv-app-shell')).not.toHaveClass(/is-mobile-header-hidden/);
    await page.getByRole('button', { name: 'Ir para o final' }).tap();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - innerHeight - scrollY)).toBeLessThan(3);
    // Commands intentionally hide the controls briefly; another scroll reveals them.
    await page.waitForTimeout(1600);
    await page.evaluate(() => window.scrollBy(0, -40));
    await page.getByRole('button', { name: 'Ir para o início' }).tap();
    await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(3);
    await page.goto('/efetivo?section=visao-geral');
    await page.getByRole('button', { name: /^Mais áreas/ }).tap();
    await expect(page.locator('.fv-bottom-bar__sheet-backdrop')).toHaveClass(/is-open/);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    // Exercise the touch fallback on the scrollable sheet body (at its top).
    await page.locator('.fv-bottom-bar__sheet .fv-modal__body').evaluate(element => {
      element.scrollTop = 0;
      // WebKit does not expose a constructible Touch in automation. Dispatch the
      // handler's event shape; actual button taps above still use native touch.
      const dispatch = (name: string, y?: number) => {
        const event = new Event(name, { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'touches', { value: y === undefined ? [] : [{ clientY: y }] });
        element.dispatchEvent(event);
      };
      dispatch('touchstart', 400);
      dispatch('touchmove', 560);
      dispatch('touchend');
    });
    await expect(page.locator('.fv-bottom-bar__sheet')).toHaveCount(0);
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  } finally { await context.close(); }
});
