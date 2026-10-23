import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

test('seleção do sistema aplica a unidade mecânica sem transformar meta em realizado; salvar/reabrir preserva a medição', async () => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    esbuild: { jsx: 'automatic' }, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  const client = new QueryClient();
  try {
    const { projectSystemSelectionPatch: select } = await server.ssrLoadModule('/src/utils/projectSystemSelection.ts');
    const { buildReportServicePayload } = await server.ssrLoadModule('/src/utils/reportServicePayload.ts');
    const { MechanicalMeasurementFields } = await server.ssrLoadModule('/src/components/reports/MechanicalMeasurementFields.tsx');
    for (const unit of ['M', 'KG', 'T', 'UN', 'L']) {
      const system = { id: unit, projectId: 'p', equipment: 'UG', name: 'Sistema', revision: 1,
        measurements: [{ serviceType: 'LIMPEZA_MECANICA', systemType: `MECANICA_${unit}`, unit }] };
      const data = { equipmentId: 'UG', system: '', unidadeMecanica: 'KG', quantidadeMecanica: '999' };
      const selected = { ...data, ...select([system], data, 'system', 'Sistema', 'mecanica') };
      assert.equal(selected.unidadeMecanica, unit);
      assert.equal(selected.quantidadeMecanica, '');
      selected.quantidadeMecanica = '25';
      const first = buildReportServicePayload({ type: 'mecanica', data: selected });
      const saved = buildReportServicePayload({ type: 'mecanica', data: first.extraData });
      assert.equal(saved.extraData.quantidadeMecanica, '25');
      assert.equal(saved.extraData['Unidade da limpeza mecânica'], unit);
      client.setQueryData(['project-systems', 'reports', 'p'], [system]);
      const html = renderToStaticMarkup(createElement(QueryClientProvider, { client },
        createElement(MechanicalMeasurementFields, { projectId: 'p', data: selected, groupKey: 's', onChange: () => {} })));
      assert.match(html, /Unidade definida no escopo/);
      assert.match(html, /<select[^>]+disabled/);
      assert.match(html, /value="25"/);
      assert.equal((html.match(/<option /g) ?? []).length, 2);
      if (unit === 'UN') assert.match(html, /step="1"/);
    }
    const { ProjectOverviewMetrics } = await server.ssrLoadModule('/src/components/projects/ProjectOverviewMetrics.tsx');
    const html = renderToStaticMarkup(createElement(ProjectOverviewMetrics, { card: { rentalTracking: { plannedDays: 31, elapsedDays: 23, remainingDays: 8 } } }));
    assert.match(html, /Dias de locação/);
    assert.match(html, /23 \/ 31/);
    assert.doesNotMatch(html, /HH trabalhados|RDO|Dias parados/);
  } finally { client.clear(); await server.close(); }
});
