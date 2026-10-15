async page => {
  const verificar = (ok, mensagem) => { if (!ok) throw new Error(mensagem); };
  const erros = [];
  const registrar = error => erros.push(error.message);
  page.on('pageerror', registrar);
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(page.url().split('/test/')[0] + '/test/browser/databook-previa.html?campos=1');
    await page.getByRole('button', { name: 'Data Book', exact: true }).click();
    await page.getByRole('button', { name: 'Editar DB-9001-01 revisão 0', exact: true }).click();
    await page.getByText('3 páginas · rolagem contínua', { exact: true }).waitFor();
    verificar(await page.locator('.databook-previa__editor, .databook-campos').count() === 0, 'Ainda existe um painel lateral.');
    verificar(await page.getByRole('button', { name: 'Atualizar prévia', exact: true }).count() === 0, 'Ainda exige atualizar manualmente.');
    const selecionar = async (pagina, id) => {
      const trecho = page.locator(`[data-pagina="${pagina}"]`);
      await trecho.scrollIntoViewIfNeeded();
      const campo = trecho.locator(`[data-databook-target="${id}"]`);
      await campo.click();
      const input = trecho.locator(`[data-databook-inline="${id}"]`);
      await input.waitFor();
      verificar(await input.evaluate(e => document.activeElement === e), 'O campo não recebeu foco no documento.');
      verificar(await input.evaluate(e => Boolean(e.closest('.databook-pdf__pagina'))), 'Edição aberta fora do documento.');
      return input;
    };
    const aplicar = async (pagina, id, novo) => {
      const input = await selecionar(pagina, id);
      await input.fill(novo);
      await input.press('Enter');
      await page.waitForFunction(({ id, novo }) => Array.from(document.querySelectorAll('[data-databook-target]')).some(e => e.getAttribute('data-databook-target') === id && e.getAttribute('data-databook-renderizado') === novo), { id, novo });
    };
    await aplicar(2, 'documento.s2.indicadores.dias_execucao', '19');
    await aplicar(2, 'documento.s2.tabela.avanco.linha.0.coluna.4', '82%');
    await aplicar(2, 'documento.s2.grafico.dia.0.percentual', '73%');
    await aplicar(3, 'documento.d2.campo.pressao.valor', '350 bar');
    let input = await selecionar(3, 'documento.d1.campo.pressao.valor');
    verificar(await input.inputValue() === '315 bar', 'Texto igual em outro dia foi alterado.');
    await input.fill('999 bar');
    await input.press('Escape');
    verificar(await page.getByRole('dialog').count() === 1, 'Esc fechou a tela em vez de cancelar o campo.');
    verificar(await page.locator('[data-databook-target="documento.d1.campo.pressao.valor"]').getAttribute('data-databook-renderizado') === '315 bar', 'Esc não cancelou a edição.');
    await aplicar(2, 'documento.s2.campo.observacao.valor', 'Campo vazio preenchido');

    await page.setViewportSize({ width: 390, height: 844 });
    input = await selecionar(2, 'documento.s2.indicadores.dias_execucao');
    verificar(await input.inputValue() === '19', 'Atualização automática perdeu o número editado.');
    await input.fill('21');
    await page.waitForFunction(() => {
      const input = document.querySelector('[data-databook-inline]');
      const campo = input?.getBoundingClientRect();
      return campo && campo.top >= document.querySelector('.databook-pdf__controles').getBoundingClientRect().bottom && campo.bottom <= document.querySelector('.fv-modal__footer').getBoundingClientRect().top;
    });
    verificar(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Tela transborda no celular.');
    await page.screenshot({ path: 'output/playwright/databook-inline-mobile.png' });
    // Salvar diretamente durante a digitação precisa incluir o último valor, sem atualização manual.
    await page.getByRole('button', { name: 'Salvar como nova revisão', exact: true }).click();
    await page.getByText(/Rev. 1 pronto/).waitFor();
    const resultado = await page.evaluate(() => {
      const salva = window.databookChamadas.find(c => c.url.endsWith('/gerar'));
      const edicoes = window.databookChamadas.filter(c => c.url.endsWith('/previa')).at(-1).body.edicoes;
      return { salva, edicoes, revisoes: window.databookRevisoes };
    });
    const campos = resultado.edicoes.campos_documento;
    verificar(campos['documento.s2.indicadores.dias_execucao'] === '21', 'Salvar perdeu o último caractere digitado.');
    verificar(campos['documento.s2.tabela.avanco.linha.0.coluna.4'] === '82%', 'Avanço não foi salvo.');
    verificar(campos['documento.s2.grafico.dia.0.percentual'] === '73%', 'Gráfico não foi salvo.');
    verificar(campos['documento.d2.campo.pressao.valor'] === '350 bar', 'Medição não foi salva.');
    verificar(campos['documento.d1.campo.pressao.valor'] === undefined, 'Edição cancelada ficou no arquivo.');
    verificar(campos['documento.s2.campo.observacao.valor'] === 'Campo vazio preenchido', 'Campo vazio não foi salvo.');
    verificar(Object.keys(resultado.salva.body).join() === 'previaId', 'Salvar usou dados diferentes da prévia.');
    verificar(resultado.revisoes.length === 2 && resultado.revisoes[1].descricao === 'Emissão inicial', 'Revisão antiga foi alterada.');
    verificar(erros.length === 0, `Erros no navegador: ${erros.join(', ')}`);
    console.log('Edição sobre o campo, atualização automática, números, células vazias, Esc, celular e nova revisão validados.');
  } finally { page.off('pageerror', registrar); }
}
