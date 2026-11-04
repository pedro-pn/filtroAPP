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

test('novidade do compartilhamento dura cinco dias de São Paulo e expira inclusive para quem nunca acessou', async t => {
  const server = await loader(t);
  const { SIGNATURE_SHARING_NOVELTY_STARTS_AT: start, SIGNATURE_SHARING_NOVELTY_EXPIRES_AT: end,
    shouldShowSignatureSharingNovelty: show } = await server.ssrLoadModule('/src/pages/assinaturas/utils/sharingNovelty.ts');
  assert.equal((end - start) / 86400000, 5);
  assert.equal(start.toISOString(), '2026-11-04T03:00:00.000Z');
  assert.equal(end.toISOString(), '2026-11-09T03:00:00.000Z');
  for (const userId of ['first-user', 'never-accessed']) {
    assert.equal(show(userId, start.getTime() - 1), false);
    assert.equal(show(userId, start.getTime()), true);
    assert.equal(show(userId, end.getTime() - 1), true);
    assert.equal(show(userId, end.getTime()), false);
    assert.equal(show(userId, end.getTime() + 1), false);
  }
});

test('novidade é independente do onboarding e da campanha de lotes, com visto isolado por usuário', async t => {
  const stored = new Map([
    ['filtrovali:assinaturas-tutorial:v1:u1', '1'],
    ['filtrovali:assinaturas-batch-novelty:v1:u1', '1']
  ]);
  globalThis.window = { localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) } };
  t.after(() => { delete globalThis.window; });
  const server = await loader(t);
  const { shouldShowSignatureSharingNovelty: show, markSignatureSharingNoveltySeen: mark,
    SIGNATURE_SHARING_NOVELTY_STARTS_AT: start } = await server.ssrLoadModule('/src/pages/assinaturas/utils/sharingNovelty.ts');
  assert.equal(show('', start.getTime()), false);
  mark('');
  assert.equal(stored.size, 2);
  assert.equal(show('u1', start.getTime()), true);
  mark('u1');
  assert.equal(stored.get('filtrovali:assinaturas-sharing-novelty:v1:u1'), '1');
  assert.equal(show('u1', start.getTime()), false);
  assert.equal(show('u2', start.getTime()), true);
  assert.equal(stored.size, 3);
});

test('bloqueio de storage não impede conhecer a função nem lança erro ao registrar o visto', async t => {
  globalThis.window = { get localStorage() { throw new Error('Storage indisponível'); } };
  t.after(() => { delete globalThis.window; });
  const server = await loader(t);
  const novelty = await server.ssrLoadModule('/src/pages/assinaturas/utils/sharingNovelty.ts');
  assert.equal(novelty.shouldShowSignatureSharingNovelty('u1', novelty.SIGNATURE_SHARING_NOVELTY_STARTS_AT.getTime()), true);
  assert.doesNotThrow(() => novelty.markSignatureSharingNoveltySeen('u1'));
});

test('o tutorial aponta documentos próprios e não oferece compartilhar um documento recebido', async t => {
  const server = await loader(t);
  const { DocumentCard } = await server.ssrLoadModule('/src/pages/assinaturas/components/DocumentCard.tsx');
  const document = { id: 'doc', title: 'Contrato', originalFileName: 'contrato.pdf', status: 'RASCUNHO', pageCount: 1,
    signerCount: 0, signedCount: 0, progressLabel: '0 de 0 assinaturas', createdAt: '2026-11-04T12:00:00Z' };
  for (const permissions of [undefined, { isOwner: true, access: 'OWNER', canEdit: true }]) {
    assert.match(renderToStaticMarkup(createElement(DocumentCard, { document: { ...document, permissions }, onOpen() {} })), /data-signature-share-document="doc"/);
  }
  for (const access of ['VIEW', 'EDIT']) {
    const html = renderToStaticMarkup(createElement(DocumentCard, { document: { ...document, permissions: { isOwner: false, access, canEdit: access === 'EDIT' } }, onOpen() {} }));
    assert.doesNotMatch(html, /data-signature-share-document/);
    assert.match(html, /Compartilhado/);
  }
});
