async page => {
  const baseUrl = page.url().split('/test/')[0];
  const fixtureUrl = baseUrl + '/test/browser/physical-signature-batch.html';
  await page.goto(fixtureUrl);
  await page.getByRole('button', { name: 'Enviar assinados em lote', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Enviar RDOs assinados em lote', exact: true });
  const project = dialog.getByRole('combobox', { name: 'Projeto', exact: true });
  if (await project.inputValue()) throw new Error('O projeto deve ser escolhido pelo usuário.');
  if (await dialog.locator('input[type=file]').count()) throw new Error('Upload foi exibido antes da seleção do projeto.');
  if (await page.evaluate(() => window.physicalBatchProjectRequests.length)) throw new Error('Consultou RDOs antes da seleção do projeto.');
  await page.screenshot({ path: 'output/playwright/rdo-batch-project-selection.png', fullPage: true });

  await project.selectOption('project-b');
  const input = dialog.locator('input[type=file]');
  await dialog.locator('input[type=file]:enabled').waitFor({ state: 'attached' });
  await project.selectOption('project-a');
  await dialog.locator('input[type=file]:enabled').waitFor({ state: 'attached' });
  const pdf = name => ({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
  const names = ['RDO 12 - 01-10-2026.pdf', 'RDO 13.pdf', 'digitalizacao.pdf'];
  const wrongProjectName = 'Missão 5807 - RDO 12.pdf';
  await input.setInputFiles([...names.map(pdf), pdf(wrongProjectName)]);
  for (const [index, id] of ['a-12', 'a-13'].entries()) {
    if (await dialog.getByLabel(`RDO de ${names[index]}`, { exact: true }).inputValue() !== id) throw new Error('Vínculo incorreto no projeto selecionado.');
  }
  if (!(await project.isDisabled())) throw new Error('Projeto do lote pôde ser alterado com arquivos associados.');
  if (await dialog.getByRole('combobox', { name: /^Projeto de / }).count()) throw new Error('Exibiu projeto por arquivo.');
  if (await dialog.locator('option[value="b-12"]').count()) throw new Error('Ofereceu RDO de outro projeto.');
  if (await dialog.getByLabel(`RDO de ${wrongProjectName}`, { exact: true }).inputValue()) throw new Error('Arquivo de outra missão foi vinculado automaticamente.');
  const send = () => dialog.getByRole('button', { name: /^Enviar \d+ PDFs? vinculados?$/ });
  if (!(await send().isDisabled())) throw new Error('Lote incompleto pôde ser enviado.');
  await dialog.getByRole('button', { name: `Remover ${wrongProjectName}`, exact: true }).click();
  const manual = dialog.getByLabel(`RDO de ${names[2]}`, { exact: true });
  if (!(await manual.locator('option[value="a-12"]').isDisabled())) throw new Error('RDO já associado ficou disponível.');
  await manual.selectOption('a-14');

  const duplicateName = 'RDO 12 copia.pdf';
  await input.setInputFiles([pdf(duplicateName)]);
  if (!(await send().isDisabled())) throw new Error('Lote com dois arquivos para o mesmo RDO pôde ser enviado.');
  await dialog.getByText('Este RDO já está associado a outro arquivo do lote.', { exact: true }).first().waitFor();
  await dialog.getByRole('button', { name: `Remover ${duplicateName}`, exact: true }).click();
  await input.setInputFiles([{ name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from('invalid') }]);
  if (await dialog.locator('.physical-signature-batch-file').count() !== 3) throw new Error('Arquivo não PDF foi aceito.');

  await send().click();
  await dialog.getByText('Enviando PDF…', { exact: true }).first().waitFor();
  await page.keyboard.press('Escape');
  if (!(await dialog.isVisible())) throw new Error('Lote fechou durante envio.');
  await dialog.getByText('Falha na comunicação com a API.', { exact: true }).waitFor();
  await dialog.getByText('3 arquivo(s) · 2 enviado(s) · 1 restante(s)', { exact: true }).waitFor();
  if (await dialog.getByText('PDF registrado com sucesso.', { exact: true }).count() !== 2) throw new Error('Envio não continuou após uma falha.');
  await send().click();
  await dialog.getByText('3 arquivo(s) · 3 enviado(s) · 0 restante(s)', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Fechar', exact: true }).last().click();
  if (await page.getByTestId('batch-attempts').textContent() !== 'a-12, a-13, a-14, a-13') throw new Error('Retentativa repetiu arquivos já salvos.');

  await page.getByRole('button', { name: 'Enviar assinados em lote', exact: true }).click();
  if (await project.inputValue()) throw new Error('Novo lote não iniciou na escolha do projeto.');
  await project.selectOption('project-b');
  await dialog.locator('input[type=file]:enabled').waitFor({ state: 'attached' });
  await input.setInputFiles([pdf('RDO 12.pdf')]);
  if (await dialog.getByLabel('RDO de RDO 12.pdf', { exact: true }).inputValue() !== 'b-12') throw new Error('Novo lote usou RDO do projeto anterior.');
  await send().click();
  await dialog.getByText('1 arquivo(s) · 1 enviado(s) · 0 restante(s)', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Fechar', exact: true }).last().click();

  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Enviar assinados em lote', exact: true }).click();
  await project.selectOption('project-a');
  await dialog.locator('input[type=file]:enabled').waitFor({ state: 'attached' });
  const manualName = 'digitalizacao-assinada-com-nome-muito-longo-para-validar-o-layout-no-celular.pdf';
  await input.setInputFiles([pdf(manualName)]);
  await dialog.getByLabel(`RDO de ${manualName}`, { exact: true }).selectOption('a-12');
  if (!(await send().isEnabled())) throw new Error('Associação manual não habilitou envio.');
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Modal apresentou rolagem horizontal no celular.');
  await page.screenshot({ path: 'output/playwright/rdo-batch-mobile.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();

  await page.goto(fixtureUrl + '?load-error=1');
  await page.getByRole('button', { name: 'Enviar assinados em lote', exact: true }).click();
  await project.selectOption('project-a');
  await dialog.getByText('Não foi possível carregar os RDOs deste projeto.', { exact: false }).waitFor();
  await dialog.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await dialog.locator('input[type=file]:enabled').waitFor({ state: 'attached' });
  await project.selectOption('project-empty');
  await dialog.getByText('Este projeto não possui RDOs aprovados disponíveis para receber um PDF assinado.', { exact: true }).waitFor();
  if (!(await input.isDisabled())) throw new Error('Permitiu upload para projeto sem RDOs.');
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(baseUrl + '/test/browser/gestor-project-search.html?tab=aprovados');
  await page.getByRole('button', { name: 'Enviar assinados em lote', exact: true }).click();
  if (await dialog.locator('input[type=file]').count()) throw new Error('Tela real ofereceu upload antes do projeto.');
  await project.selectOption('archived-other');
  await dialog.locator('input[type=file]:enabled').waitFor({ state: 'attached' });
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  return 'PASS: projeto primeiro, consulta restrita ao projeto, conciliação sem nome da missão, associação manual apenas aos RDOs do projeto, projeto fixo por lote, duplicados, PDF inválido, falha parcial, retentativa, novo lote de outro projeto, projeto vazio, recuperação da lista e layout móvel.';
}
