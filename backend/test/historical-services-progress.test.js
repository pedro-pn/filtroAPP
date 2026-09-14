import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/lib/prisma.js';
import { computeProgressForProjects, computeProgressHistoryForProjects } from '../src/lib/acompanhamento/avanco.js';
import { HISTORICAL_CSV_TEMPLATE, parseHistoricalServicesCsv } from '../src/lib/reports/historical-services.js';

function fixture(t) {
  const csv = HISTORICAL_CSV_TEMPLATE
    .replace(';2;35;m', ";2';3500;cm")
    .replace(';5000;L', ';5000000;mL')
    .replace('02/01/2026', '09/01/2026')
    .replace('03/01/2026', '17/01/2026')
    .replace('04/01/2026', '25/01/2026')
    + 'RCPU;002;25/01/2026;Flushing;Unidade Geradora 01;Kaplan;;1000000;mL\r\n';
  const parsed = parseHistoricalServicesCsv(csv);
  assert.deepEqual(parsed.errors, []);
  const state = {
    project: { id: 'project-5719-fixture', manualProgressPct: 18, startDate: null, updatedAt: new Date('2026-09-14') },
    historical: parsed.reports.map(report => ({
      ...report, projectId: 'project-5719-fixture', reportDate: new Date(report.reportDate), createdAt: new Date('2026-09-14')
    })),
    planned: [
      { serviceType: 'LIMPEZA_QUIMICA', weight: 3, systems: [{ systemType: 'TUBULACAO', quantity: 100, unit: 'M' }] },
      { serviceType: 'FILTRAGEM', weight: 1, systems: [{ systemType: 'OLEO', quantity: 10000, unit: 'L' }] },
      { serviceType: 'TESTE_PRESSAO', weight: 1, systems: [{ systemType: 'TUBULACAO', quantity: 70, unit: 'M' }] },
      { serviceType: 'FLUSHING', weight: 1, systems: [
        { systemType: 'TUBULACAO', quantity: 90, unit: 'M' }, { systemType: 'OLEO', quantity: 2000, unit: 'L' }
      ] }
    ].map(service => ({ ...service, projectId: 'project-5719-fixture' })),
    sources: [], native: []
  };
  // Prisma expõe métodos por Proxy, sem descriptor compatível com t.mock.method.
  // Substituições locais a este processo de teste, sempre restauradas ao final.
  const stubFindMany = (model, implementation) => {
    const original = prisma[model].findMany;
    prisma[model].findMany = implementation;
    t.after(() => { prisma[model].findMany = original; });
  };
  const inProjects = (record, ids) => ids.includes(record.projectId);
  stubFindMany('project', async ({ where }) => where.id.in.includes(state.project.id) ? [state.project] : []);
  stubFindMany('projectPlannedService', async ({ where }) => state.planned.filter(record => inProjects(record, where.projectId.in)));
  stubFindMany('historicalServiceReport', async ({ where }) => {
    assert.equal(where.project.deletedAt, null);
    return state.historical.filter(record => inProjects(record, where.projectId.in));
  });
  stubFindMany('report', async ({ where }) => {
    assert.equal(where.deletedAt, null);
    return state.sources.filter(record => inProjects(record, where.projectId.in));
  });
  stubFindMany('reportService', async ({ where }) => {
    assert.equal(where.report.deletedAt, null);
    return state.native.filter(record => inProjects(record.report, where.report.projectId.in));
  });
  stubFindMany('projectManualProgressHistory', async () => []);
  return state;
}

test('CSV alimenta o avanço real dos quatro serviços com cm/mL, pesos e datas de emissão', async t => {
  const state = fixture(t);
  const progress = (await computeProgressForProjects([state.project.id])).get(state.project.id);
  assert.equal(progress.hasScope, true);
  assert.equal(progress.progressMethod, 'RDO'); // Nome legado do método automático, inclui históricos.
  assert.equal(progress.progressPct, 65);
  const byType = new Map(progress.services.map(service => [service.serviceType, service]));
  assert.equal(byType.get('LIMPEZA_QUIMICA').systems[0].realizedQty, 80);
  assert.equal(byType.get('FILTRAGEM').systems[0].realizedQty, 5000);
  assert.equal(byType.get('TESTE_PRESSAO').systems[0].realizedQty, 35);
  assert.deepEqual(byType.get('FLUSHING').systems.map(system => [system.unit, system.realizedQty]), [['M', 45], ['L', 1000]]);
  assert.deepEqual((await computeProgressHistoryForProjects([state.project.id])).get(state.project.id), [
    { date: '2026-01-01', progressPct: 40 },
    { date: '2026-01-09', progressPct: 48.3 },
    { date: '2026-01-17', progressPct: 56.7 },
    { date: '2026-01-25', progressPct: 65 }
  ]);
});

test('sem escopo conserva avanço manual; cadastrar metas depois aproveita o histórico existente', async t => {
  const state = fixture(t);
  const planned = state.planned;
  state.planned = [];
  assert.deepEqual((await computeProgressForProjects([state.project.id])).get(state.project.id), {
    hasScope: false, progressPct: 18, services: [], progressMethod: 'MANUAL'
  });
  assert.deepEqual((await computeProgressHistoryForProjects([state.project.id])).get(state.project.id), [
    { date: '2026-09-14', progressPct: 18 }
  ]);
  state.planned = planned;
  assert.equal((await computeProgressForProjects([state.project.id])).get(state.project.id).progressPct, 65);
  assert.equal((await computeProgressHistoryForProjects([state.project.id])).get(state.project.id).at(-1).date, '2026-01-25');
});

test('PDF manual compatível não duplica medições; serviço nativo posterior passa a prevalecer', async t => {
  const state = fixture(t);
  const historical = state.historical.find(report => report.reportType === 'RLQ');
  const source = { ...historical, id: 'native-source', services: [], specialConditions: { source: 'MANUAL_UPLOAD', serviceOnly: true } };
  state.sources = [source];
  assert.equal((await computeProgressForProjects([state.project.id])).get(state.project.id).progressPct, 65);
  source.services = [{ id: 'native-service' }];
  state.native = [{ finalized: true, serviceType: 'limpeza', extraData: { tubes: [{ c: 80, lengthUnit: 'm' }] }, report: source }];
  assert.equal((await computeProgressForProjects([state.project.id])).get(state.project.id).progressPct, 65);
  assert.equal((await computeProgressHistoryForProjects([state.project.id])).get(state.project.id).at(-1).progressPct, 65);
});

test('conflito de data exclui o histórico do cálculo até corrigir a data da fonte', async t => {
  const state = fixture(t);
  const historical = state.historical.find(report => report.reportType === 'RLQ');
  const source = { ...historical, id: 'source', services: [], reportDate: new Date('2026-01-17'), specialConditions: { serviceOnly: true } };
  state.sources = [source];
  assert.equal((await computeProgressForProjects([state.project.id])).get(state.project.id).progressPct, 25);
  assert.equal((await computeProgressHistoryForProjects([state.project.id])).get(state.project.id).at(-1).progressPct, 25);
  source.reportDate = historical.reportDate;
  assert.equal((await computeProgressForProjects([state.project.id])).get(state.project.id).progressPct, 65);
});

test('medições de outro projeto não entram no realizado ou curva deste projeto', async t => {
  const state = fixture(t);
  state.historical = state.historical.map(report => ({ ...report, projectId: 'other-project' }));
  assert.equal((await computeProgressForProjects([state.project.id])).get(state.project.id).progressPct, 0);
  assert.deepEqual((await computeProgressHistoryForProjects([state.project.id])).get(state.project.id), []);
});
