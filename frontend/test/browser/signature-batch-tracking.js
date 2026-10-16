async (page) => {
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const base = page.url().split('/test/')[0] + '/test/browser/signature-batch.html';
  await page.goto(base);
  await page.getByRole('region', { name: 'Biblioteca de documentos', exact: true }).waitFor();
  // O upload/editor já deixou dois documentos publicados. Agora Ana participa nos dois e Bia só no primeiro.
  await page.evaluate(() => {
    const state = window.signatureBatchFixture;
    const [first, second] = state.batch.documents;
    const ana = first.signers.find(signer => signer.batchSignerId === state.batch.signers[0].id);
    const bia = [...first.signers, ...second.signers].find(signer => signer.batchSignerId === state.batch.signers[1].id);
    first.signers = [{ ...ana, status: 'PENDENTE' }, { ...bia, id: `doc-1-${bia.batchSignerId}`, status: 'PENDENTE' }];
    first.progress = { signed: 0, total: 2 };
    second.signers = [{ ...ana, id: `doc-2-${ana.batchSignerId}`, status: 'ASSINADO', signedAt: new Date().toISOString() }];
    second.progress = { signed: 1, total: 1 };
    second.status = 'CONCLUIDO';
    sessionStorage.setItem('signature-batch-fixture', JSON.stringify(state));
  });
  await page.addInitScript(() => {
    window.copiedBatchLinks = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => window.copiedBatchLinks.push(text) } });
  });
  await page.reload();
  await page.setViewportSize({ width: 1440, height: 1000 });
  const card = page.locator('[data-signature-document="batch"]');
  await card.waitFor();
  assert(await page.locator('[data-signature-document]').count() === 1, 'Status mistos devem manter um único card');
  assert(await card.locator('.assinaturas-batch-document').count() === 2, 'Os dois PDFs precisam estar dentro do lote');
  await card.click();
  await page.getByRole('heading', { name: 'Acompanhamento do lote', exact: true }).waitFor();
  const ana = page.getByRole('region', { name: 'Assinante Ana Souza', exact: true });
  const bia = page.getByRole('region', { name: 'Assinante Bia Souza', exact: true });
  assert(await page.getByRole('button', { name: 'Copiar link de Ana Souza', exact: true }).count() === 1, 'Ana deve ter só um botão de cópia');
  assert(await ana.getByRole('listitem').count() === 2, 'Ana deve listar os dois PDFs');
  assert(await bia.getByRole('listitem').count() === 1, 'Bia deve listar apenas o primeiro PDF');
  await page.getByRole('button', { name: 'Copiar link de Ana Souza', exact: true }).click();
  await page.waitForFunction(() => window.copiedBatchLinks.length === 1);
  await page.getByRole('button', { name: 'Copiar link de Ana Souza', exact: true }).click();
  await page.waitForFunction(() => window.copiedBatchLinks.length === 2);
  const links = await page.evaluate(() => window.copiedBatchLinks);
  assert(links[0] === links[1] && links[0].includes('#convite='), 'Copiar não pode gerar convites diferentes');
  assert(await page.getByRole('button', { name: 'Baixar PDF de segundo', exact: true }).count() === 1, 'PDF concluído possui download separado');
  await page.screenshot({ path: 'output/playwright/assinaturas-lote-acompanhamento-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Abrir documento primeiro', exact: true }).click();
  await page.getByRole('button', { name: 'Ver assinantes e links do lote', exact: true }).waitFor();
  assert(await page.getByRole('button', { name: /Copiar link de/ }).count() === 0, 'Documento individual não deve duplicar convites do lote');
  await page.getByRole('button', { name: 'Ver assinantes e links do lote', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('heading', { name: 'Acompanhamento do lote', exact: true }).waitFor();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Acompanhamento mobile sem overflow');
  await page.screenshot({ path: 'output/playwright/assinaturas-lote-acompanhamento-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Voltar', exact: true }).click();
  await page.getByRole('region', { name: 'Biblioteca de documentos', exact: true }).waitFor();
  assert(await page.locator('[data-signature-document]').count() === 1, 'Retorno deve preservar um único card');
  await page.screenshot({ path: 'output/playwright/assinaturas-lote-card-mobile.png', fullPage: true });
  return { passed: true, checks: ['um card por lote com status mistos', 'documentos dentro do card', 'um link por assinante', 'participação independente', 'cópia estável', 'sem convites duplicados em documento', 'download individual', 'retorno para lote', 'mobile sem overflow'] };
}
