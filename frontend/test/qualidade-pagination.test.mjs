import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { InfiniteQueryObserver, QueryClient } from '@tanstack/react-query';
import { createServer } from 'vite';

let server, api, queryOptions, originalAdapter;
before(async () => {
  server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  ({ qualityRecordsQueryOptions: queryOptions } = await server.ssrLoadModule('/src/hooks/useQualityRecords.ts'));
  api = (await server.ssrLoadModule('/src/api/client.ts')).apiClient;
  originalAdapter = api.defaults.adapter;
  globalThis.localStorage = { getItem: () => null };
});
after(async () => {
  api.defaults.adapter = originalAdapter;
  delete globalThis.localStorage;
  await server?.close();
});

function response(config, total = 125, prefix = 'record') {
  const { page, pageSize } = config.params;
  const offset = (page - 1) * pageSize;
  return {
    data: { items: Array.from({ length: Math.max(0, Math.min(pageSize, total - offset)) }, (_, index) => ({ id: `${prefix}-${offset + index + 1}` })), total, page, pageSize },
    status: 200, statusText: 'OK', headers: {}, config
  };
}

function observe(filters = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const observer = new InfiniteQueryObserver(client, queryOptions(filters));
  const unsubscribe = observer.subscribe(() => {});
  return { client, observer, dispose: () => { unsubscribe(); client.clear(); } };
}

test('registros de qualidade carregam todas as páginas, mantendo os filtros e respeitando o total', async () => {
  const calls = [];
  api.defaults.adapter = async config => { calls.push(config.params); return response(config); };
  const { observer, dispose } = observe({ type: 'DESVIO', projectId: 'project-1', q: '' });
  try {
    await observer.refetch();
    while (observer.getCurrentResult().hasNextPage) await observer.fetchNextPage();
    const result = observer.getCurrentResult();
    const records = result.data.pages.flatMap(page => page.items);
    assert.deepEqual(calls.map(call => call.page), [1, 2, 3]);
    assert.ok(calls.every(call => call.type === 'DESVIO' && call.projectId === 'project-1' && call.pageSize === 50 && !('q' in call)));
    assert.equal(records.length, 125);
    assert.equal(new Set(records.map(record => record.id)).size, 125);
    assert.deepEqual(result.data.pages.map(page => page.items.length), [50, 50, 25]);
    await observer.fetchNextPage();
    assert.equal(calls.length, 3, 'não deve solicitar uma página além do total');
  } finally { dispose(); }
});

test('falha na próxima página preserva os registros e a nova tentativa busca a mesma página uma única vez', async () => {
  const calls = [];
  let fail = true, release;
  api.defaults.adapter = async config => {
    calls.push(config.params.page);
    if (config.params.page === 2 && fail) throw new Error('Falha de conexão');
    if (config.params.page === 2) await new Promise(resolve => { release = resolve; });
    return response(config, 80);
  };
  const { observer, dispose } = observe();
  try {
    await observer.refetch();
    const failed = await observer.fetchNextPage();
    assert.equal(failed.isFetchNextPageError, true);
    assert.equal(failed.hasNextPage, true);
    assert.deepEqual(failed.data.pageParams, [1]);
    assert.equal(failed.data.pages[0].items.length, 50);
    fail = false;
    const retry = observer.fetchNextPage({ cancelRefetch: false });
    const duplicate = observer.fetchNextPage({ cancelRefetch: false });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [1, 2, 2]);
    release();
    await Promise.all([retry, duplicate]);
    const result = observer.getCurrentResult();
    assert.equal(result.isError, false);
    assert.equal(result.data.pages.flatMap(page => page.items).length, 80);
    assert.equal(result.hasNextPage, false);
  } finally { release?.(); dispose(); }
});

test('trocar o filtro cancela a página pendente e reinicia na página 1 sem misturar resultados', async () => {
  const calls = [];
  let release, oldSignal;
  api.defaults.adapter = async config => {
    calls.push([config.params.type, config.params.page]);
    if (config.params.type === 'DESVIO' && config.params.page === 2) {
      oldSignal = config.signal;
      await new Promise(resolve => { release = resolve; });
    }
    return response(config, config.params.type === 'MELHORIA' ? 2 : 125, config.params.type);
  };
  const { observer, dispose } = observe({ type: 'DESVIO' });
  try {
    await observer.refetch();
    const pending = observer.fetchNextPage();
    await new Promise(resolve => setImmediate(resolve));
    observer.setOptions(queryOptions({ type: 'MELHORIA' }));
    const filtered = await observer.refetch();
    assert.equal(oldSignal.aborted, true);
    release();
    await pending;
    assert.deepEqual(calls, [['DESVIO', 1], ['DESVIO', 2], ['MELHORIA', 1]]);
    assert.deepEqual(filtered.data.pageParams, [1]);
    assert.deepEqual(observer.getCurrentResult().data.pages[0].items.map(item => item.id), ['MELHORIA-1', 'MELHORIA-2']);
    assert.equal(filtered.hasNextPage, false);
  } finally { release?.(); dispose(); }
});

test('atualizações revalidam as páginas e reduzem a lista quando os registros deixam de corresponder ao filtro', async () => {
  const calls = [];
  let total = 125;
  api.defaults.adapter = async config => { calls.push(config.params.page); return response(config, total); };
  const { client, observer, dispose } = observe();
  try {
    await observer.refetch();
    await observer.fetchNextPage();
    await observer.fetchNextPage();
    calls.length = 0;
    await client.invalidateQueries({ queryKey: ['qualidade', 'registros'] });
    assert.deepEqual(calls, [1, 2, 3]);
    total = 30;
    calls.length = 0;
    await client.invalidateQueries({ queryKey: ['qualidade', 'registros'] });
    assert.deepEqual(calls, [1]);
    assert.equal(observer.getCurrentResult().data.pages.flatMap(page => page.items).length, 30);
    assert.equal(observer.getCurrentResult().hasNextPage, false);
  } finally { dispose(); }
});

for (const total of [0, 100]) test(`a paginação termina corretamente com ${total} registros`, async () => {
  const calls = [];
  api.defaults.adapter = async config => { calls.push(config.params.page); return response(config, total); };
  const { observer, dispose } = observe();
  try {
    await observer.refetch();
    if (total) await observer.fetchNextPage();
    assert.equal(observer.getCurrentResult().hasNextPage, false);
    assert.deepEqual(calls, total ? [1, 2] : [1]);
  } finally { dispose(); }
});
