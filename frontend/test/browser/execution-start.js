async page => {
  const url = page.url().split('/test/')[0] + '/test/browser/execution-start.html';
  const dialog = () => page.getByRole('dialog', { name: 'Confirmar início da execução', exact: true });
  const confirm = () => dialog().getByRole('button', { name: 'Confirmar e iniciar execução', exact: true });
  const submitted = async () => JSON.parse(await page.getByTestId('execution-start-payload').textContent());

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(url);
  await dialog().waitFor();
  if (await dialog().getByRole('combobox').count()) throw new Error('Ofereceu operador quando ninguém da equipe tem conta habilitada.');
  await dialog().getByText(/Gestor de Contrato será definido como responsável padrão/).waitFor();
  if (!(await confirm().isEnabled())) throw new Error('Bloqueou execução sem candidato a operador.');
  await page.screenshot({ path: 'output/playwright/execution-start-no-operator.png', fullPage: true });
  await confirm().click();
  const noOperator = await submitted();
  if (noOperator.startDate !== '2026-09-12' || Object.hasOwn(noOperator, 'operatorId')) throw new Error('Enviou operador antigo ou data incorreta.');

  await page.goto(url + '?mode=eligible');
  const select = dialog().getByRole('combobox', { name: 'Operador responsável', exact: true });
  await select.waitFor();
  if (!(await confirm().isDisabled())) throw new Error('Equipe habilitada iniciou sem escolher operador.');
  await select.selectOption('bruno');
  await confirm().click();
  if ((await submitted()).operatorId !== 'bruno') throw new Error('Não enviou o operador escolhido.');

  await page.goto(url + '?mode=future');
  const date = dialog().getByRole('textbox', { name: 'Início real da execução', exact: true });
  await date.waitFor();
  if (await date.inputValue()) throw new Error('Usou previsão futura como início real.');
  if (!(await confirm().isDisabled())) throw new Error('Iniciou sem confirmar a data.');
  await date.fill('2026-09-09');
  if (!(await confirm().isDisabled())) throw new Error('Aceitou data anterior à mobilização.');
  await date.fill('2026-09-12');
  await confirm().click();
  if (Object.hasOwn(await submitted(), 'operatorId')) throw new Error('Inventou operador para equipe sem conta.');

  await page.goto(url + '?mode=saving');
  await dialog().waitFor();
  if (!(await dialog().getByRole('button', { name: /Confirmar e iniciar execução/ }).isDisabled())) throw new Error('Permitiu duplicar envio durante salvamento.');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  await dialog().waitFor();
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Rolagem horizontal no celular.');
  await page.screenshot({ path: 'output/playwright/execution-start-mobile.png', fullPage: true });
  await dialog().getByRole('button', { name: 'Cancelar', exact: true }).click();
  if (await submitted() !== null) throw new Error('Cancelar iniciou a execução.');
  return 'PASS: campo oculto sem contas habilitadas, aviso de responsável padrão, início permitido, operador obrigatório quando elegível, datas reais válidas, bloqueio durante envio, cancelamento e celular.';
}
