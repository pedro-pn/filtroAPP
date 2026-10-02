import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { createServer } from 'vite';

test('Sede preserva valores e recorte na interface migrada', async () => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  try {
    const { SedeCostsBoard } = await server.ssrLoadModule('/src/components/projects/SedeCostsBoard.tsx');
    const data = {
      codes: ['5002'], currentMonth: '2026-09', currentMonthLabel: 'Setembro/2026', availableMonths: ['2026-09'],
      summary: { total: 1250, paidTotal: 750, openTotal: 500, currentMonthTotal: 1250, count: 2 },
      cards: [{ code: '5002', label: 'Manutenção', shortLabel: 'Manutenção', total: 1250, paidTotal: 750,
        openTotal: 500, currentMonthTotal: 1250, count: 2, lastPurchaseDate: '2026-09-10',
        monthly: [{ month: '2026-09', label: 'Set/2026', total: 1250, paidTotal: 750, openTotal: 500, count: 2 }],
        topCategories: [{ categoria: 'Peças', total: 900, count: 1 }] }],
      operational: {
        range: null,
        maintenance: { summary: { reportCount: 3, maintenanceCount: 7, workedMinutes: 600,
          overtimeMinutes: 90, collaboratorCount: 4 }, byProfile: [{ profileName: 'Mecânico', maintenanceCount: 5 }],
          byEquipment: [{ equipmentId: 'e1', equipmentCode: 'EQ-1', equipmentName: 'Bomba', maintenanceCount: 7 }] },
        production: { summary: { reportCount: 2, totalKg: 350, workedMinutes: 480,
          overtimeMinutes: 60, collaboratorCount: 3 }, byMaterial: [{ material: 'CARBON_STEEL', totalKg: 350, cleaningCount: 2 }] }
      }
    };
    client.setQueryData(['sede-costs', '2026-09', '2026-09'], data);
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client },
      createElement(MemoryRouter, { initialEntries: ['/?section=sede&periodo=month&de=2026-09&ate=2026-09'] },
        createElement(SedeCostsBoard))));
    assert.match(html, /fv-ds acp-sede-ds/);
    assert.equal((html.match(/class="fv-metric-card /g) ?? []).length, 4);
    for (const value of ['R$ 1.250,00', 'R$ 750,00', 'R$ 500,00', 'Peças', 'Mecânico', 'EQ-1', '350 kg']) {
      assert.ok(html.includes(value), value);
    }
    assert.match(html, /aria-pressed="true"[^>]*>.*Mês/);
    assert.match(html, /fv-bar-list/);
    assert.doesNotMatch(html, /page-card|acp-pcard|acp-kpi|acp-seg-btn|mini-btn/);
  } finally { client.clear(); await server.close(); }
});
