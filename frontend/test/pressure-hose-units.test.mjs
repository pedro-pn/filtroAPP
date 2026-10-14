import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const createVite = () => createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
  esbuild: { jsx: 'automatic' }, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });

test('teste de pressão mantém uma opção de mangueiras com escolha entre metragem e unidades; limpeza não tem essa opção', async () => {
  const server = await createVite();
  try {
    const { ServiceFields } = await server.ssrLoadModule('/src/components/reports/ServiceFields.tsx');
    const props = { serviceType: 'pressao', data: { equipamentoTestado: 'mangueira', medicaoMangotes: 'UN', quantidadeMangotes: '8',
      tubes: [{ d: '2', c: '150' }] }, onChange: () => {}, units: [], manometers: [], groupKey: 'mangueiras', hideUploads: true };
    const html = renderToStaticMarkup(createElement(ServiceFields, props));
    assert.match(html, /Medição das mangueiras/);
    assert.match(html, /Apenas unidades/);
    assert.match(html, /Quantidade de mangueiras \(unidades\)/);
    assert.match(html, /id="pressure-hose-quantity-mangueiras"[^>]*value="8"/);
    assert.doesNotMatch(html, /Diâmetros e comprimentos|Comprimento|Mangotes \(unidades\)/);
    assert.equal((html.match(/<span>Mangueiras<\/span>/g) || []).length, 1);
    const measured = renderToStaticMarkup(createElement(ServiceFields, { ...props, data: { ...props.data, medicaoMangotes: 'M' } }));
    assert.match(measured, /Diâmetros e comprimentos/);
    assert.doesNotMatch(measured, /pressure-hose-quantity-/);
    const legacy = renderToStaticMarkup(createElement(ServiceFields, { ...props, data: { equipamentoTestado: 'mangueira' } }));
    assert.match(legacy, /Diâmetros e comprimentos/);
    const pipes = renderToStaticMarkup(createElement(ServiceFields, { ...props, data: { ...props.data, equipamentoTestado: 'tubulacao' } }));
    assert.match(pipes, /Diâmetros e comprimentos/);
    assert.doesNotMatch(pipes, /Medição das mangueiras|pressure-hose-quantity-/);
    const cleaning = renderToStaticMarkup(createElement(ServiceFields, { ...props, serviceType: 'limpeza', data: {} }));
    assert.match(cleaning, /Limpeza de tubulação\?/);
    assert.doesNotMatch(cleaning, /Mangueiras|Mangotes|Apenas unidades|pressure-hose-quantity-/);
  } finally { await server.close(); }
});

test('unidades de mangueiras sobrevivem à edição e mudam de modalidade sem reaproveitar medidas ocultas', async () => {
  const server = await createVite();
  try {
    const { pressureHoseModePatch, pressureHoseQuantity, isPressureHoseUnits } = await server.ssrLoadModule('/src/utils/pressureHoseMeasurement.ts');
    const { buildReportServicePayload } = await server.ssrLoadModule('/src/utils/reportServicePayload.ts');
    const { legacyServiceData } = await server.ssrLoadModule('/src/pages/reportDetailServiceData.ts');
    const { projectSystemSelectionPatch: select } = await server.ssrLoadModule('/src/utils/projectSystemSelection.ts');
    const data = { ...pressureHoseModePatch(true), equipmentId: 'UG 01', system: 'Alimentação', quantidadeMangotes: '8', tubes: [{ d: '2', c: '150' }] };
    for (const quantity of ['', null, true, '0', '-1', '1,5', '1.5', '1000000000000']) {
      assert.equal(pressureHoseQuantity({ quantidadeMangotes: quantity }), null);
    }
    const payload = buildReportServicePayload({ type: 'pressao', data });
    assert.equal(payload.extraData['Equipamento testado'], 'Mangueiras');
    assert.equal(payload.extraData['Quantidade de mangotes (un)'], 8);
    assert.deepEqual(payload.extraData.tubes, []);
    assert.deepEqual(payload.extraData['Diâmetros e comprimentos'], []);
    const restored = legacyServiceData(payload);
    assert.equal(isPressureHoseUnits(restored), true);
    assert.equal(buildReportServicePayload({ type: 'pressao', data: restored }).extraData.quantidadeMangotes, 8);
    const switched = { ...data, ...pressureHoseModePatch(false) };
    assert.equal(switched.quantidadeMangotes, '');
    assert.deepEqual(switched.tubes, []);
    assert.equal(buildReportServicePayload({ type: 'pressao', data: { ...switched, quantidadeMangotes: '99' } }).extraData.quantidadeMangotes, null);
    const pipes = buildReportServicePayload({ type: 'pressao', data: { ...data, equipamentoTestado: 'tubulacao' } });
    assert.equal(pipes.extraData.quantidadeMangotes, null);
    assert.deepEqual(pipes.extraData.tubes, data.tubes);
    const system = { id: 'hose-system', equipment: data.equipmentId, name: data.system,
      measurements: [{ serviceType: 'TESTE_PRESSAO', systemType: 'MANGOTE' }] };
    const selected = select([system], { ...data, system: '' }, 'system', data.system, 'pressao');
    assert.equal(selected.medicaoMangotes, 'UN');
    assert.equal(selected.quantidadeMangotes, '');
    assert.deepEqual(selected.tubes, []);
    const mixed = { ...system, measurements: [...system.measurements, { serviceType: 'TESTE_PRESSAO', systemType: 'TUBULACAO' }] };
    assert.equal(select([mixed], data, 'system', data.system, 'pressao').medicaoMangotes, undefined);
    assert.equal(select([system], data, 'system', data.system, 'limpeza').medicaoMangotes, undefined);
    assert.equal(select([{ ...system, measurements: mixed.measurements.slice(1) }], data, 'system', data.system, 'pressao').medicaoMangotes, 'M');
  } finally { await server.close(); }
});
