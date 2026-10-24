async page => {
  const base = page.url().split('/test/')[0] + '/test/browser/rdo-equipment-categories.html';
  await page.goto(base);
  await page.evaluate(() => sessionStorage.removeItem('rdo-equipment-categories-fixture'));
  await page.reload();
  const first = page.getByRole('region', { name: 'Serviço 1', exact: true });
  const second = page.getByRole('region', { name: 'Serviço 2', exact: true });
  const unit = () => first.getByRole('combobox', { name: 'Unidade de Limpeza Química 1', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Categorias de equipamento' });
  const apply = () => dialog.getByRole('button', { name: 'Aplicar categorias' }).click();
  const values = select => select.locator('option').evaluateAll(nodes => nodes.map(node => node.value).filter(Boolean));
  const assertValues = async (select, expected) => {
    const actual = await values(select);
    if (JSON.stringify(actual.sort()) !== JSON.stringify(expected.sort())) throw new Error(`Unexpected equipment list: ${JSON.stringify(actual)}`);
  };
  await unit().locator('option[value="equipment-chemical"]').waitFor({ state: 'attached' });
  await assertValues(unit(), ['equipment-chemical', 'equipment-flushing']);
  await page.getByRole('button', { name: 'Configuração', exact: true }).click();
  const row = page.locator('.equip-slot-row').filter({ has: page.locator('.equip-slot-name', { hasText: 'Unidade de Limpeza Química' }) });
  await row.getByRole('button', { name: 'Adicionar categoria secundária', exact: true }).click();
  await page.evaluate(() => { window.equipmentCategoryFixture.failSave = true; });
  await row.getByRole('combobox', { name: /^Adicionar categoria secundária/ }).selectOption('filtration');
  await page.locator('.toast-error').waitFor();
  await page.evaluate(() => { window.equipmentCategoryFixture.failSave = false; });
  await row.getByRole('button', { name: 'Adicionar categoria secundária', exact: true }).click();
  await row.getByRole('combobox', { name: /^Adicionar categoria secundária/ }).selectOption('filtration');
  await row.getByRole('combobox', { name: /categoria secundária 1$/ }).waitFor();
  const calls = await page.evaluate(() => window.equipmentCategoryFixture.calls);
  if (JSON.stringify(calls.at(-1).categoryIds) !== JSON.stringify(['chemical', 'flushing'])) throw new Error('Adding secondary changed mixed primary categories');
  await page.getByRole('button', { name: 'Relatório', exact: true }).click();
  await assertValues(unit(), ['equipment-chemical', 'equipment-flushing']);
  await first.getByRole('button', { name: 'Escolher outra categoria', exact: true }).click();
  await dialog.getByRole('checkbox', { name: 'Filtragem', exact: true }).waitFor();
  if (await dialog.getByRole('checkbox', { name: 'Não liberada neste serviço' }).count()) throw new Error('Unlinked category was offered');
  await dialog.getByRole('checkbox', { name: 'Limpeza química', exact: true }).uncheck();
  await dialog.getByRole('checkbox', { name: 'Flushing', exact: true }).uncheck();
  if (!await dialog.getByRole('button', { name: 'Aplicar categorias' }).isDisabled()) throw new Error('Empty selection can be applied');
  await dialog.getByRole('checkbox', { name: 'Filtragem', exact: true }).check();
  await apply();
  await assertValues(unit(), ['equipment-filtration']);
  await unit().selectOption('equipment-filtration');
  if (await second.getByRole('combobox', { name: 'Unidade de Limpeza Química 1', exact: true }).inputValue() !== 'equipment-chemical') throw new Error('Category changed another service');
  await page.getByRole('button', { name: 'Salvar relatório', exact: true }).click();
  await page.getByText('Relatório salvo', { exact: true }).waitFor();
  await page.reload();
  await unit().locator('option[value="equipment-filtration"]').waitFor({ state: 'attached' });
  await assertValues(unit(), ['equipment-filtration']);
  if (await unit().inputValue() !== 'equipment-filtration') throw new Error('Equipment lost on reload');
  await first.getByRole('button', { name: 'Escolher outra categoria', exact: true }).click();
  await dialog.getByRole('checkbox', { name: 'Limpeza química', exact: true }).check();
  await apply();
  await assertValues(unit(), ['equipment-chemical', 'equipment-filtration']);
  if (await unit().inputValue() !== 'equipment-filtration') throw new Error('Mixing categories discarded an allowed selected equipment');
  await first.getByRole('button', { name: /Adicionar unidade/ }).click();
  await first.getByRole('combobox', { name: 'Unidade de Limpeza Química 2', exact: true }).selectOption('equipment-chemical');
  await page.getByRole('button', { name: 'Salvar relatório', exact: true }).click();
  await page.reload();
  await first.getByRole('combobox', { name: 'Unidade de Limpeza Química 2', exact: true }).waitFor();
  if (await unit().inputValue() !== 'equipment-filtration') throw new Error('Mixed equipment lost on reopen');

  const trigger = first.getByRole('button', { name: 'Escolher outra categoria', exact: true });
  await trigger.click();
  for (const width of [1365, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const bounds = await dialog.evaluate(node => ({ width: node.getBoundingClientRect().width, scroll: node.scrollWidth, client: node.clientWidth }));
    if (bounds.width > width || bounds.scroll > bounds.client) throw new Error(`Dialog overflows at ${width}px`);
  }
  await page.screenshot({ path: 'output/playwright/rdo-equipment-categories-mobile.png' });
  await dialog.getByRole('checkbox', { name: 'Flushing', exact: true }).check();
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await assertValues(unit(), ['equipment-chemical', 'equipment-filtration']);
  await trigger.click();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  if (!await trigger.evaluate(node => node === document.activeElement)) throw new Error('Escape did not restore focus');
  await page.getByRole('checkbox', { name: 'Somente leitura', exact: true }).check();
  if (!await trigger.isDisabled()) throw new Error('Read-only report allows category changes');
  await page.getByRole('checkbox', { name: 'Somente leitura', exact: true }).uncheck();
  await page.setViewportSize({ width: 1365, height: 900 });

  const onlyCategory = async (button, name) => {
    await button.click();
    await dialog.waitFor();
    for (const checkbox of await dialog.getByRole('checkbox').all()) await checkbox.uncheck();
    await dialog.getByRole('checkbox', { name, exact: true }).check();
    await apply();
  };
  await first.getByRole('combobox', { name: 'Tipo do serviço 1', exact: true }).selectOption('pressao');
  await onlyCategory(first.getByRole('button', { name: 'Escolher outra categoria', exact: true }).first(), 'Filtragem');
  await assertValues(first.getByRole('combobox', { name: 'Unidade de Teste Hidrostático (UTH) 1', exact: true }), ['equipment-filtration']);
  const manometers = first.getByText(/^Manômetros utilizados/).locator('..');
  await onlyCategory(manometers.getByRole('button', { name: 'Escolher outra categoria' }), 'Manômetros digitais');
  await manometers.getByRole('checkbox', { name: 'MAN-02', exact: true }).check();
  if (await manometers.getByRole('checkbox', { name: 'MAN-01', exact: true }).count()) throw new Error('Manometer category not filtered');

  for (const serviceType of ['flushing', 'filtragem']) {
    await first.getByRole('combobox', { name: 'Tipo do serviço 1', exact: true }).selectOption(serviceType);
    await onlyCategory(first.getByRole('button', { name: 'Escolher outra categoria', exact: true }).first(), serviceType === 'flushing' ? 'Limpeza química' : 'Flushing');
    const label = serviceType === 'flushing' ? 'Unidade de Flushing 1' : 'Unidade de filtragem 1';
    await assertValues(first.getByRole('combobox', { name: label, exact: true }), [serviceType === 'flushing' ? 'equipment-chemical' : 'equipment-flushing']);
    if (serviceType === 'flushing') {
      await first.getByRole('radio', { name: 'Secundário', exact: true }).locator('..').click();
      await onlyCategory(first.getByRole('button', { name: 'Escolher outra categoria', exact: true }).first(), 'Limpeza química');
      await assertValues(first.getByRole('combobox', { name: 'Unidade de filtragem 1', exact: true }), ['equipment-chemical']);
    }
    const particles = first.getByText('Houve contagem de partículas?', { exact: true }).locator('..');
    await particles.getByRole('radio', { name: 'Sim', exact: true }).locator('..').click();
    await onlyCategory(particles.getByRole('button', { name: 'Escolher outra categoria' }), 'Contadores portáteis');
    await assertValues(particles.getByRole('combobox', { name: 'Contador utilizado', exact: false }), ['equipment-counter-alt']);
    const dryer = first.getByText('Houve desidratação?', { exact: true }).locator('..');
    await dryer.getByRole('radio', { name: 'Sim', exact: true }).locator('..').click();
    await onlyCategory(dryer.getByRole('button', { name: 'Escolher outra categoria' }), 'Centrífugas');
    await assertValues(dryer.getByRole('combobox', { name: 'Equipamento de desidratação', exact: false }), ['equipment-dryer-alt']);
  }
  await page.getByRole('button', { name: 'Configuração', exact: true }).click();
  for (const expected of [1, 0]) {
    await row.getByRole('button', { name: /^Remover categoria principal 1 de/ }).click();
    await page.waitForFunction(expected => [...document.querySelectorAll('.equip-slot-row')]
      .find(row => row.querySelector('.equip-slot-name')?.textContent === 'Unidade de Limpeza Química')
      ?.querySelectorAll('select[aria-label*="categoria principal"]').length === expected, expected);
  }
  await page.getByRole('button', { name: 'Relatório', exact: true }).click();
  await first.getByRole('combobox', { name: 'Tipo do serviço 1', exact: true }).selectOption('limpeza');
  await assertValues(unit(), []);
  await onlyCategory(first.getByRole('button', { name: 'Escolher outra categoria', exact: true }), 'Filtragem');
  await assertValues(unit(), ['equipment-filtration']);
  return 'Passed: mixed defaults, secondary settings and retry, multi-category dialog, equipment retention, isolated services, save/reload, keyboard focus, read-only, 1365/390/320px, pressure/manometers, both flushing modes, filtration, counters, dehydration and a slot with only one secondary category.';
}
