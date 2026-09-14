import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HISTORICAL_CSV_TEMPLATE, buildHistoricalPreview, historicalReportsAsServices,
  normalizeHistoricalRow, parseHistoricalServicesCsv, readHistoricalCsv
} from '../src/lib/reports/historical-services.js';
import { commitHistoricalImport, previewHistoricalImport, updateHistoricalReport } from '../src/lib/reports/historical-services-store.js';

const header = 'Relatorio;Numero;Data;Servico;Equipamento do cliente;Sistema;Diametro (pol);Quantidade;Unidade';
const row = 'RLQ;001;01/01/2026;Limpeza química;Unidade Geradora 01;Kaplan;2;35;m';
const csv = `${header}\n${row}\n${row.replace(';2;35;m', ';3;45;m')}`;
const canonical = () => parseHistoricalServicesCsv(csv).reports[0];

test('groups final measurements by source report with free customer equipment, not app equipment IDs', () => {
  const parsed = parseHistoricalServicesCsv(csv);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.reports.length, 1);
  assert.deepEqual(parsed.reports[0].items.map(item => item.quantity), [35, 45]);
  assert.equal(parsed.reports[0].items[0].equipment, 'Unidade Geradora 01');
  assert.equal(parsed.reports[0].items[0].equipmentId, undefined);
  assert.equal(parsed.reports[0].reportDate, '2026-01-01');
  assert.equal(parsed.reports[0].sequenceNumber, 1);
});

test('template covers chemical cleaning, pressure tests, filtration and flushing with correct source types', () => {
  const parsed = parseHistoricalServicesCsv(HISTORICAL_CSV_TEMPLATE);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.reports.length, 4);
  assert.equal(parsed.reports.find(report => report.items[0].serviceType === 'flushing').reportType, 'RCPU');
  assert.equal(parsed.reports.find(report => report.items[0].serviceType === 'filtragem').items[0].quantity, 5000);
});

test('CSV supports BOM, Excel separator, CRLF, quotes, embedded semicolons/newlines, fractions and decimal comma', () => {
  const text = `\uFEFFsep=;\r\n${header}\r\nRLQ;1;2026-01-01;Limpeza química;"UG; 01";"Kaplan ""A""\nSistema";1 1/2;1.234,5;m\r\n`;
  const parsed = parseHistoricalServicesCsv(text);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.reports[0].items[0].equipment, 'UG; 01');
  assert.equal(parsed.reports[0].items[0].system, 'Kaplan "A"\nSistema');
  assert.equal(parsed.reports[0].items[0].diameter, '1 1/2');
  assert.equal(parsed.reports[0].items[0].quantity, 1234.5);
  const commaCsv = 'Relatorio,Numero,Data,Servico,Equipamento,Sistema,Diametro,Quantidade,Unidade\nRLQ,1,01/01/2026,limpeza,UG,Kaplan,2,"35,5",m';
  assert.equal(parseHistoricalServicesCsv(commaCsv).reports[0].items[0].quantity, 35.5);
});

test('reports row errors and does not silently accept incomplete numbers, dates, units or repeated measurements', () => {
  for (const invalid of [row.replace('01/01/2026', '31/02/2026'), row.replace(';35;m', ';35abc;m'),
    row.replace(';35;m', ';0;m'), row.replace(';35;m', ';-5;m'), row.replace(';35;m', ';35;L'),
    row.replace(';2;35', ';1/0;35'), row.replace('RLQ', 'RDO'), row.replace('Unidade Geradora 01', '')]) {
    assert.equal(parseHistoricalServicesCsv(`${header}\n${invalid}`).errors.length, 1, invalid);
  }
  assert.match(parseHistoricalServicesCsv(`${header}\n${row}\n${row}`).errors[0].message, /repetida/);
  assert.match(parseHistoricalServicesCsv(`${csv}\n${row.replace('01/01', '02/01')}`).errors[0].message, /mesma data/);
  assert.throws(() => readHistoricalCsv(`${header}\n"unclosed`), /não fechado/);
  assert.throws(() => parseHistoricalServicesCsv('Relatorio;Numero\nRLQ;1'), /Colunas ausentes/);
  assert.throws(() => readHistoricalCsv('x'.repeat(500001)), /500 KB/);
  assert.equal(parseHistoricalServicesCsv(`${header}\n${row};extra`).errors.length, 1);
});

