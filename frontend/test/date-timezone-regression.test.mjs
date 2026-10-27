import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createServer } from 'vite';

test('stock table and equipment dates preserve the calendar day around midnight UTC', async t => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  try {
    const { ToastContext } = await server.ssrLoadModule('/src/components/ui/ToastContext.ts');
    const { StockMovementsTab } = await server.ssrLoadModule('/src/pages/estoque/StockMovementsTab.tsx');
    const equipment = await server.ssrLoadModule('/src/pages/equipamentos/equipmentStatus.ts');
    const calendar = await server.ssrLoadModule('/src/utils/calendarGrid.ts');
    const dates = await server.ssrLoadModule('/src/utils/dateOnly.ts');
    client.setQueryData(['estoque', 'itens', { movementFilters: true }], []);
    client.setQueryData(['estoque', 'projects', { filters: true }], []);
    client.setQueryData(['estoque', 'movimentacoes', {
      itemId: '', type: '', reason: '', projectId: '', from: '', to: '', dateOrder: 'desc', page: 1
    }], { total: 1, movements: [{
      id: 'movement', type: 'ENTRADA', reason: 'COMPRA', date: '2026-11-01', quantity: '10',
      item: { code: 'PQ-001', name: 'Químico', unitLabel: 'kg' }, batch: { lotNumber: 'L-1' }
    }] });
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client },
      createElement(ToastContext.Provider, { value: { showToast() {} } },
        createElement(StockMovementsTab, { isManager: true, onRegisterMovement() {} }))));
    assert.match(html, /data-label="Data"[^>]*>01\/11\/2026<\/td>/);
    assert.doesNotMatch(html, /31\/10\/2026/);
    assert.equal(equipment.formatDate('2026-11-01T00:00:00Z'), '01/11/2026');
    assert.equal(equipment.dateInputValue('2026-11-01T00:00:00Z'), '2026-11-01');
    assert.equal(dates.formatTimestampDate('2026-11-01T01:00:00Z'), '31/10/2026');
    assert.equal(calendar.todayDateOnly(new Date('2026-11-01T01:00:00Z')), '2026-10-31');

    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-01T01:00:00Z') });
    assert.equal(dates.todayDateOnly(), '2026-10-31');
    assert.equal(equipment.calibrationStatus({ hasCalibration: true, expiresAt: '2026-10-31' }), 'expiring');
    t.mock.timers.setTime(new Date('2026-11-01T03:00:00Z').getTime());
    assert.equal(equipment.calibrationStatus({ hasCalibration: true, expiresAt: '2026-10-31' }), 'expired');
  } finally {
    t.mock.timers.reset();
    client.clear();
    await server.close();
  }
});
