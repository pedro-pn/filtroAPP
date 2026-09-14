import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHistoricalServicesCsv } from '../../backend/src/lib/reports/historical-services.js';

test('non-tubing cleaning asks only for quantity and keeps the header system as its name', async () => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    esbuild: { jsx: 'automatic' }, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try {
    const { ServiceFields } = await server.ssrLoadModule('/src/components/reports/ServiceFields.tsx');
    const props = { serviceType: 'limpeza', data: { system: 'Mancal', limpezaTubulacao: 'Não', quantidadeSistemas: '2' },
      onChange: () => {}, units: [], manometers: [], groupKey: 'test', hideUploads: true };
    const html = renderToStaticMarkup(createElement(ServiceFields, props));
    assert.match(html, /Quantidade executada \(unidades\)/);
    assert.match(html, /id="cleaning-quantity-test"[^>]*value="2"/);
    assert.doesNotMatch(html, /Nome do sistema limpo|cleaning-system-|value="Mancal"/);
    const pipes = renderToStaticMarkup(createElement(ServiceFields, { ...props, data: { ...props.data, limpezaTubulacao: 'Sim' } }));
    assert.match(pipes, /Diâmetro/);
    assert.doesNotMatch(pipes, /cleaning-quantity-/);
  } finally { await server.close(); }
});

test('planned system selection, report payload and historical CSV support cleaning by units', async () => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try {
    const { projectSystemSelectionPatch: select } = await server.ssrLoadModule('/src/utils/projectSystemSelection.ts');
    const { cleaningSystemQuantity, cleaningModePatch } = await server.ssrLoadModule('/src/utils/cleaningMeasurement.ts');
    const { buildReportServicePayload } = await server.ssrLoadModule('/src/utils/reportServicePayload.ts');
    const { historicalReportForm, historicalFormCsv, historicalTotals } = await server.ssrLoadModule('/src/pages/gestor/historicalServicesForm.ts');
    const system = { id: 's1', equipment: 'UG 01', name: 'Mancal', measurements: [{ serviceType: 'LIMPEZA_QUIMICA', systemType: 'SISTEMA' }] };
    const data = { equipmentId: 'UG 01', system: '', tubes: [{ d: '2', c: '35' }], quantidadeSistemas: '7' };
    const selected = { ...data, ...select([system], data, 'system', 'Mancal', 'LIMPEZA') };
    assert.equal(selected.limpezaTubulacao, 'Não');
    assert.equal(selected.system, 'Mancal');
    assert.equal(selected.__projectSystemId, 's1');
    assert.equal(selected.quantidadeSistemas, ''); // never turn a plan or stale count into execution
    assert.deepEqual(selected.tubes, []);
    assert.equal(select([system], data, 'system', 'Livre', 'limpeza').__projectSystemId, null);
    assert.equal(select([system], data, 'system', 'Mancal', 'flushing').limpezaTubulacao, undefined);
    assert.equal(select([{ ...system, equipment: 'UG 02' }], data, 'system', 'Mancal', 'limpeza').limpezaTubulacao, undefined);
    const mixed = { ...system, measurements: [...system.measurements, { serviceType: 'LIMPEZA_QUIMICA', systemType: 'TUBULACAO' }] };
    assert.equal(select([mixed], data, 'system', 'Mancal', 'limpeza').limpezaTubulacao, undefined);
    const pipeSystem = { ...system, id: 's2', measurements: [{ serviceType: 'LIMPEZA_QUIMICA', systemType: 'TUBULACAO' }] };
    assert.equal(select([pipeSystem], selected, 'system', 'Mancal', 'limpeza').limpezaTubulacao, 'Sim');
    for (const value of ['', '0', '-1', '1.5', '1,5', true, null]) assert.equal(cleaningSystemQuantity({ quantidadeSistemas: value }), null);
    const payload = buildReportServicePayload({ type: 'limpeza', data: { ...selected, quantidadeSistemas: '2', tubes: data.tubes } });
    assert.equal(payload.equipmentId, null);
    assert.equal(payload.system, 'Mancal');
    assert.equal(payload.extraData['Quantidade de sistemas (un)'], 2);
    assert.deepEqual(payload.extraData.tubes, []);
    assert.deepEqual(payload.extraData['Diâmetros e comprimentos'], []);
    const pipePayload = buildReportServicePayload({ type: 'limpeza', data: { ...selected, ...cleaningModePatch('Sim'), quantidadeSistemas: '2', tubes: data.tubes } });
    assert.equal(pipePayload.extraData.quantidadeSistemas, null);
    assert.deepEqual(pipePayload.extraData.tubes, data.tubes);
    const report = { reportType: 'RLQ', sequenceNumber: 2, reportDate: '2026-01-01', items: [{ serviceType: 'limpeza', equipment: 'UG 01', system: 'Mancal', diameter: '', quantity: 2, unit: 'UN' }] };
    const parsed = parseHistoricalServicesCsv(historicalFormCsv(historicalReportForm(report)));
    assert.deepEqual(parsed.errors, []);
    assert.deepEqual(parsed.reports[0].items, report.items);
    assert.deepEqual(historicalTotals([...report.items, { ...report.items[0], unit: 'm', quantity: 35 }]), [{ serviceType: 'limpeza', unit: 'UN', quantity: 2 }, { serviceType: 'limpeza', unit: 'm', quantity: 35 }]);
  } finally { await server.close(); }
});