test('oil does not require a diameter and tubing preserves decimal precision', () => {
  const normalized = normalizeHistoricalRow({ relatorio: 'RCPU', numero: '1', data: '01/01/2026', servico: 'Filtragem', equipamento: 'Tanque cliente', sistema: 'Lubrificação', diametro: '', quantidade: '35.125', unidade: 'L' });
  assert.equal(normalized.item.quantity, 35.125);
  assert.equal(normalized.item.diameter, '');
});

test('validates pol/apostrophe diameter units and converts cm/mL without mixing dimensions', () => {
  const length = `${header}\n${row.replace(';2;35;m', ";2';3500;cm")}\n${row.replace(';2;35;m', ';3pol;45;m')}`;
  const parsed = parseHistoricalServicesCsv(length);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.reports[0].items.map(item => [item.diameter, item.quantity, item.unit]), [['2', 3500, 'cm'], ['3', 45, 'm']]);
  assert.equal(parsed.reports[0].fingerprint, canonical().fingerprint);
  const separated = `${header};Unidade do diâmetro\n${row};'`;
  assert.deepEqual(parseHistoricalServicesCsv(separated).errors, []);
  assert.deepEqual(parseHistoricalServicesCsv(`${header};Unidade do diâmetro\n${row};pol`).errors, []);
  assert.match(parseHistoricalServicesCsv(`${header};Unidade do diâmetro\n${row};cm`).errors[0].message, /diâmetro inválida/);
  const volume = `${header}\nRCPU;1;01/01/2026;Filtragem;Tanque do cliente;Lubrificação;;5000000;mL`;
  const oil = parseHistoricalServicesCsv(volume);
  assert.deepEqual(oil.errors, []);
  assert.equal(oil.reports[0].items[0].unit, 'mL');
  assert.equal(historicalReportsAsServices(oil.reports.map(report => ({ ...report, projectId: 'p' })))[0].extraData.volumeOleo, 5000);
  for (const invalid of ['kg', 'm/L', 'm!', 'pol', 'm²']) assert.ok(parseHistoricalServicesCsv(volume.replace(';mL', `;${invalid}`)).errors.length, invalid);
  assert.ok(parseHistoricalServicesCsv(volume.replace(';mL', ';cm')).errors.length);
  assert.ok(parseHistoricalServicesCsv(`${header}\n${row.replace(';m', ';mL')}`).errors.length);
});

test('preview skips identical reports regardless of row order, rejects changed reports and native measurements', () => {
  const report = { ...canonical(), id: 'old', revision: 1 };
  const parsed = parseHistoricalServicesCsv(csv);
  assert.equal(buildHistoricalPreview(parsed, [], []).canImport, true);
  assert.equal(buildHistoricalPreview(parsed, [report], []).reports[0].action, 'SKIP');
  const reordered = parseHistoricalServicesCsv(`${header}\n${row.replace(';2;35;m', ';3;45;m')}\n${row}`);
  assert.equal(buildHistoricalPreview(reordered, [report], []).reports[0].action, 'SKIP');
  const changed = parseHistoricalServicesCsv(csv.replace(';35;m', ';36;m'));
  assert.equal(buildHistoricalPreview(changed, [report], []).reports[0].action, 'CONFLICT');
  for (const source of [
    { ...report, services: [{ id: 'service' }] },
    { ...report, specialConditions: { parentRdoId: 'rdo' } },
    { ...report, services: [], reportDate: '2026-01-02' }
  ]) assert.equal(buildHistoricalPreview(parsed, [], [source]).canImport, false);
  assert.equal(buildHistoricalPreview(parsed, [], [{ ...report, services: [] }]).reports[0].sourceReportId, 'old');
});

