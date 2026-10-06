import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

async function loader(t) {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  t.after(() => server.close());
  return server;
}

test('leitura persiste por usuário, remove o destaque e outra assinatura volta a destacá-lo', async t => {
  const server = await loader(t);
  const { signatureUpdatesStorageKey, readViewedSignatures, hasUnseenSignatures } = await server.ssrLoadModule('/src/hooks/useSignatureUpdates.ts');
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => storage.get(key) || null } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete globalThis.localStorage; });
  const firstUser = signatureUpdatesStorageKey('u1');
  const secondUser = signatureUpdatesStorageKey('u2');
  const document = { id: 'doc', signedCount: 1 };
  assert.equal(hasUnseenSignatures(document, readViewedSignatures(firstUser)), true);
  storage.set(firstUser, JSON.stringify({ doc: 1 }));
  assert.equal(hasUnseenSignatures(document, readViewedSignatures(firstUser)), false);
  assert.equal(hasUnseenSignatures(document, readViewedSignatures(secondUser)), true);
  assert.equal(hasUnseenSignatures({ ...document, signedCount: 2 }, readViewedSignatures(firstUser)), true);
  assert.equal(hasUnseenSignatures({ id: 'draft', signedCount: 0 }, readViewedSignatures(firstUser)), false);
  for (const stored of ['invalid', 'null', '[]', '{"doc":"2","negative":-1}']) {
    storage.set(firstUser, stored);
    assert.deepEqual(readViewedSignatures(firstUser), {});
  }
});

test('datas sobrevivem a documento, reload e retorno nas listas ativa e arquivada', async t => {
  const server = await loader(t);
  const { signatureDocumentSearchParams, normalizeSignatureSearchParams, signatureLibrarySearchParams } = await server.ssrLoadModule('/src/pages/assinaturas/utils/navigation.ts');
  for (const archived of [false, true]) {
    const library = new URLSearchParams('dateFrom=2026-10-01&dateTo=2026-10-06&status=CONCLUIDO&q=Contrato');
    if (archived) library.set('tab', 'archived');
    const document = signatureDocumentSearchParams(library, 'doc');
    const reload = normalizeSignatureSearchParams(new URLSearchParams(document));
    assert.equal(signatureLibrarySearchParams(reload).toString(), library.toString());
  }
});

test('biblioteca destaca novas assinaturas acima dos recentes sem duplicar documentos; limpar fica após a última tag', async t => {
  const server = await loader(t);
  const { DocumentLibrary } = await server.ssrLoadModule('/src/pages/assinaturas/components/DocumentLibrary.tsx');
  const base = { originalFileName: 'Contrato.pdf', pageCount: 1, signerCount: 2, signedCount: 2,
    progressLabel: '2 de 2 assinaturas', status: 'CONCLUIDO', createdAt: '2026-10-01T12:00:00Z', completedAt: '2026-10-06T12:00:00Z' };
  const fresh = { ...base, id: 'new', title: 'Assinado novo' };
  const old = { ...base, id: 'old', title: 'Assinado visto' };
  const props = { data: { items: [fresh, old], nextCursor: null }, newSignatures: [fresh],
    loading: false, error: false, loadingMore: false, loadMoreError: false, archived: false, query: 'Contrato', status: 'CONCLUIDO', dateFrom: '2026-10-01', dateTo: '2026-10-06',
    onQueryChange() {}, onStatusChange() {}, onDateFromChange() {}, onDateToChange() {}, onArchiveChange() {}, onClearFilters() {}, onRetry() {}, onLoadMore() {}, onNew() {}, onOpen() {} };
  const html = renderToStaticMarkup(createElement(DocumentLibrary, props));
  assert.match(html, /Criado a partir de: 01\/10\/2026/);
  assert.match(html, /Criado até: 06\/10\/2026/);
  assert.ok(html.indexOf('aria-label="Novas assinaturas"') < html.indexOf('aria-label="Assinados recentemente"'));
  assert.equal((html.match(/data-signature-document="new"/g) || []).length, 1);
  assert.ok(html.indexOf('fv-filter-bar__clear') > html.indexOf('Criado até: 06/10/2026'));
  assert.ok(html.indexOf('fv-filter-bar__clear') > html.indexOf('aria-label="Filtros ativos"'));
  const seen = renderToStaticMarkup(createElement(DocumentLibrary, { ...props, newSignatures: [] }));
  assert.doesNotMatch(seen, /aria-label="Novas assinaturas"/);
  assert.match(seen, /data-signature-document="new"/);
  const archived = renderToStaticMarkup(createElement(DocumentLibrary, { ...props, archived: true }));
  assert.doesNotMatch(archived, /aria-label="Novas assinaturas"/);
  const noResults = renderToStaticMarkup(createElement(DocumentLibrary, { ...props, data: { items: [], nextCursor: null }, newSignatures: [], query: '', status: '' }));
  assert.match(noResults, /Nenhum documento encontrado/);
});
