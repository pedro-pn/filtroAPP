import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createServer } from 'vite';
import { formatTimestampDateTime } from '../../shared/modules/date-only.js';

test('descarga mostra histórico e CT-e; total encerra formulário e conserva confirmações parciais', async () => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try {
    const { RomaneioUnloading } = await server.ssrLoadModule('/src/components/projects/RomaneioUnloading.tsx');
    const { AuthContext } = await server.ssrLoadModule('/src/auth/AuthContext.ts');
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const render = data => {
      cache.setQueryData(['romaneio-logistics','r1'],data);
      return renderToStaticMarkup(createElement(QueryClientProvider, { client: cache },
        createElement(AuthContext.Provider, { value: { user: { id: 'leader' } } }, createElement(RomaneioUnloading, { romaneioId: 'r1' }))));
    };
    const history = [{ id:'partial', tipo:'PARCIAL', confirmadaEm:'2026-10-01T12:00:00Z', confirmadaPorEmail:'leader@example.test' }];
    const data = { history, ctes:[{ id:'cte', numero:'0010', emissao:'2026-10-01T03:30:00Z', transportadora:'Transportadora fictícia' }] };
    const partial = render(data);
    for (const text of ['Parcial','leader@example.test','CT-e 0010','Transportadora fictícia','Confirmar chegada e descarga','ID do CT-e no Omie']) assert.ok(partial.includes(text),text);
    const total = render({ ...data, history:[...history,{ id:'total',tipo:'TOTAL',confirmadaEm:'2026-10-02T12:00:00Z',confirmadaPorEmail:'leader@example.test' }] });
    assert.ok(total.includes('Descarga total confirmada.')); assert.ok(total.includes('Parcial'));
    assert.ok(!total.includes('Confirmar chegada e descarga')); assert.ok(!total.includes('Importar CT-e'));
    cache.clear();
  } finally { await server.close(); }
});
test('horários da descarga usam America/Sao_Paulo e suportam valores ausentes', () => {
  assert.match(formatTimestampDateTime('2026-10-02T02:30:00Z'), /01\/10\/2026.*23:30/);
  assert.equal(formatTimestampDateTime(null),'—'); assert.equal(formatTimestampDateTime('invalid'),'—');
});
