async page => {
  const base = page.url().split('/test/')[0] + '/test/browser/project-scopes.html';
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const open = async query => {
    await page.goto(base + query);
    await page.getByRole('button', { name: 'Consultar escopo', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Escopo do projeto', exact: true });
    await dialog.getByRole('heading', { name: 'Vínculos dos serviços', exact: true }).waitFor();
    return dialog;
  };
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const dialog = await open('?grupo=1');
    const firstTab = dialog.getByRole('tab', { name: /Projeto 5815/ });
    const secondTab = dialog.getByRole('tab', { name: /Projeto 5816/ });
    const list = dialog.getByRole('list', { name: 'Serviços e propostas de origem' });
    assert(await dialog.getByRole('tab').count() === 2, 'Aba permite consultar um projeto oculto do grupo.');
    assert(await firstTab.getAttribute('aria-selected') === 'true', 'Primeiro projeto não selecionado.');
    assert(await list.getByRole('listitem').count() === 3, 'Lista inicial mistura serviços de projetos.');
    assert(!await page.evaluate(() => window.scopeCalls.some(call => call.url.includes('/projetos/p2/escopos-propostas'))), 'Carregou propostas de um projeto não aberto.');
    await firstTab.focus();
    await firstTab.press('ArrowRight');
    await list.getByText('Linha da usina · L-203', { exact: true }).waitFor();
    assert(await secondTab.getAttribute('aria-selected') === 'true', 'Seta direita não selecionou o projeto seguinte.');
    assert(await list.getByRole('listitem').count() === 1, 'Aba da usina exibe serviços da Ventura.');
    const row = list.getByRole('listitem');
    await row.getByRole('button', { name: 'Vincular proposta', exact: true }).click();
    const form = row.getByRole('form', { name: 'Vincular serviço à proposta' });
    await form.waitFor();
    assert(await form.evaluate(element => Boolean(element.closest('.proposal-scopes__service'))), 'Editor foi aberto fora do serviço selecionado.');
    assert(await firstTab.isDisabled(), 'Troca de projeto pode descartar a edição em andamento.');
    assert(await form.getByRole('combobox').evaluate(element => element === document.activeElement), 'Editor não recebeu foco.');
    await form.getByRole('combobox').selectOption('ACCESS_IMPORT:4800');
    await form.getByRole('textbox', { name: 'Motivo', exact: true }).fill('Escopo contratado do projeto 5816');
    await form.getByRole('button', { name: 'Salvar vínculo', exact: true }).click({ trial: true });
    await page.screenshot({ path: 'output/playwright/project-scopes-editor-' + width + '.png' });
    await form.getByRole('button', { name: 'Salvar vínculo', exact: true }).click();
    await list.getByText('Vínculo manual', { exact: true }).waitFor();
    const saved = await page.evaluate(() => window.scopeCalls.filter(call => call.method === 'put').at(-1));
    assert(saved.url.endsWith('/projetos/p2/escopos-propostas/r3') && saved.body.contributionKey === 'ACCESS_IMPORT:4800'
      && saved.body.version === 'd'.repeat(64), 'Salvamento perdeu o projeto, o relatório ou a versão.');
    await firstTab.click();
    await list.getByText('Vaso do compressor · 845-VK-001A1', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Pendentes (2)', exact: true }).click();
    assert(await list.getByRole('listitem').count() === 2, 'Filtro de pendências inclui registros já vinculados.');
    await dialog.getByRole('searchbox', { name: 'Buscar serviço ou RDO' }).fill('001A1');
    assert(await list.getByRole('listitem').count() === 1, 'Busca não filtra a TAG.');
    await dialog.getByRole('combobox', { name: 'Proposta do escopo', exact: true }).selectOption('ACCESS_IMPORT:4586');
    const pending = list.getByRole('listitem');
    await pending.getByRole('button', { name: 'Vincular proposta', exact: true }).click();
    const cancelForm = pending.getByRole('form', { name: 'Vincular serviço à proposta' });
    assert(await cancelForm.getByRole('combobox').inputValue() === 'ACCESS_IMPORT:4586', 'Proposta filtrada não foi sugerida.');
    await cancelForm.getByRole('textbox', { name: 'Motivo', exact: true }).fill('Edição descartada');
    await cancelForm.getByRole('textbox', { name: 'Motivo', exact: true }).press('Escape');
    assert(await dialog.count() === 1 && await dialog.getByRole('form', { name: 'Vincular serviço à proposta' }).count() === 0, 'Escape fechou o escopo inteiro.');
    assert(await pending.getByRole('button', { name: 'Vincular proposta', exact: true }).evaluate(element => element === document.activeElement), 'Cancelar não devolveu foco ao serviço.');
    assert(await page.evaluate(() => window.scopeCalls.filter(call => call.method === 'put').length) === 1, 'Cancelar enviou alteração ao servidor.');
    await dialog.getByRole('searchbox', { name: 'Buscar serviço ou RDO' }).fill('Inexistente');
    await dialog.getByText('Nenhum serviço encontrado', { exact: true }).waitFor();
    await dialog.getByRole('searchbox', { name: 'Buscar serviço ou RDO' }).fill('');
    await page.screenshot({ path: 'output/playwright/project-scopes-group-' + width + '.png' });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Página excede a largura de ' + width + 'px.');
    assert(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'Diálogo excede sua largura em ' + width + 'px.');
    const single = await open('');
    assert(await single.getByRole('tablist').count() === 0, 'Projeto individual ganhou abas vazias.');
    assert(await single.getByRole('list', { name: 'Serviços e propostas de origem' }).getByRole('listitem').count() === 3, 'Projeto individual perdeu a mesma tela de vínculos.');
  }
  const readonly = await open('?grupo=1&consulta=1');
  assert(await readonly.getByRole('button', { name: 'Vincular proposta', exact: true }).count() === 0, 'Consulta permite editar vínculos.');
  await readonly.getByRole('tab', { name: /Projeto 5816/ }).click();
  await readonly.getByText('Linha da usina · L-203', { exact: true }).waitFor();
  for (const mode of ['falha', 'conflito']) {
    const dialog = await open('?grupo=1&' + mode + '=1');
    const row = dialog.getByRole('list', { name: 'Serviços e propostas de origem' }).getByRole('listitem').first();
    await row.getByRole('button', { name: 'Vincular proposta', exact: true }).click();
    const form = row.getByRole('form', { name: 'Vincular serviço à proposta' });
    await form.getByRole('combobox').selectOption('ACCESS_IMPORT:4586');
    await form.getByRole('textbox', { name: 'Motivo', exact: true }).fill('Conferência preservada');
    await form.getByRole('button', { name: 'Salvar vínculo', exact: true }).click();
    await form.getByText('Não foi possível salvar o vínculo.', { exact: true }).waitFor();
    assert(await form.getByRole('textbox', { name: 'Motivo', exact: true }).inputValue() === 'Conferência preservada', 'Falha apagou o motivo.');
    assert(await form.getByRole('combobox').inputValue() === 'ACCESS_IMPORT:4586', 'Falha apagou a proposta.');
    if (mode === 'conflito') {
      await form.getByRole('button', { name: 'Atualizar serviço', exact: true }).click();
      await form.getByText('Não foi possível salvar o vínculo.', { exact: true }).waitFor({ state: 'hidden' });
    }
    await form.getByRole('button', { name: 'Salvar vínculo', exact: true }).click();
    await row.getByText('Vínculo manual', { exact: true }).waitFor();
    const saved = await page.evaluate(() => window.scopeCalls.filter(call => call.method === 'put').at(-1));
    assert(saved.body.version === (mode === 'conflito' ? 'e' : 'd').repeat(64), 'Nova tentativa ignorou a versão atualizada.');
  }
  return { ok: true, widths: [360, 768, 1440], groupedAndSingle: true, isolatedWrites: true, retryAndConflict: true };
}
