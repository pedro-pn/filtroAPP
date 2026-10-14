import assert from 'node:assert/strict';
import test from 'node:test';
import AdmZip from 'adm-zip';
import { DOMParser } from '@xmldom/xmldom';
import prisma from '../src/lib/prisma.js';
import { assertPressureHoseMeasurement, pressureHoseQuantity } from '../src/lib/reports/pressure-hose-measurement.js';
import { assertSystemTypeWhenVisible } from '../src/lib/reports/system-type-validation.js';
import { addRealizedService, buildProgress, buildProgressHistory, buildRequiredWeeklyProgress } from '../src/lib/acompanhamento/avanco.js';
import { extractServiceMeasurements } from '../src/lib/acompanhamento/realized-measurements.js';
import { measurementReconciliation } from '../src/lib/acompanhamento/system-reconciliation.js';
import { setPlannedScope } from '../src/lib/acompanhamento/planned-scope.js';
import { buildRtpDocx } from '../src/lib/report-rtp.js';
import { buildRdoProgressRows } from '../src/lib/reports/rdo-progress-table.js';
import { definirEscopo, quantidadeDoServico } from '../src/lib/databook/progresso.js';
import { assertCompleteTubeRows } from '../src/routes/resources/reports.js';

const system = { id: 'hose-system', equipment: 'UG 01', name: 'Alimentação', aliases: [] };
const hoseService = (extraData = {}) => ({ serviceType: 'pressao', finalized: true, system: system.name, reportDate: '2026-10-14',
  extraData: { equipmentId: system.equipment, equipamentoTestado: 'mangueira', medicaoMangotes: 'UN', quantidadeMangotes: '4',
    quantidadeSistemas: '99', tubes: [{ d: '2', c: '500' }], volumeOleo: '200', ...extraData } });
const plannedRow = (systemType, quantity, unit) => ({ projectSystemId: system.id, projectSystem: system, systemType, quantity, unit });

test('teste de mangueiras por unidade exige contagem inteira e dispensa metragem e diâmetro', () => {
  assert.doesNotThrow(() => assertPressureHoseMeasurement(hoseService()));
  assert.doesNotThrow(() => assertSystemTypeWhenVisible(hoseService()));
  assert.doesNotThrow(() => assertCompleteTubeRows([hoseService({ tubes: [] })]));
  assert.throws(() => assertCompleteTubeRows([hoseService({ medicaoMangotes: 'M', tubes: [] })]), /diâmetro e comprimento/);
  assert.throws(() => assertCompleteTubeRows([hoseService({ equipamentoTestado: 'tubulacao', tubes: [] })]), /diâmetro e comprimento/);
  for (const quantity of [undefined, null, '', 0, -1, 1.5, '1,5', true, {}, 1e12, Infinity]) {
    assert.equal(pressureHoseQuantity({ quantidadeMangotes: quantity }), null);
    assert.throws(() => assertPressureHoseMeasurement(hoseService({ quantidadeMangotes: quantity })), /inteira positiva de mangotes/);
  }
  assert.equal(pressureHoseQuantity({ 'Quantidade de mangotes (un)': '12' }), 12);
  assert.deepEqual(extractServiceMeasurements(hoseService()).map(row => [row.systemType, row.quantity]), [['MANGOTE', 4]]);
  assert.deepEqual(extractServiceMeasurements({ ...hoseService(), serviceType: 'limpeza', extraData: { equipamentoTestado: 'mangueira', medicaoMangotes: 'UN', quantidadeMangotes: 4 } }), []);
});

test('avanço e histórico mantêm mangotes separados de sistemas completos e metros do mesmo sistema', () => {
  const planned = [{ serviceType: 'TESTE_PRESSAO', weight: 50,
    systems: [plannedRow('MANGOTE', 10, 'UN'), plannedRow('TUBULACAO', 100, 'M')] },
    { serviceType: 'LIMPEZA_QUIMICA', weight: 50, systems: [plannedRow('SISTEMA', 2, 'UN')] }];
  const services = [hoseService(),
    { ...hoseService({ limpezaTubulacao: 'Não', quantidadeSistemas: 1 }), serviceType: 'limpeza' },
    hoseService({ medicaoMangotes: 'M', tubes: [{ d: '2', c: '50' }], volumeOleo: '' })];
  const realized = new Map(); services.forEach(service => addRealizedService(realized, service));
  const progress = buildProgress(planned, realized);
  assert.deepEqual(progress.services[0].systems.map(row => [row.systemType, row.realizedQty]), [['MANGOTE', 4], ['TUBULACAO', 50]]);
  assert.equal(progress.services[1].systems[0].realizedQty, 1);
  assert.equal(progress.progressPct, 47.5);
  assert.equal(buildProgressHistory(planned, services).at(-1).progressPct, progress.progressPct);
  const weekly = buildRequiredWeeklyProgress(progress, { expectedEndDate: '2026-10-21', referenceDate: '2026-10-14' });
  assert.equal(weekly.services[0].systems[0].unit, 'UN');
  assert.equal(weekly.services[0].systems[0].requiredQtyPerWeek, 6);
  const measurement = { ...extractServiceMeasurements(hoseService())[0], serviceType: 'pressao', unit: 'UN' };
  assert.equal(measurementReconciliation(measurement, planned, [system]).status, 'MATCHED');
  assert.equal(measurementReconciliation(measurement, [{ ...planned[0], systems: planned[0].systems.slice(1) }], [system]).status, 'MEASUREMENT_MISMATCH');
  const pending = buildProgress([{ ...planned[0], systems: planned[0].systems.slice(1) }], realized);
  assert.deepEqual(pending.pendingMeasurements.map(row => [row.systemType, row.quantity, row.unit]), [['MANGOTE', 4, 'UN']]);
});

