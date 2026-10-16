import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

async function loadNovelty(t) {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  t.after(() => server.close());
  return server.ssrLoadModule('/src/pages/assinaturas/utils/batchNovelty.ts');
}

test('campanha de assinatura em lote dura cinco dias corridos e respeita as duas fronteiras no fuso corporativo', async t => {
  const { SIGNATURE_BATCH_NOVELTY_STARTS_AT: start, SIGNATURE_BATCH_NOVELTY_EXPIRES_AT: end,
    shouldShowSignatureBatchNovelty: show } = await loadNovelty(t);
  assert.equal((end - start) / 86400000, 5);
  assert.equal(start.toISOString(), '2026-10-16T03:00:00.000Z');
  assert.equal(end.toISOString(), '2026-10-21T03:00:00.000Z');
  assert.equal(show('u1', start.getTime() - 1), false);
  assert.equal(show('u1', start.getTime()), true);
  assert.equal(show('u1', end.getTime() - 1), true);
  assert.equal(show('u1', end.getTime()), false);
  assert.equal(show('u2', end.getTime() + 1), false, 'expira para todos, inclusive quem nunca viu');
});

test('novidade é independente do tutorial antigo e é vista uma vez por usuário', async t => {
  const stored = new Map([['filtrovali:assinaturas-tutorial:v1:u1', '1']]);
  globalThis.window = { localStorage: {
    getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value)
  } };
  t.after(() => { delete globalThis.window; });
  const { shouldShowSignatureBatchNovelty: show, markSignatureBatchNoveltySeen: mark,
    SIGNATURE_BATCH_NOVELTY_STARTS_AT: start } = await loadNovelty(t);
  assert.equal(show('', start.getTime()), false);
  mark('');
  assert.equal(stored.size, 1);
  assert.equal(show('u1', start.getTime()), true);
  mark('u1');
  assert.equal(show('u1', start.getTime()), false);
  assert.equal(show('u2', start.getTime()), true);
});

test('armazenamento indisponível não impede a exibição nem quebra o módulo', async t => {
  globalThis.window = { get localStorage() { throw new Error('bloqueado'); } };
  t.after(() => { delete globalThis.window; });
  const novelty = await loadNovelty(t);
  assert.equal(novelty.shouldShowSignatureBatchNovelty('u1', novelty.SIGNATURE_BATCH_NOVELTY_STARTS_AT.getTime()), true);
  assert.doesNotThrow(() => novelty.markSignatureBatchNoveltySeen('u1'));
});

test('campanha fica na biblioteca autenticada e só é marcada como vista quando o destaque abre', async () => {
  const root = new URL('../src/pages/assinaturas/', import.meta.url);
  const [page, campaign, publicPage] = await Promise.all([
    readFile(new URL('AssinaturasPage.tsx', root), 'utf8'),
    readFile(new URL('AssinaturasBatchNovelty.tsx', root), 'utf8'),
    readFile(new URL('AssinaturasPublicSignPage.tsx', root), 'utf8')
  ]);
  assert.match(page, /<AssinaturasBatchNovelty userId=\{user\?\.id \|\| ''\}/);
  assert.match(page, /enabled=\{!listQuery\.isLoading && !listQuery\.isLoadingError && !selectedId && !selectedBatchId && !newOpen\}/);
  assert.match(campaign, /onHighlighted:[\s\S]*?markSignatureBatchNoveltySeen\(userId\)/);
  assert.match(campaign, /driver-active/);
  assert.match(campaign, /guide\?\.destroy\(\)/);
  assert.doesNotMatch(publicPage, /AssinaturasBatchNovelty/);
});
