import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { createServer } from 'vite';

test('Custo mantém navegação e valores de custo/hora no layout migrado', async () => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  try {
    const { CostEngineManager } = await server.ssrLoadModule('/src/components/projects/CostEngineManager.tsx');
    client.setQueryData(['ponto-colaboradores'], {
      importId: 'imp-1', periodStart: '2026-09-01', periodEnd: '2026-09-30', fileName: 'ponto.xlsx', unmatched: [],
      rates: [{
        collaboratorId: 'c1', name: 'Ana Souza', role: 'Soldadora', hasCostProfile: true,
        normalHoras: 160, he70Horas: 8, he100Horas: 4, totalMensal: 5500, custoHora: 31.25,
        idle: { sede: { cost: 120, hours: 4 }, folga: { cost: 60, hours: 2 } }, months: []
      }]
    });
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client },
      createElement(MemoryRouter, { initialEntries: ['/?cost=rates'] },
        createElement(CostEngineManager, { canManageCosts: false }))));
    assert.match(html, /fv-ds acp-cost-ds/);
    assert.match(html, /role="tab"[^>]*aria-selected="true"/);
    for (const value of ['Ana Souza', 'Soldadora', '160h', '8h', '4h', 'R$ 5.500,00', 'R$ 31,25']) {
      assert.ok(html.includes(value), value);
    }
    assert.match(html, /fv-data-table/);
    assert.doesNotMatch(html, /page-card|acp-seg-btn|mini-btn/);
  } finally { client.clear(); await server.close(); }
});

test('históricos do ponto mantêm dados e só permitem excluir planilhas', async () => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try {
    const { PontoSyncHistoryTable, PontoCurrentDataHistoryTable } = await server.ssrLoadModule('/src/components/projects/PontoImportPanel.tsx');
    const runs = [{ id: 's1', status: 'FAILED', trigger: 'MANUAL', periodStart: '2026-09-01',
      periodEnd: '2026-09-07', completedAt: null, pendingCount: 2, employeesRead: 3,
      workDaysRead: 8, timeCardsRead: 15, collaboratorsMatched: 1, startedAt: '2026-09-08T10:00:00Z',
      errorMessage: 'Falha de conexão' }];
    const syncHtml = renderToStaticMarkup(createElement('div', { className: 'fv-ds' },
      createElement(PontoSyncHistoryTable, { runs })));
    for (const value of ['Falhou', 'Falha de conexão', '01/09/2026', '07/09/2026', '8 jornadas', '15 batidas', '2 pendência(s)']) {
      assert.ok(syncHtml.includes(value), value);
    }
    assert.match(syncHtml, /fv-data-table/);
    assert.doesNotMatch(syncHtml, /acp-table|ponto-history-table/);

    const imports = [
      { id: 'i1', source: 'PONTOMAIS_API', fileName: 'api.json', periodStart: '2026-09-01', periodEnd: '2026-09-07',
        rowsRead: 10, collaboratorsTotal: 3, collaboratorsMatched: 2, status: 'READY', createdAt: '2026-09-08' },
      { id: 'i2', source: 'XLSX', fileName: 'contingencia.xlsx', periodStart: '2026-09-08', periodEnd: '2026-09-14',
        rowsRead: 20, collaboratorsTotal: 4, collaboratorsMatched: 3, status: 'READY', createdAt: '2026-09-15' }
    ];
    const managerHtml = renderToStaticMarkup(createElement('div', { className: 'fv-ds' },
      createElement(PontoCurrentDataHistoryTable, { imports, isManager: true, onDelete() {} })));
    assert.match(managerHtml, /API Ponto Mais/);
    assert.match(managerHtml, /Planilha XLSX/);
    assert.match(managerHtml, /contingencia\.xlsx/);
    assert.equal((managerHtml.match(/Excluir importação/g) ?? []).length, 1);
    assert.doesNotMatch(managerHtml, /acp-table|ponto-history-table/);

    const viewerHtml = renderToStaticMarkup(createElement('div', { className: 'fv-ds' },
      createElement(PontoCurrentDataHistoryTable, { imports, isManager: false, onDelete() {} })));
    assert.doesNotMatch(viewerHtml, /Excluir importação/);
  } finally { await server.close(); }
});
