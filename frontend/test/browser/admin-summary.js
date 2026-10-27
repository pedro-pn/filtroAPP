async page => {
  const url = page.url().split('/test/')[0] + '/test/browser/admin-summary.html';
  const dialog = () => page.getByRole('dialog', { name: 'Converter para fluxo resumido', exact: true });
  const confirm = () => dialog().getByRole('button', { name: /^Converter e mover/ });
  const result = async () => JSON.parse(await page.getByTestId('admin-summary-result').textContent());
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(url);
  await dialog().waitFor();
  if (!await confirm().isDisabled()) throw new Error('Permitiu converter sem etapa e motivo.');
  const select = dialog().getByRole('combobox', { name: 'Etapa de destino' });
  const stages = await select.locator('option').evaluateAll(options => options.map(option => option.value).filter(Boolean));
  if (stages.join(',') !== 'MOBILIZATION,EXECUTION,DEMOBILIZATION,POST_JOB,FINAL_MEASUREMENT,FINISHED') throw new Error('Etapas incorretas.');
  await select.selectOption('FINISHED');
  await dialog().getByRole('textbox', { name: 'Motivo da conversão' }).fill('   ');
  if (!await confirm().isDisabled()) throw new Error('Aceitou motivo em branco.');
  await dialog().getByRole('textbox', { name: 'Motivo da conversão' }).fill('  Projeto antigo já concluído.  ');
  await confirm().click();
  await dialog().waitFor({ state: 'hidden' });
  const submitted = await result();
  if (submitted.url !== '/efetivo/project-workflow/project-1/legacy-summary/convert') throw new Error('Endpoint incorreto.');
  if (JSON.stringify(submitted.payload) !== JSON.stringify({ version: 3, stage: 'FINISHED', reason: 'Projeto antigo já concluído.' })) throw new Error('Payload incorreto.');

  await page.goto(url + '?mode=finished');
  await dialog().getByRole('combobox').selectOption('EXECUTION');
  await dialog().getByRole('textbox').fill('Retornar à execução.');
  await confirm().click();
  await dialog().waitFor({ state: 'hidden' });
  if ((await result()).payload.stage !== 'EXECUTION') throw new Error('Não permitiu retornar de encerrado.');

  await page.goto(url + '?mode=sede');
  await dialog().waitFor();
  const sedeStages = await dialog().getByRole('combobox').locator('option').evaluateAll(options => options.map(option => option.value));
  if (sedeStages.includes('MOBILIZATION') || sedeStages.includes('DEMOBILIZATION')) throw new Error('Ofereceu etapa de campo na Sede.');
  await dialog().getByRole('button', { name: 'Cancelar', exact: true }).click();
  if (await result() !== null) throw new Error('Cancelar alterou o projeto.');

  await page.goto(url + '?mode=saving');
  await dialog().waitFor();
  if (!await confirm().isDisabled()) throw new Error('Permitiu envio duplicado.');
  if (!await dialog().getByRole('combobox').isDisabled()) throw new Error('Permitiu trocar etapa durante envio.');
  await page.keyboard.press('Escape');
  if (!await dialog().isVisible()) throw new Error('Fechou durante envio.');

  await page.goto(url + '?mode=internal');
  await page.getByRole('button', { name: 'Abrir conversão' }).waitFor();
  if (await dialog().count()) throw new Error('Expôs conversão a conta interna.');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  await dialog().waitFor();
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Rolagem horizontal no celular.');
  await page.screenshot({ path: 'output/playwright/admin-summary-mobile.png', fullPage: true });
  await page.keyboard.press('Escape');
  await dialog().waitFor({ state: 'hidden' });
  if (await result() !== null) throw new Error('Escape alterou o projeto.');
  return 'PASS: etapas, motivo, endpoint e versão, encerramento, retorno à execução, Sede, cancelamento, envio duplicado, permissão e celular.';
}
