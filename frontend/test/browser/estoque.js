async page => {
  const fixture = page.url().split('/test/')[0] + '/test/browser/estoque.html';
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const choose = async (label, search, option) => {
    const field = page.getByRole('combobox', { name: label, exact: true });
    await field.click();
    assert(await field.inputValue() === '', `${label}: a busca deve começar vazia.`);
    if (search) await field.pressSequentially(search);
    await page.getByRole('option', { name: option, exact: true }).click();
    return field;
  };
  const row = name => page.locator('.stock-summary-item-row').filter({ hasText: name });
  const history = () => page.getByRole('region', { name: 'Histórico do produto', exact: true });
  const historyRows = () => history().locator('tbody tr');
  const expectRows = async count => {
    await page.waitForFunction(expected => document.querySelectorAll('.stock-product-history tbody tr').length === expected, count);
  };

  await page.setViewportSize({ width: 1280, height: 960 });
  await page.goto(fixture);
  await row('Ácido fosfórico').waitFor();
  assert((await row('Ácido fosfórico').innerText()).includes('68 kg'), 'O saldo deve aparecer com a unidade.');
  const item = await choose('Filtrar item', 'acido', 'Ácido fosfórico 85% · PQ 002');
  assert(await page.locator('.stock-summary-item-row').count() === 1, 'O produto escolhido deve filtrar a lista.');
  await item.click();
  assert(await item.inputValue() === '', 'Reabrir uma seleção também limpa o texto.');
  await item.press('Escape');
  assert(await item.inputValue() === 'Ácido fosfórico 85% · PQ 002', 'Escape deve restaurar a seleção.');
  await item.click();
  await item.pressSequentially('inexistente');
  await page.getByText('Nenhuma opção encontrada.', { exact: true }).waitFor();
  await item.press('Tab');
  assert(await item.inputValue() === 'Ácido fosfórico 85% · PQ 002', 'Sair sem escolher deve preservar a seleção.');
  assert(await page.locator('.stock-summary-item-row').count() === 1, 'Digitar uma busca não deve remover o filtro ativo.');
  await choose('Filtrar item', '', 'Todos os itens');
  await page.getByRole('button', { name: 'Ácido fosfórico 85%', exact: true }).click();
  await history().getByText('Página 1 de 2 · 12 movimentações', { exact: true }).waitFor();
  await history().getByRole('columnheader', { name: 'Saldo após', exact: true }).waitFor();
  assert(await historyRows().first().locator('[data-label="Saldo após"]').innerText() === '68 kg', 'O último saldo do produto deve bater com o estoque atual.');
  await history().getByRole('button', { name: 'Próxima', exact: true }).click();
  await expectRows(2);
  await page.getByText('Página 2 de 2 · 12 movimentações', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Seadrill 5824 · Ver histórico', exact: true }).click();
  await expectRows(2);
  assert(await historyRows().first().locator('[data-label="Saldo após"]').innerText() === '68 kg', 'Filtrar uma obra não pode reiniciar o acumulado.');
  assert(!(await history().innerText()).includes('Klabin'), 'O histórico da obra deve excluir as outras obras.');
  assert(!(await history().innerText()).includes('450'), 'O histórico normal deve excluir estornos e lançamentos cancelados.');
  await choose('Filtrar movimento do produto', 'saida', 'Saídas');
  await expectRows(1);
  assert((await historyRows().innerText()).includes('−385 kg'), 'A saída corrigida deve aparecer com quantidade e sinal.');
  await history().getByText('Edição de romaneio', { exact: true }).waitFor();
  await history().getByText('Quantidade corrigida', { exact: true }).waitFor();
  await page.getByRole('checkbox', { name: 'Mostrar estornos e lançamentos cancelados', exact: true }).check();
  await expectRows(2);
  await history().getByText('Substituída por edição', { exact: true }).waitFor();
  await choose('Filtrar movimento do produto', '', 'Entradas e saídas');
  await expectRows(4);
  await history().getByText('Compensação da edição', { exact: true }).waitFor();
  assert(await historyRows().first().locator('[data-label="Saldo após"]').innerText() === '68 kg', 'O saldo da última linha de auditoria também deve bater com o estoque.');
  const projectRow = page.getByRole('region', { name: 'Movimentação do produto por obra', exact: true }).locator('tbody tr').filter({ hasText: 'Seadrill' });
  assert((await projectRow.innerText()).includes('385 kg') && (await projectRow.innerText()).includes('380 kg'), 'A auditoria não deve alterar os totais por obra.');
  await page.getByRole('checkbox', { name: 'Mostrar estornos e lançamentos cancelados', exact: true }).uncheck();
  await expectRows(2);
  await page.screenshot({ path: 'output/playwright/estoque-produto-desktop.png', fullPage: true });

  await page.getByRole('button', { name: 'Ácido fosfórico 85%', exact: true }).click();
  await page.getByRole('button', { name: 'Carbonato de sódio', exact: true }).click();
  await page.getByText('Este produto ainda não tem movimentações válidas em obras.', { exact: true }).waitFor();
  await page.getByText('Nenhuma movimentação para este produto com os filtros selecionados.', { exact: true }).waitFor();

  await page.getByRole('button', { name: 'Movimentos', exact: true }).click();
  await page.locator('.stock-movements-table tbody tr').first().waitFor();
  assert(await page.locator('.stock-movements-table tbody tr').first().locator('[data-label="Saldo após"]').innerText() === '68 kg', 'A aba de movimentos também deve exibir o saldo acumulado.');
  assert((await page.locator('.stock-movements-table tbody tr').first().innerText()).includes('Edição de romaneio'), 'A compensação da edição deve ter uma tag própria.');
  assert(await page.locator('.stock-movements-table tbody tr').first().locator('td').nth(3).locator('strong').innerText() === 'Ácido fosfórico 85%', 'O nome do produto deve ficar em destaque.');
  await choose('Filtrar tipo', 'saida', 'Saída');
  const type = page.getByRole('combobox', { name: 'Filtrar tipo', exact: true });
  await type.click();
  await type.press('Escape');
  assert(await type.inputValue() === 'Saída', 'Cancelar uma busca deve manter o tipo selecionado.');
  await choose('Filtrar motivo', 'devolucao', 'Devolução de obra');
  await choose('Filtrar projeto', 'seadrill', '5824 — Seadrill');
  await page.getByText('Nenhuma movimentação encontrada.', { exact: true }).waitFor();

  await page.getByText('Controle de regressão do combobox padrão', { exact: true }).click();
  const legacy = page.getByRole('combobox', { name: 'Campo padrão', exact: true });
  await legacy.click();
  assert(await legacy.inputValue() === 'Seleção existente', 'O combobox padrão deve preservar o comportamento anterior.');
  await legacy.press('Escape');

  await page.goto(fixture);
  await page.getByRole('button', { name: 'Ácido fosfórico 85%', exact: true }).click();
  await historyRows().first().waitFor();
  await page.getByRole('button', { name: 'Seadrill 5824 · Ver histórico', exact: true }).click();
  await expectRows(2);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `A tela não pode transbordar em ${width}px.`);
    const field = page.getByRole('combobox', { name: 'Filtrar obra do produto', exact: true });
    await field.click();
    const bounds = await page.getByRole('listbox').boundingBox();
    assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width, 'O filtro deve abrir dentro da tela.');
    await field.press('Escape');
    await page.screenshot({ path: `output/playwright/estoque-produto-${width}.png`, fullPage: true });
  }
  return 'PASS: saldo acumulado nas duas abas, saldo atual com filtros e auditoria, tags de edição do romaneio, busca, paginação, histórico por obra, produto sem movimentos, combobox padrão e layout de 390/320 px.';
}
