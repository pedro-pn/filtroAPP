import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

async function loaderFactory(t) {
  const server = await createServer({
    configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, appType: 'custom'
  });
  t.after(() => server.close());
  return (await server.ssrLoadModule('/src/pages/assinaturas/utils/preview.ts')).sequentialSignaturePageLoader;
}

test('páginas de scans carregam em sequência, sem renderizações simultâneas', async t => {
  const createLoader = await loaderFactory(t);
  const started = [];
  let finishFirst;
  const loader = createLoader(async page => {
    started.push(page);
    if (page === 1) await new Promise(resolve => { finishFirst = resolve; });
    return new Blob([String(page)]);
  });
  const signal = new AbortController().signal;
  const first = loader(1, signal);
  const second = loader(2, signal);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, [1]);
  finishFirst();
  assert.equal(await (await first).text(), '1');
  assert.equal(await (await second).text(), '2');
  assert.deepEqual(started, [1, 2]);
});

test('falha de uma página permite as próximas e cancelamento evita requests pendentes', async t => {
  const createLoader = await loaderFactory(t);
  const started = [];
  const loader = createLoader(async page => {
    started.push(page);
    if (page === 1) throw new Error('Falha na prévia');
    return new Blob([String(page)]);
  });
  const signal = new AbortController().signal;
  const aborted = new AbortController();
  const first = loader(1, signal);
  const second = loader(2, aborted.signal);
  const third = loader(3, signal);
  aborted.abort();
  await assert.rejects(first, /Falha na prévia/);
  await assert.rejects(second, error => error.name === 'AbortError');
  assert.equal(await (await third).text(), '3');
  assert.deepEqual(started, [1, 3]);
});
