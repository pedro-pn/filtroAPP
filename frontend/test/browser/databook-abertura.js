async page => {
  const url = page.url().split('/test/')[0] + '/test/browser/databook-previa.html';
  const erros = [];
  const pedidosPdf = [];
  const registrarErro = error => erros.push(error.message);
  const registrarPedido = request => {
    if (/DatabookPdfViewer|pdfjs-dist|\/pdf-[^/]+\.js/.test(request.url())) pedidosPdf.push(request.url());
  };
  page.on('pageerror', registrarErro);
  page.on('request', registrarPedido);
  const rota = /\/DatabookPdfViewer(?:\.tsx|-[^/]+\.js)(?:\?|$)/;
  await page.route(rota, route => route.abort());
  try {
    await page.goto(url);
    await page.getByRole('button', { name: 'Data Book', exact: true }).click();
    await page.getByRole('heading', { name: 'Data Books gerados', exact: true }).waitFor();
    if (pedidosPdf.length) throw new Error('Abrir o menu carregou o motor de PDF.');
    await page.getByRole('button', { name: 'Editar DB-9001-01 revisão 0', exact: true }).click();
    await page.getByText('Não foi possível exibir o PDF nesta tela.', { exact: true }).waitFor();
    await page.getByRole('link', { name: 'Abrir prévia em outra aba', exact: true }).waitFor();
    if (await page.locator('.databook-previa__editor').count()) throw new Error('Exibiu o painel lateral antigo.');
    await page.getByRole('button', { name: 'Voltar', exact: true }).click();
    await page.getByRole('textbox', { name: 'Escopo', exact: true }).fill('Rascunho continua nas configurações');
    await page.getByRole('button', { name: 'Voltar', exact: true }).click();
    await page.getByRole('heading', { name: 'Data Books gerados', exact: true }).waitFor();
    if (erros.length) throw new Error(`Erro não tratado: ${erros.join(', ')}`);
    console.log('Menu abre sem carregar PDF; falha do visualizador preserva navegação, configurações e link direto.');
  } finally {
    await page.unroute(rota);
    page.off('pageerror', registrarErro);
    page.off('request', registrarPedido);
  }
}
