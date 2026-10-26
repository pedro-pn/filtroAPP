async page => {
  const base = page.url().split('/test/')[0];
  await page.goto(base + '/test/browser/gestor-project-search.html?tab=projetos&service-signers=1');
  const edit = () => page.getByRole('button', { name: 'Editar', exact: true }).first().click();
  const primary = () => page.getByLabel('Exigir assinatura de principal@example.com nos relatórios de serviço', { exact: true });
  const additional = () => page.getByLabel('Exigir assinatura de fiscal@example.com nos relatórios de serviço', { exact: true });
  const assertSelection = async (primaryChecked, additionalChecked) => {
    await primary().waitFor({ state: 'attached' });
    if (await primary().isChecked() !== primaryChecked || await additional().isChecked() !== additionalChecked) {
      throw new Error('Seleção dos assinantes de serviço não foi preservada.');
    }
    if (await page.locator('.cc-name-row').getByRole('textbox', { name: 'Nome', exact: true }).inputValue() !== 'Fiscal') {
      throw new Error('Assinante do RDO foi alterado ao dispensar assinatura de serviço.');
    }
  };
  await edit();
  await assertSelection(true, true);
  await additional().locator('..').click();
  await page.getByRole('button', { name: 'Salvar projeto', exact: true }).click();
  await edit();
  await assertSelection(true, false);
  await primary().locator('..').click();
  await additional().locator('..').click();
  await page.getByRole('button', { name: 'Salvar projeto', exact: true }).click();
  await edit();
  await assertSelection(false, true);
  await page.setViewportSize({ width: 390, height: 844 });
  await assertSelection(false, true);
  const fields = page.getByText('Assinantes dos relatórios de serviço', { exact: true }).locator('..');
  await fields.scrollIntoViewIfNeeded();
  const box = await fields.boundingBox();
  if (!box || box.x < 0 || box.x + box.width > 391) throw new Error('Assinantes de serviço ultrapassam a tela móvel.');
  await fields.screenshot({ path: 'output/playwright/service-report-signers-mobile.png' });
  return 'PASS: dispensa do principal ou adicional, salvar/reabrir, preservação do assinante do RDO e tela móvel.';
}
