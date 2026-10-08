async page => {
  const fixtureUrl = page.url().split('/test/')[0] + '/test/browser/gestor-project-search.html';
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(fixtureUrl + '?tab=arquivados');
  const search = page.getByRole('searchbox', { name: 'Buscar em arquivados', exact: true });
  const archivedTable = page.getByRole('table', { name: 'Projetos arquivados', exact: true });
  const expectProject = async (query, title) => {
    await search.fill(query);
    await archivedTable.getByText(title, { exact: true }).waitFor();
    if (await archivedTable.getByRole('rowheader').count() !== 1) throw new Error(`Busca ${query} exibiu projetos não correspondentes.`);
  };
  await archivedTable.getByText('5807 - VILLARIS', { exact: true }).waitFor();
  for (const query of ['5807', 'villaris', 'VILLARIS', '5807 villaris', 'villáris']) {
    await expectProject(query, '5807 - VILLARIS');
  }
  await page.reload();
  await archivedTable.getByText('5807 - VILLARIS', { exact: true }).waitFor();
  if (await search.inputValue() !== 'villáris') throw new Error('Busca não foi preservada ao recarregar.');
  await expectProject('5808', '5808 - Sem relatórios');
  await expectProject('pressao', '9999 - Outro projeto');
  await search.fill('projeto-inexistente');
  await page.getByText('Nenhum projeto arquivado encontrado.', { exact: true }).waitFor();
  if (await archivedTable.count()) throw new Error('Busca sem correspondência exibiu projetos.');
  await page.getByRole('button', { name: 'Limpar busca', exact: true }).click();
  await archivedTable.getByText('5808 - Sem relatórios', { exact: true }).waitFor();
  if (await archivedTable.getByRole('rowheader').count() !== 3) throw new Error('Limpar a busca não recuperou todos os arquivados.');

  await page.goto(fixtureUrl + '?tab=projetos');
  const activeSearch = page.getByRole('searchbox', { name: 'Buscar em projetos', exact: true });
  const activeTable = page.getByRole('table', { name: 'Projetos ativos', exact: true });
  for (const query of ['5807', 'villaris']) {
    await activeSearch.fill(query);
    await activeTable.getByText('5807 - VILLARIS', { exact: true }).waitFor();
    if (await activeTable.getByRole('rowheader').count() !== 1) throw new Error('Busca de projetos ativos não filtrou o projeto.');
  }
  return 'PASS: código, nome, maiúsculas, acentos, múltiplos termos, relatórios não carregados, projeto sem relatórios, busca por relatório, termo inexistente, limpeza, persistência e projetos ativos.';
}
