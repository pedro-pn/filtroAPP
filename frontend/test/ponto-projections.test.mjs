import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import { createServer } from 'vite';

test('point consumers request their projection and retain separate caches under shared invalidation', async () => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  try {
    const { apiClient } = await server.ssrLoadModule('/src/api/client.ts');
    const { getPontoColaboradores, getPontoReconciliation, pontoColaboradoresQueryKeys: keys } = await server.ssrLoadModule('/src/api/acompanhamentoPonto.ts');
    const calls = [];
    const metadata = { importId: 'synthetic', periodStart: null, periodEnd: null, fileName: 'synthetic.xlsx', unmatched: [] };
    apiClient.defaults.adapter = async config => {
      calls.push({ url: config.url, view: config.params.view });
      return { data: config.params.view === 'summary' ? { ...metadata, rates: [{ collaboratorId: 'c1', months: [] }] } : metadata,
        status: 200, statusText: 'OK', headers: {}, config };
    };
    const costs = await queryClient.fetchQuery({ queryKey: keys.rates, queryFn: getPontoColaboradores });
    const reconciliation = await queryClient.fetchQuery({ queryKey: keys.reconciliation, queryFn: getPontoReconciliation });
    assert.equal(costs.rates[0].collaboratorId, 'c1');
    assert.equal(Object.hasOwn(reconciliation, 'rates'), false);
    assert.deepEqual(calls, [
      { url: '/acompanhamento/ponto/colaboradores', view: 'summary' },
      { url: '/acompanhamento/ponto/colaboradores', view: 'reconciliation' }
    ]);
    await queryClient.invalidateQueries({ queryKey: ['ponto-colaboradores'] });
    assert.equal(queryClient.getQueryState(keys.rates).isInvalidated, true);
    assert.equal(queryClient.getQueryState(keys.reconciliation).isInvalidated, true);
    assert.equal(queryClient.getQueryData(keys.rates), costs);
    assert.equal(queryClient.getQueryData(keys.reconciliation), reconciliation);
  } finally {
    queryClient.clear(); await server.close();
    if (storage) Object.defineProperty(globalThis, 'localStorage', storage); else delete globalThis.localStorage;
  }
});
