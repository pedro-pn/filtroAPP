async (page) => {
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const base = new URL('/test/browser/signature-batch.html?novelty=1', page.url()).toString();
  const userId = 'signature-batch-novelty-browser';
  const key = `filtrovali:assinaturas-sharing-novelty:v1:${userId}`;
  const tutorialKey = `filtrovali:assinaturas-tutorial:v1:${userId}`;
  await page.clock.install({ time: new Date('2026-11-04T12:00:00-03:00') });
  await page.goto(base);
  await page.evaluate(({ key, tutorialKey }) => {
    localStorage.removeItem(key);
    localStorage.removeItem(tutorialKey);
    sessionStorage.removeItem('signature-batch-fixture');
  }, { key, tutorialKey });
  await page.reload();
  const title = page.locator('.driver-popover-title');
  await title.filter({ hasText: '1. Envie os PDFs' }).waitFor();
  await page.waitForTimeout(1600);
  assert(await page.evaluate(key => localStorage.getItem(key), key) === null, 'aguardar o onboarding não deve consumir a campanha');
  await page.locator('.driver-popover-close-btn').click();
  await title.filter({ hasText: 'Novidade: compartilhar documentos' }).waitFor();
  await page.waitForFunction(key => localStorage.getItem(key) === '1', key);
  await page.locator('.driver-popover-next-btn').click();
  await title.filter({ hasText: 'Comece com um PDF' }).waitFor();
  assert(await page.evaluate(() => document.querySelector('.driver-active-element')?.hasAttribute('data-signature-new-document')), 'sem documento próprio, o guia aponta o envio de PDF');
  await page.locator('.driver-popover-next-btn').click();
  await title.filter({ hasText: 'Você define o acesso' }).waitFor();
  const description = await page.locator('.driver-popover-description').innerText();
  assert(description.includes('Apenas visualizar') && description.includes('Pode editar') && description.includes('rascunho'), 'explicar as duas permissões e os limites da edição');
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'o aviso deve caber no celular');
  await page.screenshot({ path: 'output/playwright/assinaturas-compartilhamento-novidade-mobile.png', animations: 'disabled' });
  await page.locator('.driver-popover-next-btn').click();
  await page.reload();
  await page.waitForTimeout(1600);
  assert(await title.count() === 0, 'não repetir para quem já viu');

  await page.evaluate(key => localStorage.removeItem(key), key);
  await page.reload();
  await page.getByRole('button', { name: 'Novo documento', exact: true }).first().click();
  await page.getByRole('dialog', { name: 'Novos documentos' }).waitFor();
  await page.waitForTimeout(1600);
  assert(await title.count() === 0, 'não sobrepor o formulário de upload');
  assert(await page.evaluate(key => localStorage.getItem(key), key) === null, 'um formulário aberto não pode marcar a campanha como vista');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await title.filter({ hasText: 'Novidade: compartilhar documentos' }).waitFor();
  await page.locator('.driver-popover-close-btn').click();

  await page.evaluate(key => {
    localStorage.removeItem(key);
    const document = { id: 'doc-1', batchId: 'batch', title: 'Contrato de teste', originalFileName: 'contrato.pdf', status: 'RASCUNHO',
      pageCount: 1, signers: [], fields: [], archivedAt: null, progress: { signed: 0, total: 0 }, signerCount: 0, signedCount: 0,
      createdAt: '2026-11-04T12:00:00Z', pageDimensions: [{ page: 1, widthPt: 612, heightPt: 792, rotation: 0 }] };
    sessionStorage.setItem('signature-batch-fixture', JSON.stringify({ batch: { id: 'batch', signers: [], invitations: [], documents: [document] }, uploads: [], failOnce: false, publication: null }));
  }, key);
  await page.goto(base);
  await title.filter({ hasText: 'Novidade: compartilhar documentos' }).waitFor();
  await page.locator('.driver-popover-next-btn').click();
  await title.filter({ hasText: 'Abra um documento seu' }).waitFor();
  assert(await page.evaluate(() => document.querySelector('.driver-active-element')?.hasAttribute('data-signature-share-document')), 'o guia aponta um documento próprio na biblioteca');
  await page.locator('.driver-popover-close-btn').click();
  await page.evaluate(key => localStorage.removeItem(key), key);
  await page.goto(`${base}&lote=batch`);
  await page.getByRole('button', { name: 'Compartilhar', exact: true }).first().click();
  const sharingDialog = page.getByRole('dialog', { name: 'Compartilhar documento' });
  await sharingDialog.waitFor();
  await page.waitForTimeout(1600);
  assert(await title.count() === 0, 'aguardar o formulário de compartilhamento sem sobrepor o aviso');
  assert(await page.evaluate(key => localStorage.getItem(key), key) === null, 'aguardar o compartilhamento não deve consumir a campanha');
  await sharingDialog.getByRole('button', { name: 'Fechar', exact: true }).last().click();
  await title.filter({ hasText: 'Novidade: compartilhar documentos' }).waitFor();
  await page.locator('.driver-popover-next-btn').click();
  await title.filter({ hasText: 'Use o botão Compartilhar' }).waitFor();
  assert(await page.evaluate(() => document.querySelector('.driver-active-element')?.hasAttribute('data-signature-share')), 'no lote, o guia aponta o botão real de compartilhamento');
  await page.locator('.driver-popover-close-btn').click();

  await page.evaluate(key => localStorage.removeItem(key), key);
  await page.clock.setSystemTime(new Date('2026-11-08T23:59:55-03:00'));
  await page.goto(base);
  await title.filter({ hasText: 'Novidade: compartilhar documentos' }).waitFor();
  await page.clock.fastForward(5000);
  assert(await title.count() === 0, 'um aviso aberto também deve encerrar ao expirar a campanha');
  await page.evaluate(key => localStorage.removeItem(key), key);
  await page.goto(base);
  await page.waitForTimeout(1600);
  assert(await title.count() === 0, 'depois de cinco dias, não mostrar nem para quem nunca viu');
  assert(await page.evaluate(key => localStorage.getItem(key), key) === null, 'a campanha expirada não grava visto');
  return { passed: true, checks: ['cinco dias', 'onboarding preservado', 'exibição única', 'modal sem sobreposição', 'controles reais', 'permissões explicadas', 'mobile', 'encerramento e expiração global'] };
}
