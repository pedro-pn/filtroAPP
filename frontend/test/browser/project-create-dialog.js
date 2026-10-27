async page => {
  const base = page.url().split('/test/')[0];
  const url = base + '/test/browser/gestor-project-search.html?tab=projetos';
  const open = () => page.getByRole('button', { name: 'Novo projeto', exact: true });
  const dialog = () => page.getByRole('dialog', { name: 'Novo projeto', exact: true });
  const create = () => dialog().getByRole('button', { name: /^Criar projeto/ });
  const requests = () => page.evaluate(() => window.projectCreateRequests);
  const fill = async () => {
    await dialog().getByRole('textbox', { name: 'Número da missão', exact: true }).fill('6001');
    await dialog().getByRole('textbox', { name: 'Nome', exact: true }).first().fill('Novo projeto no diálogo');
    await dialog().getByRole('textbox', { name: 'Cliente', exact: true }).fill('Cliente novo');
    await dialog().getByRole('textbox', { name: 'CNPJ', exact: true }).fill('12345678000190');
    await dialog().getByRole('textbox', { name: 'Local da obra', exact: true }).fill('São Paulo');
  };

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(url);
  await open().click();
  await dialog().waitFor();
  const box = await dialog().boundingBox();
  if (!box || box.width > 561) throw new Error('Criação não abriu em diálogo compacto.');
  if (await page.locator('main #project-create-form').count()) throw new Error('Criação ainda aparece na página.');
  const code = dialog().getByRole('textbox', { name: 'Número da missão', exact: true });
  if (!await code.evaluate(node => node === document.activeElement)) throw new Error('Campo inicial não recebeu foco.');
  await create().click();
  if (await code.evaluate(node => node.validity.valid)) throw new Error('Perdeu validação obrigatória.');
  if ((await requests()).length) throw new Error('Enviou formulário inválido.');
  await fill();
  await dialog().getByRole('button', { name: '+ Adicionar segmento', exact: true }).click();
  const segment = page.getByRole('dialog', { name: 'Adicionar segmento', exact: true });
  await segment.waitFor();
  await segment.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await segment.waitFor({ state: 'hidden' });
  if (await code.inputValue() !== '6001') throw new Error('Diálogo auxiliar perdeu o cadastro.');
  await dialog().screenshot({ path: 'output/playwright/project-create-dialog-desktop.png' });

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const bounds = await dialog().boundingBox();
    if (!bounds || bounds.x < 0 || bounds.x + bounds.width > width + 1) throw new Error('Diálogo ultrapassa a tela móvel.');
    for (const input of await dialog().locator('input:not([type="checkbox"]), select, table').all()) {
      const rect = await input.boundingBox();
      if (rect && (rect.x < bounds.x || rect.x + rect.width > bounds.x + bounds.width + 1)) throw new Error('Campo ultrapassa o diálogo.');
    }
    await dialog().getByLabel('Inclui domingo', { exact: true }).scrollIntoViewIfNeeded();
    if (!await create().isVisible()) throw new Error('Criar ficou inacessível ao rolar.');
    await dialog().screenshot({ path: `output/playwright/project-create-dialog-${width}.png` });
  }
  await create().click();
  await dialog().waitFor({ state: 'hidden' });
  await page.getByText('6001 - Novo projeto no diálogo', { exact: true }).first().waitFor();
  const payload = (await requests())[0];
  if (payload.code !== '6001' || payload.name !== 'Novo projeto no diálogo' || payload.clientName !== 'Cliente novo') throw new Error('Criação enviou dados incorretos.');

  await open().click();
  if (await dialog().getByLabel('Número da missão', { exact: true }).inputValue()) throw new Error('Novo cadastro reutilizou os dados anteriores.');
  await dialog().getByLabel('Número da missão', { exact: true }).fill('Descartar');
  await dialog().getByRole('button', { name: 'Cancelar', exact: true }).click();
  await dialog().waitFor({ state: 'hidden' });
  await open().click();
  if (await dialog().getByLabel('Número da missão', { exact: true }).inputValue()) throw new Error('Cancelar preservou rascunho descartado.');
  await page.keyboard.press('Escape');
  await dialog().waitFor({ state: 'hidden' });
  if (!await open().evaluate(node => node === document.activeElement)) throw new Error('Fechar não devolveu foco ao botão Novo projeto.');
  if ((await requests()).length !== 1) throw new Error('Cancelar ou Escape criou projeto.');

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(url + '&create-error=1');
  await open().click();
  await fill();
  await create().click();
  await page.getByText('Falha simulada ao criar projeto.', { exact: true }).waitFor();
  if (!await dialog().isVisible() || await dialog().getByLabel('Número da missão', { exact: true }).inputValue() !== '6001') throw new Error('Falha apagou o cadastro.');
  await create().click();
  await dialog().waitFor({ state: 'hidden' });

  await page.goto(url + '&create-delay=1');
  await open().click();
  await fill();
  await create().click();
  await page.waitForFunction(() => document.querySelector('button[form="project-create-form"]')?.getAttribute('aria-busy') === 'true');
  if (!await create().isDisabled()) throw new Error('Permitiu duplicar a criação durante envio.');
  if (!await dialog().getByRole('button', { name: 'Cancelar', exact: true }).isDisabled()) throw new Error('Permitiu cancelar durante envio.');
  await page.keyboard.press('Escape');
  if (!await dialog().isVisible()) throw new Error('Escape fechou durante envio.');
  await page.evaluate(() => window.finishProjectCreate());
  await dialog().waitFor({ state: 'hidden' });
  if ((await requests()).length !== 1) throw new Error('Duplicou a criação.');
  return 'PASS: diálogo compacto, foco, validações, criação, cancelamento e Escape, formulário limpo, segmento, falha e retry, envio único e layout a 390/320 px.';
}
