import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

async function load(path) {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname, server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try { return await server.ssrLoadModule(path); } finally { await server.close(); }
}

test('novidade é individual e expira globalmente em dez dias', async () => {
  const storage = new Map();
  globalThis.localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
  try {
    const novelty = await load('/src/utils/efetivoPlanningNovelty.ts');
    assert.equal(novelty.shouldShowEfetivoPlanningNovelty('u1', new Date('2026-08-31T12:00:00-03:00').getTime()), true);
    novelty.markEfetivoPlanningNoveltySeen('u1');
    assert.equal(novelty.shouldShowEfetivoPlanningNovelty('u1', new Date('2026-08-31T12:00:00-03:00').getTime()), false);
    assert.equal(novelty.shouldShowEfetivoPlanningNovelty('u2', new Date('2026-09-01T00:00:00-03:00').getTime()), false);
  } finally { delete globalThis.localStorage; }
});
