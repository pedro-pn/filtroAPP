import assert from 'node:assert/strict';
import test from 'node:test';

import prisma from '../src/lib/prisma.js';
import { clearProjectDerivedCaches } from '../src/lib/resource-list-cache.js';
import router, {
  applyServiceReportCorrections, buildDailyReport, buildServiceExportRows, buildServiceStats
} from '../src/routes/resources/statistics.js';

const editKey = '__manualDerivedServiceReportEdit';
const editedAt = '2026-10-22T12:30:00.000Z';
const service = (id, serviceType, extraData) => ({ id, serviceType, finalized: true, extraData });
const oil = service('oil', 'filtragem', { 'Volume de óleo': '100 L' });
const tubes = service('tubes', 'flushing', { 'Diâmetros e comprimentos': [{ d: '2', c: '10', lengthUnit: 'm' }] });

function parent(services = [oil, tubes], overrides = {}) {
  return { id: 'rdo', projectId: 'project', reportType: 'RDO', status: 'SIGNED',
    sequenceNumber: 12, reportDate: '2026-10-15', daytimeWorkedMinutes: 480, services, ...overrides };
}

function correction(source, extraData, overrides = {}) {
  return { id: `corrected-${source.id}`, projectId: 'project', reportType: 'RCPU', status: 'APPROVED',
    sequenceNumber: 3, reportDate: '2026-10-22',
    specialConditions: { parentRdoId: 'rdo', serviceId: source.id,
      [editKey]: { editedAt, editedByUserId: 'manager' } },
    services: [{ ...source, id: `new-${source.id}`, extraData }], ...overrides };
}

test('corrected oil and tubing replace the signed measurements in totals, daily details and CSV', () => {
  const original = parent();
  const snapshot = structuredClone(original);
  const [report] = applyServiceReportCorrections([original], [
    correction(oil, { volumeOleo: '2', volumeOleoUnit: 'm3' }),
    correction(tubes, { tubes: [{ d: '4', unit: 'pol', c: '2500', lengthUnit: 'cm' }] })
  ]);
  const stats = buildServiceStats(report.services, { volumeOleo: 0, tubulacao: 0 });
  assert.equal(stats.filtragem.volumeOleoLiters, 2000);
  assert.equal(stats.filtragem.serviceCount, 1);
  assert.equal(stats.filtragem.correctedServiceCount, 1);
  assert.deepEqual(stats.flushing.tubesByDiameter, { '4 pol': 25 });
  assert.equal(stats.flushing.serviceCount, 1);
  const daily = buildDailyReport(report);
  assert.equal(daily.daytimeWorkedMinutes, 480);
  assert.equal(daily.reportDate, original.reportDate);
  assert.equal(daily.services.filtragem.items[0].serviceId, oil.id);
  assert.deepEqual(daily.services.filtragem.items[0].correction, {
    reportId: 'corrected-oil', reportType: 'RCPU', sequenceNumber: 3, editedAt, editedByUserId: 'manager'
  });
  assert.equal(daily.services.filtragem.items[0].volumeOleoLiters, 2000);
  const rows = buildServiceExportRows(report, { code: 'P1' });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].slice(6), ['2000.00', '', '', '', '', 'Sim', 'RCPU #3', editedAt]);
  assert.deepEqual(rows[1].slice(6), ['', '4 pol', '25.00', '', '', 'Sim', 'RCPU #3', editedAt]);
  assert.deepEqual(original, snapshot, 'signed source must remain unchanged');

  const legacy = { ...oil, finalized: null, extraData: { ...oil.extraData, 'Serviço finalizado?': 'Sim' } };
  const [legacyReport] = applyServiceReportCorrections([parent([legacy])], [correction(oil, { volumeOleo: '250' })]);
  const legacyStats = buildServiceStats(legacyReport.services, { volumeOleo: 0, tubulacao: 0 });
  assert.equal(legacyStats.filtragem.serviceCount, 1);
  assert.equal(legacyStats.filtragem.volumeOleoLiters, 250);
});

test('corrections include zero, hose and system quantities, replacing previous modes and aliases', () => {
  const hoses = service('hoses', 'pressao', { equipamentoTestado: 'mangueira', medicaoMangotes: 'UN', quantidadeMangotes: 5 });
  const systems = service('systems', 'limpeza', { 'Limpeza de tubulação?': 'Não', 'Quantidade de sistemas (un)': 2 });
  const [report] = applyServiceReportCorrections([parent([oil, tubes, hoses, systems])], [
    correction(oil, { volumeOleo: '0', volumeOleoUnit: 'L' }),
    correction(tubes, { volumeOleo: '250', tubes: [] }),
    correction(hoses, { equipamentoTestado: 'mangueira', medicaoMangotes: 'UN', quantidadeMangotes: 8 }, { reportType: 'RTP' }),
    correction(systems, { 'Limpeza de tubulação?': 'Não', 'Quantidade de sistemas (un)': 4 }, { reportType: 'RLQ' })
  ]);
  const stats = buildServiceStats(report.services, { volumeOleo: 0, tubulacao: 0 });
  assert.equal(stats.filtragem.volumeOleoLiters, 0);
  assert.equal(stats.flushing.volumeOleoLiters, 250);
  assert.deepEqual(stats.flushing.tubesByDiameter, {});
  assert.equal(stats.pressao.hoseUnits, 8);
  assert.equal(stats.limpeza.systemUnits, 4);
});

