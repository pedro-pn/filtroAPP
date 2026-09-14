import assert from 'node:assert/strict';
import test from 'node:test';
import AdmZip from 'adm-zip';
import { DOMParser } from '@xmldom/xmldom';
import { buildRlqDocx } from '../src/lib/report-rlq.js';
import { assertCleaningMeasurement, cleaningSystemQuantity } from '../src/lib/reports/cleaning-measurement.js';
import { addRealizedService, buildProgress, buildProgressHistory, buildRequiredWeeklyProgress } from '../src/lib/acompanhamento/avanco.js';
import { normalizeHistoricalRow, parseHistoricalServicesCsv, historicalReportsAsServices, historicalFingerprint } from '../src/lib/reports/historical-services.js';

const registry = ['01', '02'].map(ug => ({ id: `system-${ug}`, equipment: `UG ${ug}`, name: 'Mancal & reservatório', aliases: [] }));
const planned = [{ serviceType: 'LIMPEZA_QUIMICA', weight: 100, systems: [
  ...registry.map(system => ({ projectSystemId: system.id, projectSystem: system, systemType: 'SISTEMA', quantity: 2, unit: 'UN' })),
  { projectSystemId: registry[0].id, projectSystem: registry[0], systemType: 'TUBULACAO', quantity: 100, unit: 'M' }
] }];
const service = (extraData = {}) => ({ serviceType: 'limpeza', finalized: true, system: registry[0].name, reportDate: '2026-01-01',
  extraData: { equipmentId: 'UG 01', limpezaTubulacao: 'Não', quantidadeSistemas: '1', tubes: [{ d: '2', c: '80', lengthUnit: 'm' }], ...extraData } });

test('whole-system cleaning validates counts and never invents a quantity for old reports', () => {
  for (const value of ['', null, undefined, 0, -1, 0.5, '1,5', 'abc', true, [], {}, 1e12, Infinity]) {
    assert.equal(cleaningSystemQuantity({ quantidadeSistemas: value }), null, String(value));
    assert.throws(() => assertCleaningMeasurement(service({ quantidadeSistemas: value })), /inteira positiva/);
  }
  assert.throws(() => assertCleaningMeasurement({ ...service(), system: '  ' }), /nome/);
  assert.doesNotThrow(() => assertCleaningMeasurement(service()));
  assert.doesNotThrow(() => assertCleaningMeasurement(service({ limpezaTubulacao: 'Sim', quantidadeSistemas: '' })));
  assert.equal(cleaningSystemQuantity({ 'Quantidade de sistemas (un)': '2' }), 2);
});

test('units, meters, UGs and weekly history remain separate; stale hidden fields do not count', () => {
  const realized = new Map();
  const services = [service(), service({ limpezaTubulacao: 'Sim', quantidadeSistemas: 99, tubes: [{ d: '2', c: 50 }] }), service({ quantidadeSistemas: undefined })];
  services.forEach(item => addRealizedService(realized, item));
  const result = buildProgress(planned, realized);
  assert.deepEqual(result.services[0].systems.map(row => [row.unit, row.realizedQty]), [['UN', 1], ['UN', 0], ['M', 50]]);
  assert.equal(result.progressPct, 37.5); // mean of 1/4 units and 50/100 meters
  assert.equal(buildProgressHistory(planned, services).at(-1).progressPct, result.progressPct);
  const pace = buildRequiredWeeklyProgress(result, { expectedEndDate: '2026-01-08', referenceDate: '2026-01-01' });
  assert.equal(pace.services[0].systems[0].unit, 'UN');
  const pending = new Map(); addRealizedService(pending, { ...service(), system: 'Nome não associado' });
  assert.equal(buildProgress(planned, pending).pendingMeasurements[0].unit, 'UN');
  const otherService = new Map(); addRealizedService(otherService, { ...service(), serviceType: 'pressao' });
  assert.equal(otherService.get('TESTE_PRESSAO').sistemasUn, 0);
});

test('CSV accepts UN/unidades only for chemical cleaning, with no diameter and integral quantity', () => {
  const row = { relatorio: 'RLQ', numero: '10', data: '01/01/2026', servico: 'Limpeza química', equipamento: 'UG 01', sistema: registry[0].name, diametro: '', quantidade: '2', unidade: 'unidades' };
  const normalized = normalizeHistoricalRow(row);
  assert.equal(normalized.item.unit, 'UN');
  for (const patch of [{ unidade: 'kg' }, { quantidade: '1,5' }, { diametro: '2' }, { unidadeDiametro: 'pol' }, { servico: 'Teste de pressão', relatorio: 'RTP' }, { servico: 'Flushing', relatorio: 'RCPU' }]) {
    assert.throws(() => normalizeHistoricalRow({ ...row, ...patch }));
  }
  const csv = 'Relatorio;Numero;Data;Servico;Equipamento do cliente;Sistema;Diametro;Quantidade;Unidade\nRLQ;10;01/01/2026;Limpeza;UG 01;Mancal & reservatório;;1;UN\nRLQ;10;01/01/2026;Limpeza;UG 01;Mancal & reservatório;2;50;m';
  const parsed = parseHistoricalServicesCsv(csv);
  assert.deepEqual(parsed.errors, []);
  const report = { ...parsed.reports[0], projectId: 'p' };
  const services = historicalReportsAsServices([report]);
  assert.equal(services.length, 2); // pipe and unit measurement cannot overwrite each other's mode
  const realized = new Map(); services.forEach(item => addRealizedService(realized, item));
  assert.deepEqual(buildProgress(planned, realized).services[0].systems.map(item => item.realizedQty), [1, 0, 50]);
  assert.equal(historicalFingerprint(report), historicalFingerprint({ ...report, items: report.items.map(item => ({ ...item, projectSystemId: registry[0].id })) }));
});

test('printed RLQ uses a system/count table, keeps pipe reports unchanged and tolerates legacy No reports', async () => {
  const report = { reportType: 'RLQ', sequenceNumber: 1, reportDate: '2026-01-01', project: { code: 'TEST', name: 'Teste', operator: {} } };
  const document = async data => {
    const zip = new AdmZip(await buildRlqDocx({ ...report, specialConditions: { serviceData: data } }));
    return new DOMParser().parseFromString(zip.readAsText('word/document.xml'), 'text/xml');
  };
  const textOf = doc => Array.from(doc.getElementsByTagName('w:t')).map(n => n.textContent).join('|');
  const data = { Sistema: registry[0].name, 'Limpeza de tubulação?': 'Não', 'Quantidade de sistemas (un)': 2, 'Diâmetros e comprimentos': [{ d: '3', c: '9876' }] };
  const units = await document(data);
  assert.match(textOf(units), /SISTEMAS/);
  assert.match(textOf(units), /Quantidade \(un\)/);
  assert.match(textOf(units), /2 un/);
  assert.match(textOf(units), /Mancal & reservatório/);
  assert.doesNotMatch(textOf(units), /9876|Diâmetro|Comprimento/);
  const legacy = await document({ ...data, 'Quantidade de sistemas (un)': null });
  assert.doesNotMatch(textOf(legacy), /Quantidade \(un\)|9876/);
  const pipes = await document({ ...data, 'Limpeza de tubulação?': 'Sim' });
  assert.match(textOf(pipes), /Diâmetro/);
  assert.match(textOf(pipes), /9876 m/);
  assert.doesNotMatch(textOf(pipes), /2 un|Quantidade \(un\)/);
});
