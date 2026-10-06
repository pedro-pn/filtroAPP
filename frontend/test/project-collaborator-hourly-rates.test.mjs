import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('tabela apresenta os cinco cenários e informa ausência de parâmetros sem mostrar custo zero', async () => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try {
    const { CollaboratorHourlyRatesContent } = await server.ssrLoadModule('/src/components/projects/ProjectCollaboratorRatesDialog.tsx');
    const data = {
      collaboratorId: 'c1', name: 'Ana', role: 'Operador', referenceDate: '2026-09-30',
      available: true, monthlyHours: 220, workingDays: 22,
      scenarios: ['normal', 'he70', 'he100', 'offshore', 'viagem'].map((scenario, index) => ({ scenario, hourlyCost: 20 + index }))
    };
    const render = input => renderToStaticMarkup(createElement(CollaboratorHourlyRatesContent, { data: input })).replaceAll('\u00a0', ' ');
    const html = render(data);
    for (const text of ['Ana', 'Operador', '30/09/2026', 'Normal', 'Hora extra 70%', 'Hora extra 100%', 'Offshore', 'Viagem', '20,00/h', '24,00/h', 'DSR', '220h mensais']) {
      assert.ok(html.includes(text), text);
    }
    const empty = render({ ...data, available: false, scenarios: data.scenarios.map(row => ({ ...row, hourlyCost: null })) });
    assert.match(empty, /Não há parâmetros de custo disponíveis/);
    assert.match(empty, /Hora extra 100%/);
    assert.doesNotMatch(empty, /R\$|0,00\/h/);
  } finally { await server.close(); }
});
