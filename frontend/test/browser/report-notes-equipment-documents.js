async page => {
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const origin = new URL(page.url()).origin;
  const requests = [];
  let single = false;
  const reports = [42, 43].map(number => ({ signatureId: `signature-${number}`, status: 'ACTIVE',
    signer: { name: 'Marina Costa', email: 'marina@example.com', prefillName: true, status: 'PENDING' },
    report: { id: `report-${number}`, reportType: 'RDO', sequenceNumber: number, reportDate: '2026-10-20', status: 'APPROVED',
      sourceDocumentHash: 'a'.repeat(64), project: { code: '5800', name: 'Projeto de teste', clientName: 'Cliente' } } }));
  await page.unroute('**/api/**');
  await page.route(`${origin}/api/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.includes('/public-sign/notes-test')) return route.fulfill({ status: 401, json: {} });
    if (url.pathname.endsWith('/pdf')) return route.fulfill({ path: 'frontend/src/assets/previews/rdo-assinatura-exemplo.pdf', contentType: 'application/pdf' });
    const items = single ? reports.slice(0, 1) : reports;
    if (request.method() === 'GET') return route.fulfill({ json: { status: reports[0].status,
      signer: { ...reports[0].signer, signatureId: reports[0].signatureId }, report: reports[0].report,
      batch: { project: reports[0].report.project, pendingCount: items.filter(item => item.status === 'ACTIVE').length, reports: items } } });
    const payload = request.postDataJSON();
    requests.push(payload);
    const ids = payload.signatureIds || [payload.signatureId];
    items.filter(item => ids.includes(item.signatureId)).forEach(item => { item.status = 'SIGNED'; });
    return route.fulfill({ json: payload.signatureIds ? { results: ids.map(signatureId => ({ signatureId, success: true, completed: true })), emailDelivery: { status: 'queued' } }
      : { success: true, completed: true, report: items[0].report, emailDelivery: { status: 'queued' } } });
  });
  const confirm = async () => {
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nome e sobrenome do signatário').fill('Marina Costa');
    await dialog.getByRole('button', { name: 'Enviar imagem', exact: true }).click();
    await dialog.locator('input[type=file]').setInputFiles({ name: 'assinatura.png', mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64') });
    await dialog.getByRole('button', { name: 'Confirmar assinatura', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
  };
  await page.setViewportSize({ width: 1365, height: 1000 });
  await page.goto(`${origin}/assinar/notes-test`);
  await page.getByLabel('Nota do cliente · RDO 42').fill('Primeira observação.');
  const nav = page.getByRole('navigation', { name: 'Relatórios do projeto' });
  await nav.getByRole('button', { name: /RDO 43/ }).click();
  await page.getByLabel('Nota do cliente · RDO 43').fill('Segunda observação.');
  await nav.getByRole('button', { name: /RDO 42/ }).click();
  assert(await page.getByLabel('Nota do cliente · RDO 42').inputValue() === 'Primeira observação.', 'Trocar o RDO deve preservar sua nota');
  await page.getByLabel('Li e estou ciente do tratamento dos meus dados para assinatura eletrônica.').check();
  await page.getByRole('button', { name: 'Assinar todos (2)' }).click();
  const confirmation = page.getByRole('dialog');
  assert(await confirmation.getByText('Nota: Primeira observação.').count() === 1, 'A confirmação mostra a primeira nota');
  assert(await confirmation.getByText('Nota: Segunda observação.').count() === 1, 'A confirmação mostra a segunda nota');
  await confirm();
  assert(requests[0].comments['signature-42'] === 'Primeira observação.' && requests[0].comments['signature-43'] === 'Segunda observação.', 'Cada assinatura recebe a nota do seu RDO');
  single = true;
  reports[0].status = 'ACTIVE';
  await page.goto(`${origin}/assinar/notes-test`);
  await page.getByLabel('Nota do cliente · RDO 42').fill('Nota do relatório individual.');
  await page.getByLabel('Li e estou ciente do tratamento dos meus dados para assinatura eletrônica.').check();
  await page.locator('.public-report-document__paper img').first().waitFor({ state: 'visible' });
  await page.getByLabel('Nota do cliente · RDO 42').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'output/playwright/assinatura-nota-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('Nota do cliente · RDO 42').scrollIntoViewIfNeeded();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'A nota deve caber no celular');
  await page.screenshot({ path: 'output/playwright/assinatura-nota-mobile.png' });
  await page.getByRole('button', { name: 'Assinar RDO 42', exact: true }).click();
  await confirm();
  assert(requests[1].comment === 'Nota do relatório individual.' && !requests[1].comments, 'A assinatura individual envia o campo comment');

  await page.setViewportSize({ width: 1365, height: 1000 });
  await page.goto(`${origin}/implementation-preview/index.html?aba=equipamentos`);
  await page.getByRole('button', { name: 'Documentos de BOM-002', exact: true }).click();
  let folder = page.getByRole('dialog', { name: 'Documentos · BOM-002', exact: true });
  await folder.getByText('Nenhum documento anexado', { exact: true }).waitFor();
  const dropzone = folder.locator('.pdf-dropzone');
  const dropFiles = async files => {
    const dataTransfer = await page.evaluateHandle(items => {
      const transfer = new DataTransfer();
      for (const { name, type } of items) transfer.items.add(new File(['%PDF-1.4\nDocumento de teste'], name, { type }));
      return transfer;
    }, files);
    try {
      await dropzone.dispatchEvent('dragover', { dataTransfer });
      assert(await dropzone.evaluate(element => element.classList.contains('drag-over')), 'O campo padrão destaca o arraste');
      await dropzone.dispatchEvent('drop', { dataTransfer });
    } finally { await dataTransfer.dispose(); }
  };
  await dropFiles([{ name: 'invalido.txt', type: 'text/plain' }]);
  await folder.getByText('Selecione PDFs de até 20 MB cada.', { exact: true }).waitFor();
  assert(await folder.getByRole('listitem').count() === 0, 'Arquivo inválido não deve ser anexado');
  await dropFiles(['Manual.pdf', 'Certificado.pdf'].map(name => ({ name, type: 'application/pdf' })));
  await folder.getByText('Manual.pdf', { exact: true }).waitFor();
  await folder.getByText('Certificado.pdf', { exact: true }).waitFor();
  assert(await folder.getByRole('listitem').count() === 2, 'A pasta mantém múltiplos documentos');
  await page.screenshot({ path: 'output/playwright/equipamentos-documentos-desktop.png' });
  await folder.getByRole('button', { name: 'Remover Manual.pdf', exact: true }).click();
  await page.getByRole('dialog', { name: 'Remover documento', exact: true }).getByRole('button', { name: 'Cancelar', exact: true }).click();
  assert(await folder.getByText('Manual.pdf', { exact: true }).count() === 1, 'Cancelar preserva o documento');
  await folder.getByRole('button', { name: 'Remover Manual.pdf', exact: true }).click();
  await page.getByRole('dialog', { name: 'Remover documento', exact: true }).getByRole('button', { name: 'Remover documento', exact: true }).click();
  await folder.getByText('Manual.pdf', { exact: true }).waitFor({ state: 'hidden' });
  assert(await folder.getByRole('listitem').count() === 1, 'Excluir remove só um documento');
  await folder.locator('input[type=file]').setInputFiles({ name: 'Manual complementar.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nDocumento de teste') });
  await folder.getByText('Manual complementar.pdf', { exact: true }).waitFor();
  assert(await folder.getByRole('listitem').count() === 2, 'Selecionar por clique adiciona ao acervo existente');
  await folder.getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Documentos de BOM-002', exact: true }).click();
  folder = page.getByRole('dialog', { name: 'Documentos · BOM-002', exact: true });
  await folder.getByText('Manual complementar.pdf', { exact: true }).waitFor();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Campo de arraste responsivo no celular');
  await page.screenshot({ path: 'output/playwright/equipamentos-documentos-mobile.png' });
  await folder.getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.setViewportSize({ width: 1365, height: 1000 });
  await page.getByRole('button', { name: 'Editar categoria', exact: true }).click();
  let category = page.getByRole('dialog', { name: 'Editar categoria', exact: true });
  await category.getByLabel('Anexar documentos', { exact: true }).uncheck();
  await category.getByRole('button', { name: 'Salvar categoria', exact: true }).click();
  await page.getByRole('button', { name: 'Documentos de BOM-002', exact: true }).click();
  folder = page.getByRole('dialog', { name: 'Documentos · BOM-002', exact: true });
  await folder.getByText('Certificado.pdf', { exact: true }).waitFor();
  assert(await folder.getByRole('button', { name: 'Anexar documentos a BOM-002', exact: true }).count() === 0, 'Desativar a categoria bloqueia anexos e preserva documentos');
  await folder.getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.getByRole('button', { name: 'Editar categoria', exact: true }).click();
  category = page.getByRole('dialog', { name: 'Editar categoria', exact: true });
  await category.getByLabel('Anexar documentos', { exact: true }).check();
  await category.getByRole('button', { name: 'Salvar categoria', exact: true }).click();
  await page.getByLabel('Simular acesso de gestor').uncheck();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Documentos de BOM-002', exact: true }).click();
  folder = page.getByRole('dialog', { name: 'Documentos · BOM-002', exact: true });
  await folder.getByText('Certificado.pdf', { exact: true }).waitFor();
  assert(await folder.getByRole('button', { name: /Remover|Anexar documentos/ }).count() === 0, 'Consulta não permite escrita');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Pasta responsiva no celular');
  await page.screenshot({ path: 'output/playwright/equipamentos-documentos-consulta-mobile.png' });
  return { passed: true, checks: ['notas independentes por RDO', 'confirmação com notas', 'payload individual e em lote', 'assinatura móvel', 'arraste de vários PDFs com destaque visual', 'rejeição de arquivo inválido', 'seleção de arquivos por clique', 'cancelamento e exclusão individual', 'ativar/desativar preserva arquivos', 'acesso de consulta', 'layout desktop e celular'] };
}
