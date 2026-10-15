import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createServer } from 'vite';

test('statistics render quantities independently from execution counts in both dashboard layouts', async () => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    esbuild: { jsx: 'automatic' }, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  const client = new QueryClient();
  try {
    const { AuthContext } = await server.ssrLoadModule('/src/auth/AuthContext.ts');
    const { StatsDashboard } = await server.ssrLoadModule('/src/components/stats/StatsDashboard.tsx');
    const measurement = (extra) => ({ volumeOleoLiters: 0, tubesByDiameter: {}, hoseUnits: 0, systemUnits: 0, ...extra });
    const service = (extra) => {
      const item = measurement(extra);
      return { ...item, serviceCount: 1, hasTubulacao: 0,
        items: [{ ...item, serviceId: 'svc', equipmentName: 'Equipamento', system: 'Sistema' }] };
    };
    const services = {
      pressao: service({ hoseUnits: 8, tubesByDiameter: { '2 pol': 12 } }),
      limpeza: service({ systemUnits: 3 }),
      flushing: service({ volumeOleoLiters: 1500, tubesByDiameter: { '4 pol': 25 } }),
      filtragem: service({ volumeOleoLiters: 500 })
    };
    const summary = { reportCount: 1, totalDays: 1, daytimeWorkedMinutes: 480, nighttimeWorkedMinutes: 0,
      daytimeOvertimeMinutes: 0, nighttimeOvertimeMinutes: 0, standbyCount: 0, standbyMinutes: 0,
      avgDaytimeCollaborators: 1, avgNighttimeCollaborators: 0 };
    const data = { summary, services, timeline: [], projects: [],
      meta: { from: '2026-01-01', to: '2026-10-15', ignoredLegacyRows: { volumeOleo: 0, tubulacao: 0 } },
      byProject: [{ projectId: 'p', code: '01', name: 'Projeto', summary, services,
        dailyReports: [{ reportId: 'rdo', reportDate: '2026-10-15', services }] }] };
    client.setQueryDefaults(['projectStats'], { initialData: data });
    client.setQueryDefaults(['projects'], { initialData: [] });
    client.setQueryDefaults(['projectSegments'], { initialData: [] });
    for (const appearance of ['design-system', 'legacy']) {
      const html = renderToStaticMarkup(createElement(QueryClientProvider, { client },
        createElement(AuthContext.Provider, { value: { user: { id: 'manager', role: 'MANAGER' } } },
          createElement(StatsDashboard, { appearance }))));
      assert.match(html, /8 un de mangueiras/);
      assert.match(html, /3 un de sistemas/);
      assert.match(html, /1\.500 L/);
      assert.match(html, /500 L/);
      assert.match(html, /12,0 m/);
      assert.match(html, /25,0 m/);
      assert.match(html, /1 serviço/);
      assert.doesNotMatch(html, /8 serviços|3 serviços/);
    }
  } finally {
    client.clear();
    await server.close();
  }
});
