async page => {
  const url = page.url().split('/test/')[0] + '/test/browser/weekly-progress.html';
  await page.goto(url);
  const panel = page.getByRole('region', { name: 'Metas semanais de avanço', exact: true });
  const current = panel.locator('.mission-weekly-progress-current');
  const state = async (label, values) => {
    await page.waitForFunction(({ label, values }) => {
      const element = document.querySelector('.mission-weekly-progress-current');
      return element?.textContent.includes(label) && JSON.stringify([...element.querySelectorAll('dd')].map(item => item.textContent)) === JSON.stringify(values);
    }, { label, values });
  };
  await panel.getByRole('button', { name: 'Definir meta', exact: true }).click();
  const week = await panel.getByLabel(/^Semana\s*\*?$/).inputValue();
  const planned = () => panel.getByLabel('Avanço previsto para a semana (p.p.)');
  await planned().fill('10');
  await panel.getByRole('button', { name: 'Salvar meta', exact: true }).click();
  await state('Dentro da meta', ['10 p.p.', '10 p.p.', '0 p.p.']);
  for (const [value, label, difference] of [['15', 'Abaixo da meta', '-5 p.p.'], ['5', 'Acima da meta', '+5 p.p.']]) {
    await panel.getByRole('button', { name: 'Definir meta', exact: true }).click();
    await planned().fill(value);
    await panel.getByRole('button', { name: 'Salvar meta', exact: true }).click();
    await state(label, [`${value} p.p.`, '10 p.p.', difference]);
  }
  await panel.getByText('3 versões', { exact: true }).click();
  if (await panel.locator('.mission-weekly-progress-table details > div').count() !== 3) throw new Error('As versões anteriores da meta não foram preservadas.');
  await page.getByRole('button', { name: 'Trocar área', exact: true }).click();
  await state('Acima da meta', ['5 p.p.', '10 p.p.', '+5 p.p.']);
  await page.getByRole('button', { name: 'Alternar permissão', exact: true }).click();
  if (await panel.getByRole('button', { name: /Definir|Editar/ }).count()) throw new Error('Visualizador recebeu controles de edição.');
  await page.getByRole('button', { name: 'Alternar permissão', exact: true }).click();
  await page.getByRole('button', { name: 'Simular conflito na próxima gravação', exact: true }).click();
  await panel.getByRole('button', { name: 'Definir meta', exact: true }).click();
  await planned().fill('20');
  await panel.getByRole('button', { name: 'Salvar meta', exact: true }).click();
  await panel.getByRole('alert').waitFor();
  if (!(await panel.getByRole('alert').textContent()).includes('alterada por outra pessoa')) throw new Error('Conflito não foi informado.');
  if (await panel.getByRole('button', { name: 'Salvar meta', exact: true }).count()) throw new Error('Edição desatualizada permaneceu aberta.');
  await state('Acima da meta', ['5 p.p.', '10 p.p.', '+5 p.p.']);
  await panel.getByRole('button', { name: 'Definir meta', exact: true }).click();
  const future = new Date(`${week}T00:00:00Z`);
  future.setUTCDate(future.getUTCDate() + 7);
  await panel.getByLabel(/^Semana\s*\*?$/).fill(future.toISOString().slice(0, 10));
  await planned().fill('0');
  await panel.getByRole('button', { name: 'Salvar meta', exact: true }).click();
  await panel.getByText('Semana futura', { exact: true }).waitFor();
  await state('Acima da meta', ['5 p.p.', '10 p.p.', '+5 p.p.']);
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (overflow) throw new Error('A tabela de metas causou transbordamento horizontal da página no celular.');
  const tableOverflow = await panel.getByRole('region', { name: 'Comparativo semanal de avanço' }).evaluate(element => element.scrollWidth > element.clientWidth);
  if (tableOverflow) throw new Error('O comparativo de metas ainda tem rolagem horizontal no celular.');
  if (!(await current.textContent()).includes('10 p.p.')) throw new Error('O realizado desapareceu no celular.');
  return 'Cadastro, comparação, versões, compartilhamento entre áreas, permissão, conflito, semana futura e layout móvel passaram.';
}
