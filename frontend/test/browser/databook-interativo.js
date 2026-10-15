async page => {
  const raiz = page.url().split('/test/')[0] + '/test/browser/databook-previa.html';
  const verificar = (ok, mensagem) => { if (!ok) throw new Error(mensagem); };
  const erros = [];
  const registrar = error => erros.push(error.message);
  page.on('pageerror', registrar);
  const abrir = async consulta => {
    await page.goto(raiz + consulta);
    await page.getByRole('button', { name: 'Data Book', exact: true }).click();
    await page.getByRole('button', { name: 'Editar DB-9001-01 revisão 0', exact: true }).click();
    await page.getByText('3 páginas · rolagem contínua', { exact: true }).waitFor();
  };
  const editar = async id => {
    await page.locator('[data-pagina="2"]').scrollIntoViewIfNeeded();
    await page.locator(`[data-databook-target="${id}"]`).click();
    const input = page.locator(`[data-databook-inline="${id}"]`);
    await input.waitFor();
    return input;
  };
  const aplicado = async (id, valor) => page.waitForFunction(({ id, valor }) => Array.from(document.querySelectorAll('[data-databook-target]')).some(e => e.getAttribute('data-databook-target') === id && e.getAttribute('data-databook-renderizado') === valor), { id, valor });
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await abrir('?lento=1');
    const documento = page.locator('.databook-previa__pdf');
    verificar(await page.locator('.databook-pdf__pagina').count() === 3, 'Não exibe o documento completo em rolagem.');
    verificar(await page.getByRole('button', { name: /Anterior|Próxima/ }).count() === 0, 'A prévia ainda tem navegação por páginas.');
    await page.getByRole('button', { name: 'Aumentar zoom', exact: true }).click();
    let input = await editar('documento.s2.indicadores.dias_execucao');
    await input.fill('22');
    await input.press('Enter');
    const antes = await documento.evaluate(e => { e.dataset.leitura = 'preservada'; return e.scrollTop; });
    await aplicado('documento.s2.indicadores.dias_execucao', '22');
    verificar(await documento.getAttribute('data-leitura') === 'preservada', 'Atualização desmontou o documento.');
    verificar(Math.abs(await documento.evaluate(e => e.scrollTop) - antes) < 15, 'Atualização perdeu a posição de leitura.');
    verificar(await page.locator('.databook-pdf__zoom').innerText().then(t => t.includes('125%')), 'Atualização perdeu o zoom.');

    input = await editar('documento.s2.tabela.avanco.linha.0.coluna.4');
    await input.fill('83%');
    await input.press('Enter');
    await page.waitForFunction(() => window.databookChamadas.filter(c => c.url.endsWith('/previa')).length === 3);
    input = await editar('documento.s2.grafico.dia.0.percentual');
    await input.fill('88%');
    await page.waitForFunction(() => window.databookPreviasConcluidas.length === 3);
    verificar(await input.inputValue() === '88%', 'Resposta antiga substituiu o campo ativo.');
    verificar(await input.evaluate(e => document.activeElement === e), 'Resposta antiga roubou o foco.');
    await input.fill('89%');
    await input.press('Enter');
    await page.waitForFunction(() => window.databookChamadas.filter(c => c.url.endsWith('/previa')).length === 4);
    input = await editar('documento.s2.indicadores.dias_execucao');
    await input.fill('23');
    await page.getByRole('button', { name: 'Salvar como nova revisão', exact: true }).click();
    await page.getByText(/Rev. 1 pronto/).waitFor();
    const ultimo = await page.evaluate(() => window.databookChamadas.filter(c => c.url.endsWith('/previa')).at(-1).body.edicoes.campos_documento);
    verificar(ultimo['documento.s2.indicadores.dias_execucao'] === '23' && ultimo['documento.s2.tabela.avanco.linha.0.coluna.4'] === '83%' && ultimo['documento.s2.grafico.dia.0.percentual'] === '89%', 'Salvar usou uma atualização antiga.');

    await abrir('?falha-auto=1');
    input = await editar('documento.s2.indicadores.dias_execucao');
    await input.fill('17');
    await input.press('Enter');
    await page.getByText('Não foi possível atualizar a prévia.', { exact: true }).waitFor();
    verificar(await page.getByRole('button', { name: 'Salvar como nova revisão', exact: true }).isDisabled(), 'Falha da atualização deixou salvar uma prévia antiga.');
    input = await editar('documento.s2.indicadores.dias_execucao');
    verificar(await input.inputValue() === '17', 'Falha descartou o rascunho digitado.');
    await input.press('Escape');
    await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
    await aplicado('documento.s2.indicadores.dias_execucao', '17');
    await page.locator('[data-pagina="3"]').scrollIntoViewIfNeeded();
    await page.locator('[data-databook-target="documento.d1.campo.pressao.valor"]').click();
    input = page.locator('[data-databook-inline="documento.d1.campo.pressao.valor"]');
    await input.fill('Primeira linha');
    await input.press('Shift+Enter');
    await input.pressSequentially('Segunda linha');
    verificar(await input.inputValue() === 'Primeira linha\nSegunda linha', 'Shift+Enter não inseriu uma quebra de linha.');
    await input.press('Enter');
    await aplicado('documento.d1.campo.pressao.valor', 'Primeira linha\nSegunda linha');
    verificar(await page.evaluate(() => !window.databookChamadas.some(c => c.url.endsWith('/gerar'))), 'Atualização automática criou uma revisão antes de salvar.');
    verificar(erros.length === 0, `Erros no navegador: ${erros.join(', ')}`);
    await page.screenshot({ path: 'output/playwright/databook-inline-desktop.png' });
    console.log('Rolagem, zoom, atualização automática, respostas atrasadas, último texto ao salvar, falha/repetição e múltiplas linhas validados.');
  } finally { page.off('pageerror', registrar); }
}
