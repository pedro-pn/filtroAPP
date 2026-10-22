async page => {
  const base = page.url().split('/test/')[0] + '/test/browser/gestor-project-search.html';
  await page.goto(base + '?tab=projetos&pending=1&revisar=active-villaris');
  const form = page.locator('.pending-project-review-form');
  await form.waitFor();
  if (await form.getByLabel('Número do projeto', { exact: true }).inputValue() !== '5807') throw new Error('A notificação não abriu a revisão do projeto correto.');
  await form.getByRole('button', { name: 'Confirmar e salvar', exact: true }).waitFor();
  if (!await form.getByLabel('Nome do projeto', { exact: true }).evaluate(node => node === document.activeElement)) throw new Error('O formulário de revisão não recebeu foco.');
  await form.getByRole('button', { name: 'Cancelar revisão', exact: true }).click();
  await form.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Revisar', exact: true }).click();
  await form.waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'output/playwright/project-notification-review-mobile.png' });
  return 'PASS: link da notificação abre a revisão do projeto correto, com foco, cancelamento, reabertura e visualização no celular.';
}
