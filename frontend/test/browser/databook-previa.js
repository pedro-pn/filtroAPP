async page => {
  const url = page.url().split('/test/')[0] + '/test/browser/databook-previa.html';
  const verificar = (ok, mensagem) => { if (!ok) throw new Error(mensagem); };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  await page.getByRole('button', { name: 'Data Book', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('textbox', { name: 'Escopo', exact: true }).fill('Escopo preparado antes da prévia');
  await page.getByRole('button', { name: 'Visualizar prévia', exact: true }).click();
  await page.getByText('3 páginas · rolagem contínua', { exact: true }).waitFor();
  verificar(await page.getByRole('textbox', { name: 'Escopo', exact: true }).count() === 0, 'Formulário continua ao lado da prévia.');
  await page.locator('[data-databook-target="documento.capa.servico"]').click();
  await page.locator('[data-databook-inline]').fill('Título alterado diretamente na capa');
  await page.locator('[data-databook-inline]').press('Enter');
  await page.waitForFunction(() => document.querySelector('[data-databook-target="documento.capa.servico"]')?.getAttribute('data-databook-renderizado') === 'Título alterado diretamente na capa');
  await page.getByRole('button', { name: 'Voltar', exact: true }).click();
  verificar(await page.getByRole('textbox', { name: 'Escopo', exact: true }).innerText() === 'Escopo preparado antes da prévia', 'Voltar apagou o formulário.');
  await page.getByRole('button', { name: 'Visualizar prévia', exact: true }).click();
  await page.getByText('3 páginas · rolagem contínua', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Gerar Data Book', exact: true }).click();
  await page.getByText(/Rev. 1 pronto/).waitFor();
  const dados = await page.evaluate(() => ({ ultima: window.databookChamadas.filter(c => c.url.endsWith('/previa')).at(-1).body, revisoes: window.databookRevisoes }));
  verificar(dados.ultima.edicoes.campos_documento['documento.capa.servico'] === 'Título alterado diretamente na capa', 'Reabrir prévia perdeu a edição na capa.');
  verificar(dados.ultima.edicoes.textos.escopo === 'Escopo preparado antes da prévia', 'Texto de preparação perdido.');
  verificar(dados.revisoes.length === 2 && dados.revisoes[1].descricao === 'Emissão inicial', 'Revisão original alterada.');

  await page.goto(url + '?erro-previa=1');
  await page.getByRole('button', { name: 'Data Book', exact: true }).click();
  await page.getByRole('button', { name: 'Editar DB-9001-01 revisão 0', exact: true }).click();
  await page.getByText('Não foi possível atualizar a prévia.', { exact: true }).waitFor();
  verificar(await page.getByRole('button', { name: 'Salvar como nova revisão', exact: true }).isDisabled(), 'Falha inicial deixou salvar.');
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await page.getByText('3 páginas · rolagem contínua', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Voltar', exact: true }).click();
  await page.getByRole('button', { name: 'Voltar', exact: true }).click();
  verificar(await page.evaluate(() => !window.databookChamadas.some(c => c.url.endsWith('/gerar'))), 'Cancelar gerou uma revisão.');

  await page.goto(url + '?longo=1');
  await page.getByRole('button', { name: 'Data Book', exact: true }).click();
  await page.getByRole('button', { name: 'Editar DB-9001-01 revisão 0', exact: true }).click();
  await page.getByText('42 páginas · rolagem contínua', { exact: true }).waitFor();
  verificar(await page.locator('.databook-pdf__pagina').count() === 42, 'Prévia longa não preservou a rolagem completa.');
  await page.setViewportSize({ width: 320, height: 740 });
  const salvar = page.getByRole('button', { name: 'Salvar como nova revisão', exact: true });
  verificar(await salvar.evaluate(e => e.getBoundingClientRect().right <= innerWidth), 'Salvar ficou cortado no celular.');
  verificar(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Tela tem rolagem horizontal.');
  console.log('Preparação, edição na capa, voltar/reabrir, salvamento, falha inicial, cancelamento e documento longo validados.');
}
