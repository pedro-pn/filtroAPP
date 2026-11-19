import { expect, test } from '@playwright/test';

import { loginThroughUi, skipOnboarding } from './support/login';
import { e2eSeed } from './support/seed';

// Jornada 4 (spec 040, pilar 5.1): colaborador abre pela URL um RDO de um
// projeto em que não participa e uma tela de gestão.
test('colaborador recebe 403 da API real para RDO de outro projeto e não entra na gestão', async ({ page }) => {
  const seed = e2eSeed();
  const { collaborator } = seed.accounts;
  await skipOnboarding(page, collaborator.username);
  const login = await loginThroughUi(page, collaborator);
  expect(login.twoFactorRequired, 'conta interna sem 2FA ativado').toBe(false);

  const reportId = seed.reports.projectBReportId;
  const denied = page.waitForResponse(response =>
    response.request().method() === 'GET' && new RegExp(`/api/(rdo/)?reports/${reportId}$`).test(new URL(response.url()).pathname)
  );
  await page.goto(`/rdo/relatorios/${reportId}`);
  expect((await denied).status()).toBe(403);
  await expect(page.getByText('Você não tem permissão para acessar este relatório.')).toBeVisible();
  await expect(page.getByText(seed.projects.b.name)).toHaveCount(0);

  await page.goto('/rdo/gestor');
  await expect(page).not.toHaveURL(/\/rdo\/gestor/);
});
