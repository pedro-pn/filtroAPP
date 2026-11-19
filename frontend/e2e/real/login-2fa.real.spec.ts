import { expect, test } from '@playwright/test';

import { loginThroughUi, skipOnboarding, submitPassword } from './support/login';
import { clearMailbox, waitForLoginCode } from './support/mailbox';
import { e2eSeed } from './support/seed';

// Jornada 1 (spec 040): ADMIN entra com senha + código por e-mail (2FA, pilar 4.1).
// Contrato real: POST /api/auth/login → e-mail via SMTP → POST /api/auth/2fa/verify.
test('ADMIN só entra depois do código do e-mail; código errado é recusado; navegador lembrado dispensa o código', async ({ page }) => {
  const { admin } = e2eSeed().accounts;
  await clearMailbox();
  await skipOnboarding(page, admin.username);

  const since = new Date();
  const first = await submitPassword(page, admin);
  expect(first.status()).toBe(200);
  const challenge = await first.json();
  expect(challenge).toMatchObject({ twoFactorRequired: true });
  expect(challenge.token, 'nenhuma sessão antes do código').toBeUndefined();
  await expect(page.locator('#login-two-factor-code-control')).toBeVisible();
  const code = await waitForLoginCode(admin.email, since);

  // Código errado: recusado pela API real e a tela continua pedindo o código.
  const wrong = code === '000000' ? '111111' : '000000';
  await page.locator('#login-two-factor-code-control').fill(wrong);
  const rejected = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/2fa/verify');
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  expect((await rejected).status()).toBeGreaterThanOrEqual(400);
  await expect(page).toHaveURL(/\/login(\?|$)/);
  await expect(page.locator('#login-two-factor-code-control')).toBeVisible();

  // Código certo + "Lembrar este navegador".
  await page.locator('#login-two-factor-code-control').fill(code);
  await page.getByRole('checkbox', { name: /Lembrar este navegador/ }).check();
  const accepted = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/2fa/verify');
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  expect((await accepted).status()).toBe(200);
  await expect(page).not.toHaveURL(/\/login(\?|$)/);

  // Sair e entrar de novo no mesmo navegador: o servidor não pede código.
  await page.goto('/rdo/gestor');
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page).toHaveURL(/\/login(\?|$)/);
  const again = await loginThroughUi(page, admin);
  expect(again.twoFactorRequired, 'navegador lembrado não pede o código').toBe(false);
});
