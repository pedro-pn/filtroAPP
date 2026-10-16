async page => {
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const base = page.url().split('/test/')[0] + '/test/browser/signature-batch.html?mode=public#convite=' + 'a'.repeat(64);
  await page.setViewportSize({ width: 1365, height: 1000 });
  await page.goto(base);
  await page.getByRole('heading', { name: 'Assinatura de 2 documentos', exact: true }).waitFor();
  assert(!page.url().includes('#convite='), 'O segredo deve sair da URL após a leitura');
  assert(await page.locator('.signature-batch-document').count() === 2, 'O convite deve exibir os dois PDFs separados');
  const navigation = page.getByRole('navigation', { name: 'Navegação entre documentos' });
  assert(await navigation.evaluate(element => !element.closest('.signature-pdf-scroll')), 'O cabeçalho deve ficar fora da área do PDF');
  await navigation.getByRole('button', { name: 'Próximo documento' }).click();
  assert(await navigation.getByRole('combobox').inputValue() === 'doc-2', 'Próximo deve avançar diretamente ao documento seguinte');
  await navigation.getByRole('button', { name: 'Documento anterior' }).click();
  await page.screenshot({ path: 'output/playwright/assinaturas-convite-agrupado-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'O convite não deve ultrapassar a largura do celular');
  await page.screenshot({ path: 'output/playwright/assinaturas-convite-agrupado-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Assinar todos os documentos', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Assinar documentos do convite', exact: true });
  await dialog.waitFor();
  assert(await dialog.getByText(/sua assinatura será aplicada aos 2 documento/).count() === 1, 'A confirmação deve indicar todos os documentos do convite');
  await dialog.getByRole('button', { name: 'Enviar imagem', exact: true }).click();
  await dialog.locator('input[type=file]').setInputFiles({ name: 'assinatura.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64') });
  await dialog.getByRole('checkbox', { name: /Li e estou ciente/ }).check();
  await dialog.getByRole('button', { name: 'Confirmar assinatura', exact: true }).click();
  await page.getByRole('button', { name: 'Baixar Contrato 1', exact: true }).waitFor();
  assert(await page.evaluate(() => window.signatureGroupPublicFixture.signatureRequests) === 1, 'Deve haver uma única confirmação de assinatura');
  assert(await page.getByRole('button', { name: 'Assinar todos os documentos', exact: true }).count() === 0, 'A assinatura não deve ser reenviada após o sucesso');
  for (const index of [1, 2]) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: `Baixar Contrato ${index}`, exact: true }).click();
    assert((await download).suggestedFilename() === `Contrato ${index}-assinado.pdf`, 'Cada PDF deve ter seu próprio arquivo');
  }
  assert((await page.evaluate(() => window.signatureGroupPublicFixture.downloads)).join(',') === 'doc-1,doc-2', 'Cada download deve solicitar seu próprio documento');
  return { passed: true, checks: ['convite com múltiplos documentos', 'navegação externa desktop/mobile', 'uma confirmação', 'dois downloads separados', 'segredo removido da URL'] };
}