test('escopo salva e recarrega mangotes em UN sem diâmetro e rejeita contagens inválidas antes de escrever', async t => {
  let saved = [];
  // Delegates do Prisma são Proxies; restauramos as substituições após o teste.
  const stub = (target, name, implementation) => {
    const original = target[name];
    target[name] = implementation;
    t.after(() => { target[name] = original; });
  };
  stub(prisma.projectRealizedCorrection, 'findMany', async () => []);
  stub(prisma.project, 'findUnique', async () => ({ id: 'p' }));
  stub(prisma.project, 'findMany', async () => [{ id: 'p', plannedNormalHours: [], plannedOvertime: [], budgets: [], additionalProposals: [] }]);
  stub(prisma.project, 'update', async () => ({}));
  stub(prisma.projectServiceSystem, 'upsert', async () => system);
  stub(prisma.projectPlannedService, 'deleteMany', async () => { saved = []; });
  stub(prisma.projectPlannedService, 'create', async ({ data }) => { saved.push({ ...data, systems: data.systems.create }); });
  stub(prisma.projectPlannedService, 'findMany', async () => saved.map(row => ({ ...row, systems: row.systems.map(item => ({ ...item, projectSystem: system })) })));
  stub(prisma, '$transaction', async fn => fn(prisma));
  const row = { systemType: 'MANGOTE', equipment: system.equipment, systemName: system.name, quantity: 10, diameter: '2', diameterUnit: 'pol', unit: 'M' };
  const save = (patch = {}, serviceType = 'TESTE_PRESSAO') => setPlannedScope('p', { services: [{ serviceType, systems: [{ ...row, ...patch }] }] });
  const result = await save();
  assert.equal(result.services[0].systems[0].systemType, 'MANGOTE');
  assert.equal(result.services[0].systems[0].quantity, 10);
  assert.equal(result.services[0].systems[0].unit, 'UN');
  assert.equal(result.services[0].systems[0].diameter, null);
  for (const patch of [{ quantity: 0 }, { quantity: 1.5 }, { quantity: null }, { equipment: '' }, { systemName: '' }]) {
    await assert.rejects(save(patch), /inteira positiva/);
    assert.equal(saved.length, 1);
  }
  await assert.rejects(save({}, 'LIMPEZA_QUIMICA'), /teste de pressão/);
  await assert.rejects(save({}, 'FLUSHING'), /teste de pressão/);
});

test('RTP impresso e progresso do RDO exibem unidades de mangueiras sem metragem oculta', async () => {
  const extraData = hoseService().extraData;
  const report = { reportType: 'RTP', sequenceNumber: 1, reportDate: '2026-10-14', project: { code: 'TEST', name: 'Teste', operator: {} },
    specialConditions: { serviceData: { ...extraData, Sistema: system.name } } };
  const zip = new AdmZip(await buildRtpDocx(report));
  const document = new DOMParser().parseFromString(zip.readAsText('word/document.xml'), 'text/xml');
  const text = Array.from(document.getElementsByTagName('w:t')).map(node => node.textContent).join('|');
  assert.match(text, /MANGUEIRAS/);
  assert.match(text, /4 un/);
  assert.doesNotMatch(text, /Diâmetro|Comprimento|500 m|99 un/);
  const planned = [{ serviceType: 'TESTE_PRESSAO', systems: [plannedRow('MANGOTE', 10, 'UN')] }];
  const rdo = { id: 'rdo', reportType: 'RDO', reportDate: '2026-10-14', services: [hoseService()] };
  const rows = buildRdoProgressRows(rdo, planned);
  assert.equal(rows[0].progressmade, '4 mangueiras');
  assert.equal(rows[0].totalprogress, '4 mangueiras / 40%');
  assert.deepEqual(definirEscopo(planned, [rdo]), { modo: 'unidade', chave: 'mangotesUn', unidade: 'un', total: 10 });
  assert.deepEqual(quantidadeDoServico(hoseService()), { quantidade: 4, unidade: 'un.' });
});
