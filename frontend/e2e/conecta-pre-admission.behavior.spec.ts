import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`pré-admissão exige confirmação antes de incluir na equipe (${viewport.width}px)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/test/browser/planning-signatures.html?preAdmission=1');
    await page.getByRole('button', { name: 'Adicionar colaborador à equipe', exact: true }).click();
    const card = page.locator('[data-collaborator-id="c3"]');
    await expect(card.getByText('Pré-admissão', { exact: true })).toBeVisible();
    await card.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Adicionar à equipe', exact: true }).click();
    await expect(page.getByText('Mobilizar colaborador em pré-admissão?', { exact: true })).toBeVisible();
    await expect(page.locator('[data-test-writes]')).toHaveText('[]');
    await page.getByRole('button', { name: 'Cancelar', exact: true }).last().click();
    await expect(page.locator('[data-test-writes]')).toHaveText('[]');
    await page.getByRole('button', { name: 'Adicionar à equipe', exact: true }).click();
    await page.getByRole('button', { name: 'Confirmar mobilização', exact: true }).click();
    await expect(page.locator('[data-test-writes]')).toContainText('"allowPreAdmissionCollaborator":true');
    await expect(page.locator('[data-test-writes]')).toContainText('"collaboratorId":"c3"');
  });
}