test('historical measurements count once in progress, with meters/liters separate and no working hours', () => {
  const report = { ...canonical(), projectId: 'p1' };
  const services = historicalReportsAsServices([report]);
  assert.equal(services.length, 1);
  assert.equal(services[0].finalized, true);
  assert.equal(services[0].extraData.tubes.reduce((sum, tube) => sum + tube.c, 0), 80);
  assert.equal(services[0].extraData.volumeOleo, 0);
  assert.equal(services[0].startTime, undefined);
  const source = { ...report, services: [{ id: 'native' }] };
  assert.deepEqual(historicalReportsAsServices([report], [source]), []);
  assert.equal(historicalReportsAsServices([report], [{ ...source, projectId: 'p2' }]).length, 1);
  assert.equal(historicalReportsAsServices([report], [{ ...source, services: [] }]).length, 1);
  assert.equal(historicalReportsAsServices([report], [{ ...source, services: [], reportDate: '2026-01-02' }]).length, 0);
});

function database() {
  const records = [];
  let creates = 0;
  const client = {
    project: { findFirst: async ({ where }) => where.id === 'missing' ? null : { id: where.id } },
    report: { findMany: async () => [] },
    historicalServiceReport: {
      findMany: async ({ where }) => records.filter(record => record.projectId === where.projectId),
      create: async ({ data }) => {
        creates++;
        const record = { ...data, id: `id-${creates}`, revision: 1 };
        records.push(record); return record;
      },
      findFirst: async ({ where }) => records.find(record => record.id === where.id && record.projectId === where.projectId),
      updateMany: async ({ where, data }) => {
        const record = records.find(record => record.id === where.id && record.projectId === where.projectId && record.revision === where.revision);
        if (!record) return { count: 0 };
        Object.assign(record, data, { revision: record.revision + 1 }); return { count: 1 };
      },
      findUnique: async ({ where }) => records.find(record => record.id === where.id)
    },
    $transaction: async callback => callback(client)
  };
  return { client, records, get creates() { return creates; } };
}

test('import requires a fresh project-specific preview, is idempotent and rejects invalid batches before writing', async () => {
  const db = database();
  const preview = await previewHistoricalImport(db.client, 'p1', csv);
  await assert.rejects(commitHistoricalImport(db.client, { projectId: 'p2', csv, token: preview.token, userId: 'u' }), /nova prévia/);
  await assert.rejects(commitHistoricalImport(db.client, { projectId: 'p1', csv: `${csv}\n${row}`, token: preview.token, userId: 'u' }), /erros/);
  assert.equal(db.creates, 0);
  assert.deepEqual(await commitHistoricalImport(db.client, { projectId: 'p1', csv, token: preview.token, userId: 'u' }), { created: 1, skipped: 0 });
  assert.deepEqual(await commitHistoricalImport(db.client, { projectId: 'p1', csv, token: preview.token, userId: 'u' }), { created: 0, skipped: 1 });
  assert.equal(db.creates, 1);
  assert.equal(db.records[0].createdByUserId, 'u');
  await assert.rejects(previewHistoricalImport(db.client, 'missing', csv), /Projeto não encontrado/);
});

test('editing replaces the complete report quantities without additions and rejects stale revision/cross-project IDs', async () => {
  const db = database();
  const preview = await previewHistoricalImport(db.client, 'p1', csv);
  await commitHistoricalImport(db.client, { projectId: 'p1', csv, token: preview.token, userId: 'u' });
  const content = csv.replace(';35;m', ';36;m');
  await assert.rejects(updateHistoricalReport(db.client, { projectId: 'p2', id: 'id-1', csv: content, revision: 1, userId: 'u2' }), /não encontrado/);
  const updated = await updateHistoricalReport(db.client, { projectId: 'p1', id: 'id-1', csv: content, revision: 1, userId: 'u2' });
  assert.equal(updated.items.length, 2);
  assert.equal(updated.items[0].quantity, 36);
  assert.equal(updated.revision, 2);
  assert.equal(updated.updatedByUserId, 'u2');
  await assert.rejects(updateHistoricalReport(db.client, { projectId: 'p1', id: 'id-1', csv, revision: 1, userId: 'u' }), /outra pessoa/);
});
