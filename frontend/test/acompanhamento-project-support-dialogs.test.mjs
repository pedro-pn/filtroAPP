import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('romaneios e standby preservam itens e motivos nas tabelas migradas', async () => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try {
    const { RomaneioItemsCard } = await server.ssrLoadModule('/src/components/projects/ProjectRomaneiosDialog.tsx');
    const { StandbyHistoryTable } = await server.ssrLoadModule('/src/components/projects/ProjectStandbyHistoryDialog.tsx');
    const romaneio = { id: 'r1', type: 'INBOUND', romaneioDate: '2026-09-20', vehiclePlate: 'ABC1D23',
      project: { id: 'p1', code: '5715', name: 'Ventura' }, items: [
        { id: 'i1', itemCode: 'OLEO-1', itemName: 'Óleo de teste', categoryName: 'Insumos',
          quantity: '1250.5', unitLabel: 'L', isCustom: true, isExtra: true }
      ] };
    const items = renderToStaticMarkup(createElement('div', { className: 'fv-ds' }, createElement(RomaneioItemsCard, { romaneio })));
    for (const value of ['Entrada', '20/09/2026', '5715', 'Ventura', 'ABC1D23', 'Óleo de teste', 'Insumos', '1.250,5 L', 'Item personalizado', 'Entrada extra']) {
      assert.ok(items.includes(value), value);
    }
    assert.match(items, /fv-data-table/);
    assert.doesNotMatch(items, /acp-romaneio-table|page-card/);

    const standby = renderToStaticMarkup(createElement('div', { className: 'fv-ds' }, createElement(StandbyHistoryTable, {
      entries: [{ date: '2026-09-21', standbyMinutes: 125, collaboratorCount: 3, reason: 'Aguardando liberação' }]
    })));
    for (const value of ['21/09/2026', '02:05', '3', 'Aguardando liberação']) assert.ok(standby.includes(value), value);
    assert.match(standby, /fv-data-table/);
    assert.doesNotMatch(standby, /acp-standby-table|page-card/);
  } finally { await server.close(); }
});
