import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

async function batchModule(t) {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  t.after(() => server.close());
  return server.ssrLoadModule('/src/pages/assinaturas/utils/batch.ts');
}

test('upload aceita qualquer quantidade de PDFs e 200 MB por arquivo, rejeitando apenas os inválidos', async t => {
  const { validateSignatureFiles, MAX_SIGNATURE_PDF_BYTES } = await batchModule(t);
  const file = { name: 'contrato.pdf', type: 'application/pdf', size: 200 * 1024 * 1024 };
  assert.equal(MAX_SIGNATURE_PDF_BYTES, file.size);
  assert.equal(validateSignatureFiles([file]), '');
  assert.equal(validateSignatureFiles(Array.from({ length: 501 }, () => file)), '');
  assert.match(validateSignatureFiles([{ ...file, size: file.size + 1 }]), /200 MB/);
  assert.match(validateSignatureFiles([{ ...file, size: 0 }]), /vazio/);
  assert.match(validateSignatureFiles([{ ...file, name: 'outro.txt', type: 'text/plain' }]), /PDF válido/);
  assert.match(validateSignatureFiles([]), /pelo menos um/);
});

test('retomada associa campos ao assinante do lote sem misturar documentos e reinicia páginas em cada PDF', async t => {
  const { batchConfiguration, batchPublicationIssues } = await batchModule(t);
  const signers = [{ id: 'ana', name: 'Ana Souza', email: 'ana@example.com', position: 1 }, { id: 'bia', name: 'Bia Souza', email: null, position: 2 }];
  const batch = { id: 'lote', signers, documents: [
    { id: 'd1', title: 'Primeiro', signers: [{ id: 's1', batchSignerId: 'ana' }], fields: [{ signerId: 's1', pageNumber: 1, x: '0.1', y: '0.2', width: '0.2', height: '0.055' }] },
    { id: 'd2', title: 'Segundo', signers: [{ id: 's2', batchSignerId: 'bia' }], fields: [{ signerId: 's2', pageNumber: 1 }] }
  ] };
  const config = batchConfiguration(batch);
  assert.deepEqual(config.documents.map(document => document.fields[0].signerId), ['ana', 'bia']);
  assert.deepEqual(config.documents.map(document => document.fields[0].pageNumber), [1, 1]);
  assert.equal(config.documents[0].fields[0].x + 0.1, 0.2, 'decimais da API devem permitir reposicionamento após reload');
  assert.deepEqual(batchPublicationIssues(batch, config), [], 'um assinante pode estar somente em um documento');
  config.documents[1].fields = [];
  assert.deepEqual(batchPublicationIssues(batch, config), ['Segundo: posicione pelo menos uma assinatura.', 'Bia Souza não tem campo de assinatura em nenhum documento.']);
});

test('card único contém os PDFs e acompanhamento renderiza apenas um conjunto de ações por pessoa', async () => {
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  const client = new QueryClient();
  try {
    const { DocumentCard } = await server.ssrLoadModule('/src/pages/assinaturas/components/DocumentCard.tsx');
    const { BatchTrackingView } = await server.ssrLoadModule('/src/pages/assinaturas/components/BatchTrackingView.tsx');
    const { ToastContext } = await server.ssrLoadModule('/src/components/ui/ToastContext.ts');
    const documents = [1, 2].map(index => ({ id: `d${index}`, batchId: 'batch', title: `Contrato ${index}`, originalFileName: `${index}.pdf`,
      status: index === 1 ? 'AGUARDANDO_ASSINATURAS' : 'CONCLUIDO', progress: { signed: index === 1 ? 0 : 1, total: index === 1 ? 2 : 1 }, progressLabel: '0 de 1 assinaturas' }));
    const card = renderToStaticMarkup(createElement(DocumentCard, { document: { id: 'batch', batchId: 'batch', title: 'Lote de 2 documentos',
      status: 'AGUARDANDO_ASSINATURAS', createdAt: '2026-10-16T15:00:00Z', signerCount: 3, signedCount: 1, batchDocuments: documents }, onOpen() {} }));
    assert.equal((card.match(/data-signature-document=/g) || []).length, 1);
    assert.equal((card.match(/<button/g) || []).length, 1, 'sem ações aninhadas no botão do lote');
    assert.match(card, /Contrato 1/);
    assert.match(card, /Contrato 2/);
    assert.match(card, /Abrir lote/);
    const signer = { status: 'PENDENTE', emailStatus: 'ENVIADO', tokenExpiresAt: '2030-01-01T00:00:00Z', signedAt: null };
    const batch = { id: 'batch', documents, invitations: [
      { ...signer, id: 'ana', name: 'Ana Souza', email: 'ana@example.com', documents: documents.map(document => ({ ...document, signerStatus: 'PENDENTE' })) },
      { ...signer, id: 'bia', name: 'Bia Souza', email: null, documents: [{ ...documents[0], signerStatus: 'PENDENTE' }] }
    ] };
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(ToastContext.Provider, { value: { showToast() {} } }, createElement(BatchTrackingView, { batch, onBack() {}, onOpenDocument() {} }))));
    assert.equal((html.match(/aria-label="Copiar link de Ana Souza"/g) || []).length, 1);
    assert.equal((html.match(/aria-label="Copiar link de Bia Souza"/g) || []).length, 1);
    assert.match(html, /aria-label="Documentos de Ana Souza"[^>]*>[\s\S]*?Contrato 1[\s\S]*?Contrato 2/);
    assert.match(html, /Baixar PDF de Contrato 2/);
    assert.doesNotMatch(html, /Baixar PDF de Contrato 1/);
    assert.match(html, /Assinantes e links do lote/);
  } finally { client.clear(); await server.close(); }
});
