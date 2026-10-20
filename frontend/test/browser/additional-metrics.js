async page => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const open = async code => {
    await page.getByRole('button', { name: `Ver contribuição da proposta adicional ${code}`, exact: true }).click();
    await page.getByRole('dialog').getByRole('checkbox').first().waitFor();
  };
  const dialog = () => page.getByRole('dialog');
  const included = async () => dialog().getByRole('checkbox').evaluateAll(inputs => inputs.map(input => input.checked));
  const expand = async () => {
    const details = page.locator('.acp-detail-proposal-details');
    await details.waitFor();
    if (await details.getAttribute('open') === null) await details.locator('summary').click();
  };
  await page.evaluate(() => sessionStorage.removeItem('additional-metrics-browser-fixture'));
  await page.goto('http://127.0.0.1:5188/test/browser/additional-metrics.html?mode=gestor');
  await page.getByRole('combobox', { name: 'Revisão da proposta adicional 11', exact: true }).waitFor();
  assert(await page.getByRole('button', { name: /Ver contribuição/ }).count() === 0, 'Gestor não contém o botão');
  await page.goto('http://127.0.0.1:5188/test/browser/additional-metrics.html');
  await expand();
  await open('11');
  assert((await included()).every(Boolean), 'adicionais existentes começam considerando todos os campos');
  assert((await dialog().innerText()).includes('50%'), 'percentual do projeto é explicado');
  await dialog().getByRole('checkbox', { name: 'Dias de trabalho previstos', exact: true }).uncheck();
  await dialog().getByRole('checkbox', { name: 'Orçamento previsto', exact: true }).uncheck();
  await dialog().getByRole('button', { name: 'Cancelar', exact: true }).click();
  await open('11');
  assert((await included()).every(Boolean), 'cancelar descarta a edição');
  await dialog().getByRole('checkbox', { name: 'Dias corridos previstos (totais)', exact: true }).uncheck();
  await dialog().getByRole('checkbox', { name: 'Dias de trabalho previstos', exact: true }).uncheck();
  await dialog().getByRole('checkbox', { name: 'Orçamento previsto', exact: true }).uncheck();
  await dialog().getByRole('button', { name: 'Salvar contribuição', exact: true }).click();
  await dialog().waitFor({ state: 'hidden' });
  assert((await page.locator('.acp-story-amount').innerText()).includes('4.500,00'), 'salvar atualiza o orçamento no dashboard');
  await page.reload();
  await expand();
  await open('11');
  assert(JSON.stringify(await included()) === JSON.stringify([false, false, false, true, true, true, true]), 'a seleção persiste ao reabrir e recarregar');
  await dialog().getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('button', { name: 'Simular falha ao salvar', exact: true }).click();
  await open('11');
  await dialog().getByRole('button', { name: 'Desconsiderar todos', exact: true }).click();
  await dialog().getByRole('button', { name: 'Salvar contribuição', exact: true }).click();
  await dialog().getByRole('alert').waitFor();
  assert((await dialog().getByRole('alert').innerText()).includes('Cliente/CNPJ do adicional não corresponde ao projeto.'),
    'falha exibe o motivo retornado pela API junto ao botão de salvar');
  assert(await dialog().locator('.fv-modal__footer').getByRole('alert').isVisible(), 'erro permanece visível no rodapé');
  assert((await included()).every(value => !value), 'falha conserva o rascunho para tentar novamente');
  await dialog().getByRole('button', { name: 'Salvar contribuição', exact: true }).click();
  await dialog().waitFor({ state: 'hidden' });
  await open('11');
  assert((await included()).every(value => !value), 'adicional zerado continua acessível para reativação');
  await dialog().getByRole('button', { name: 'Cancelar', exact: true }).click();
  await open('12');
  assert((await included()).every(Boolean), 'cada adicional tem configuração independente');
  await dialog().getByRole('button', { name: 'Desconsiderar todos', exact: true }).click();
  await dialog().getByRole('button', { name: 'Salvar contribuição', exact: true }).click();
  await dialog().waitFor({ state: 'hidden' });
  assert(await page.getByRole('button', { name: /Ver contribuição da proposta adicional/ }).count() === 2,
    'composição permanece disponível mesmo com todos os valores desconsiderados');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await open('12');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'layout não transborda no celular');
    await dialog().getByRole('button', { name: 'Considerar todos', exact: true }).click();
    assert((await included()).every(Boolean), 'atalho restaura todos os campos');
    await page.screenshot({ path: `output/playwright/additional-metrics-${width}.png`, fullPage: true });
    await dialog().getByRole('button', { name: 'Cancelar', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Simular falha ao salvar', exact: true }).click();
  await open('12');
  await dialog().getByRole('checkbox', { name: 'Orçamento previsto', exact: true }).uncheck();
  await dialog().getByRole('button', { name: 'Salvar contribuição', exact: true }).click();
  await dialog().getByRole('alert').waitFor();
  const errorBox = await dialog().getByRole('alert').boundingBox();
  assert(errorBox && errorBox.y >= 0 && errorBox.y + errorBox.height <= 844,
    'motivo da falha fica visível junto ao salvar também no celular');
  assert(await dialog().getByRole('checkbox', { name: 'Orçamento previsto', exact: true }).isChecked() === false,
    'falha mantém a alteração individual para nova tentativa');
  await dialog().getByRole('button', { name: 'Salvar contribuição', exact: true }).click();
  await dialog().waitFor({ state: 'hidden' });
  await page.goto('http://127.0.0.1:5188/test/browser/additional-metrics.html?readonly');
  await expand();
  await open('11');
  assert(await dialog().getByRole('button', { name: 'Salvar contribuição' }).count() === 0, 'consulta sem permissão não oferece salvar');
  assert(await dialog().getByRole('checkbox').evaluateAll(inputs => inputs.every(input => input.disabled)), 'consulta preserva campos somente para leitura');
  return 'Botão somente no Acompanhamento, cancelamento, persistência, atualização do dashboard, falha/retry, reativação, permissões e layout 390/320 passaram.';
}
