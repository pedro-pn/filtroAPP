import { expect, type Page } from '@playwright/test';

import { waitForLoginCode } from './mailbox';
import type { E2eAccount } from './seed';

// Preferências de interface (tutoriais e novidades) já vistas: não são dados de
// sessão. O login em si é sempre feito pela tela, com a API real.
export async function skipOnboarding(page: Page, username: string) {
  await page.addInitScript(name => {
    localStorage.setItem(`filtrovali-tutorial-done:${name}`, '1');
    localStorage.setItem(`filtrovali:rdo-dds-novelty:v2:${name}`, '1');
  }, username);
}

async function submitPassword(page: Page, account: E2eAccount) {
  await page.goto('/login');
  await page.locator('#login-username-control').fill(account.username);
  await page.locator('#login-password-control').fill(account.password);
  const loginResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/auth/login' && response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  return loginResponse;
}

// Login com senha e, quando o servidor pede, o código de 6 dígitos do e-mail.
export async function loginThroughUi(page: Page, account: E2eAccount, { rememberDevice = false } = {}) {
  const since = new Date();
  const response = await submitPassword(page, account);
  expect(response.status(), 'login com a senha correta').toBe(200);
  const body = await response.json();
  if (body.twoFactorRequired) {
    const code = await waitForLoginCode(account.email, since);
    await page.locator('#login-two-factor-code-control').fill(code);
    const remember = page.getByRole('checkbox', { name: /Lembrar este navegador/ });
    if (rememberDevice) await remember.check();
    else await remember.uncheck();
    const verify = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/2fa/verify');
    await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
    expect((await verify).status(), 'verificação do código').toBe(200);
  }
  await expect(page).not.toHaveURL(/\/login(\?|$)/);
  return { twoFactorRequired: Boolean(body.twoFactorRequired) };
}

export { submitPassword };
