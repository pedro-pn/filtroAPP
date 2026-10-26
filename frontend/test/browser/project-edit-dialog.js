async page => {
  const base = page.url().split('/test/')[0];
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(base + '/test/browser/gestor-project-search.html?tab=projetos&service-signers=1');
  const edit = () => page.getByRole('button', { name: 'Editar', exact: true }).first();
  const dialog = () => page.getByRole('dialog', { name: 'Editar projeto', exact: true });
  const name = () => dialog().getByRole('textbox', { name: 'Nome', exact: true }).first();
  await edit().click();
  await dialog().waitFor();
  const desktopBox = await dialog().boundingBox();
  if (!desktopBox || desktopBox.width > 561) throw new Error('Edição não abriu em diálogo compacto.');
  if (await page.locator('main .rdo-project-edit-form').count()) throw new Error('Formulário ainda aparece abaixo da lista.');
  if (!await name().evaluate(node => node === document.activeElement)) throw new Error('Nome não recebeu foco ao editar.');
  await dialog().getByRole('button', { name: 'Salvar projeto', exact: true }).waitFor({ state: 'visible' });

  await name().fill('');
  await dialog().getByRole('button', { name: 'Salvar projeto', exact: true }).click();
  if (await name().evaluate(node => node.validity.valid)) throw new Error('Validação obrigatória foi perdida.');
  await name().fill('VILLARIS atualizado');
  await dialog().getByRole('button', { name: 'Salvar projeto', exact: true }).click();
  await dialog().waitFor({ state: 'hidden' });
  await page.getByRole('rowheader', { name: '5807 - VILLARIS atualizado', exact: true }).waitFor();
  await edit().click();
  if (await name().inputValue() !== 'VILLARIS atualizado') throw new Error('Salvar e reabrir não preservou o projeto.');

  await name().fill('Alteração descartada');
  await dialog().getByRole('button', { name: 'Cancelar edição', exact: true }).click();
  await dialog().waitFor({ state: 'hidden' });
  await edit().click();
  if (await name().inputValue() !== 'VILLARIS atualizado') throw new Error('Cancelar persistiu alterações.');
  await dialog().getByRole('button', { name: 'Fechar', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  if (!await dialog().getByRole('button', { name: 'Salvar projeto', exact: true }).evaluate(node => node === document.activeElement)) {
    throw new Error('O foco saiu do diálogo.');
  }
  await page.keyboard.press('Escape');
  await dialog().waitFor({ state: 'hidden' });
  if (!await edit().evaluate(node => node === document.activeElement)) throw new Error('Fechar não devolveu foco ao botão Editar.');
  if (await page.evaluate(() => document.body.style.overflow === 'hidden')) throw new Error('Fechar manteve a página bloqueada.');

  await edit().click();
  await dialog().getByRole('button', { name: '+ Adicionar segmento', exact: true }).click();
  const segment = page.getByRole('dialog', { name: 'Adicionar segmento', exact: true });
  await segment.waitFor();
  await segment.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await segment.waitFor({ state: 'hidden' });
  if (await name().inputValue() !== 'VILLARIS atualizado') throw new Error('Diálogo auxiliar perdeu a edição do projeto.');
  await dialog().screenshot({ path: 'output/playwright/project-edit-dialog-desktop.png' });

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const box = await dialog().boundingBox();
    if (!box || box.x < 0 || box.x + box.width > width + 1) throw new Error('Diálogo ultrapassa a tela móvel.');
    for (const input of await dialog().locator('input:not([type="checkbox"]), select, table').all()) {
      const bounds = await input.boundingBox();
      if (!bounds || bounds.x < box.x || bounds.x + bounds.width > box.x + box.width + 1) throw new Error('Campo ultrapassa a largura do diálogo.');
    }
    await dialog().getByRole('table', { name: 'Assinantes dos relatórios de serviço', exact: true }).scrollIntoViewIfNeeded();
    if (!await dialog().getByRole('button', { name: 'Salvar projeto', exact: true }).isVisible()) throw new Error('Salvar ficou inacessível ao rolar o formulário.');
    await dialog().screenshot({ path: `output/playwright/project-edit-dialog-${width}.png` });
  }
  await dialog().getByRole('button', { name: 'Fechar', exact: true }).click();
  await dialog().waitFor({ state: 'hidden' });
  return 'PASS: diálogo de 560 px, foco, validação, salvar/reabrir, cancelar, Escape, diálogo auxiliar e layout a 390/320 px.';
}
