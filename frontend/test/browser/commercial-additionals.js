async page => {
  await page.goto('http://127.0.0.1:5193/test/browser/commercial-additionals.html');
  const principal = page.getByRole('combobox', { name: 'Revisão do ComercialAPP', exact: true });
  await principal.waitFor();
  if (await principal.inputValue() !== 'main-500-0') throw new Error('Principal incorreta');
  const a = page.locator('.acp-additional-proposal-row').filter({ hasText: 'Adicional 502' });
  const b = page.locator('.acp-additional-proposal-row').filter({ hasText: 'Adicional 503' });
  await a.getByRole('combobox').selectOption('a-502-1');
  await a.locator('summary').click();
  await a.getByRole('checkbox', { name: 'Horas previstas (normais e extras)', exact: true }).uncheck();
  if (!await a.getByRole('button', { name: 'Adicional 502 Rev 1.pdf' }).isVisible()) throw new Error('Documento da revisão ausente');
  await a.getByRole('button', { name: 'Selecionar contribuição', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Selecionar contribuição', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.acp-additional-proposal-row')?.textContent?.includes('Selecionada: revisão 1'));
  let writes = await page.evaluate(() => window.commercialWrites);
  if (writes[0].externalId !== 'a-502-1' || writes[0].expectedSelectionVersion !== 1 || writes[0].metricInclusion.hours !== false) throw new Error('Seleção sem identidade, versão ou métrica');
  if (await principal.inputValue() !== 'main-500-0' || !await b.getByText('Selecionada: revisão 0', { exact: false }).isVisible()) throw new Error('Principal ou B alterados');
  await a.getByRole('combobox').selectOption('a-502-0');
  await a.getByRole('button', { name: 'Selecionar contribuição', exact: true }).click();
  const dialog = page.getByRole('dialog');
  if (!await dialog.getByRole('button', { name: 'Selecionar contribuição', exact: true }).isDisabled()) throw new Error('Rollback sem motivo autorizado');
  await dialog.getByRole('textbox').fill('Conferência explícita da revisão anterior');
  await dialog.getByRole('button', { name: 'Selecionar contribuição', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.acp-additional-proposal-row')?.textContent?.includes('Selecionada: revisão 0'));
  writes = await page.evaluate(() => window.commercialWrites);
  if (!writes[1].allowOlderRevision || writes[1].expectedSelectionVersion !== 2 || !writes[1].reason) throw new Error('Rollback sem comando explícito');
  await a.getByRole('button', { name: 'Remover contribuição', exact: true }).click();
  if (!await dialog.getByRole('button', { name: 'Confirmar remoção', exact: true }).isDisabled()) throw new Error('Remoção sem motivo');
  await dialog.getByRole('textbox').fill('Remoção operacional conferida');
  await dialog.getByRole('button', { name: 'Confirmar remoção', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.acp-additional-proposal-row')?.textContent?.includes('Aguardando seleção'));
  await page.getByText('Consultar extra escopo no ComercialAPP', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Número do adicional', exact: true }).fill('504');
  await page.getByRole('spinbutton', { name: 'Revisão', exact: true }).fill('2');
  await page.getByRole('button', { name: 'Consultar adicional', exact: true }).click();
  await page.waitForFunction(() => window.commercialWrites.length === 4);
  writes = await page.evaluate(() => window.commercialWrites);
  if (writes[3].proposalCode !== '504' || writes[3].revisionNumber !== 2) throw new Error('Consulta incorreta');
  if (await principal.inputValue() !== 'main-500-0') throw new Error('Principal substituída');
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error(`Overflow em ${width}`);
    await page.screenshot({ path: `output/playwright/commercial-additionals-${width}.png`, fullPage: true });
  }
  console.log(JSON.stringify({ result: 'passed', actions: writes, principal: await principal.inputValue() }));
}