test('unrelated, deleted, unsigned, unedited and independent reports cannot change signed statistics', () => {
  const original = parent();
  const invalid = [
    { status: 'PENDING' }, { status: 'RETURNED' }, { deletedAt: new Date() }, { projectId: 'other' }, { reportType: 'RDO' },
    { specialConditions: { parentRdoId: 'rdo', serviceId: oil.id } },
    { specialConditions: { parentRdoId: 'other', serviceId: oil.id, [editKey]: { editedAt } } },
    { specialConditions: { parentRdoId: 'rdo', serviceId: 'other', [editKey]: { editedAt } } },
    { specialConditions: { parentRdoId: 'rdo', serviceId: oil.id, serviceOnly: true, [editKey]: { editedAt } } },
    { services: [] }
  ];
  for (const overrides of invalid) {
    assert.deepEqual(applyServiceReportCorrections([original], [correction(oil, { volumeOleo: '999' }, overrides)]), [original]);
  }
  for (const overrides of [{ status: 'APPROVED' }, { deletedAt: new Date() }, { specialConditions: { source: 'MANUAL_UPLOAD' } }]) {
    const source = parent([oil], overrides);
    assert.deepEqual(applyServiceReportCorrections([source], [correction(oil, { volumeOleo: '999' })]), [source]);
  }
  const unfinished = { ...oil, finalized: false };
  assert.deepEqual(applyServiceReportCorrections([parent([unfinished])], [correction(oil, { volumeOleo: '999' })]), [parent([unfinished])]);
});

test('latest correction wins once, matches stable service links and ignores edits without metric changes', () => {
  const linked = { ...oil, id: 'recreated', extraData: { ...oil.extraData, __serviceLinkKey: 'stable' } };
  const latest = correction(oil, { volumeOleo: '300' }, { specialConditions: {
    parentRdoId: 'rdo', serviceId: 'old-id', serviceLinkKey: 'stable', [editKey]: { editedAt }
  } });
  const old = correction(oil, { volumeOleo: '200' }, { id: 'old', specialConditions: {
    ...latest.specialConditions, [editKey]: { editedAt: '2026-10-21T12:00:00.000Z' }
  } });
  const [report] = applyServiceReportCorrections([parent([linked])], [latest, old]);
  assert.equal(report.services.length, 1);
  assert.equal(report.services[0].extraData.volumeOleo, '300');
  const unchanged = correction(oil, { volumeOleo: '100', volumeOleoUnit: 'L', observation: 'text only' });
  assert.deepEqual(applyServiceReportCorrections([parent([oil])], [unchanged]), [parent([oil])]);
  const reverted = { ...latest, services: [{ ...oil, extraData: { volumeOleo: '100' } }] };
  assert.deepEqual(applyServiceReportCorrections([parent([linked])], [old, reverted]), [parent([linked])]);
});

function request(path, query) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body }); }, setHeader() {},
      write(chunk) { chunks.push(chunk); }, end() { resolve({ status: this.statusCode, csv: chunks.join('') }); } };
    router.stack.find(layer => layer.route?.path === path).route.stack.at(-1).handle(
      { query, auth: { user: { id: 'manager', role: 'MANAGER' } } }, res, reject);
  });
}

test('statistics and export routes load existing corrections outside the RDO date range and keep aggregates consistent', async t => {
  const originals = { projects: prisma.project.findMany, reports: prisma.report.findMany, count: prisma.report.count };
  t.after(() => {
    prisma.project.findMany = originals.projects;
    prisma.report.findMany = originals.reports;
    prisma.report.count = originals.count;
    clearProjectDerivedCaches();
  });
  clearProjectDerivedCaches();
  prisma.project.findMany = async () => [{ id: 'project', code: 'P1', name: 'Projeto' }];
  prisma.report.count = async () => 1;
  let correctedQueries = 0;
  prisma.report.findMany = async ({ where }) => {
    if (where.reportType === 'RDO') return [parent()];
    correctedQueries++;
    assert.equal(where.reportDate, undefined);
    assert.equal(where.deletedAt, null);
    assert.deepEqual(where.projectId, { in: ['project'] });
    assert.deepEqual(where.specialConditions.path, [editKey, 'editedAt']);
    return [correction(oil, { volumeOleo: '250' }, { status: 'SIGNED' })];
  };
  const query = { from: '2026-10-15', to: '2026-10-15', projectId: 'project' };
  const response = await request('/projects', query);
  assert.equal(response.status, 200);
  assert.equal(response.body.meta.correctedServiceCount, 1);
  assert.equal(response.body.summary.reportCount, 1);
  assert.equal(response.body.summary.daytimeWorkedMinutes, 480);
  assert.equal(response.body.services.filtragem.volumeOleoLiters, 250);
  const project = response.body.byProject[0];
  assert.equal(project.services.filtragem.volumeOleoLiters, 250);
  assert.equal(project.dailyReports[0].services.filtragem.items[0].volumeOleoLiters, 250);
  assert.equal(response.body.timeline[0].serviceBreakdown.filtragem, 1);
  const csv = await request('/projects/export', { ...query, section: 'services' });
  assert.equal(csv.status, 200);
  assert.match(csv.csv, /Correção após assinatura,Relatório da correção,Corrigido em/);
  assert.match(csv.csv, /2026-10-15,P1,12,filtragem,,,250\.00,,,,,Sim,RCPU #3,2026-10-22T12:30:00\.000Z/);
  assert.equal(correctedQueries, 2);
});
