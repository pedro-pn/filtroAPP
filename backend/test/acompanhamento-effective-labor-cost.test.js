import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/lib/prisma.js';
import {
  buildEffectiveAllocationIndex,
  classifyProjectHours,
  computeCollaboratorRates,
  monthsWithEffectiveAllocationDays
} from '../src/lib/acompanhamento/labor-cost.js';
import { buildProjectDetailCollaborator, divisionLaborAllocation } from '../src/lib/acompanhamento/project-detail.js';
import { buildAllocationAudit, groupUnallocatedDays } from '../src/lib/acompanhamento/allocation-audit.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} ≠ ${expected}`);
const collaborator = { id: 'c1', name: 'Ana', jobRoleId: 'role1', jobRole: { id: 'role1', name: 'Operador' }, jobRoleHistory: [] };

function allocation(overrides = {}) {
  return {
    id: 'a1', collaboratorId: 'c1',
    mission: {
      id: 'm1', projectId: 'p1', mobilizationDate: '2026-09-20', executionEndDate: '2026-09-30',
      scheduleStatus: 'CONFIRMED', plan: { kind: 'OFFICIAL', status: 'ACTIVE' }
    },
    ...overrides
  };
}

function mockCalculation(t, { start = '2026-09-01', end = '2026-09-30', days = [], reports = [], allocations = [allocation()] } = {}) {
  const stub = (model, method, implementation) => {
    const original = prisma[model][method];
    prisma[model][method] = implementation;
    t.after(() => { prisma[model][method] = original; });
  };
  const mock = (model, method, value) => stub(model, method, async () => value);
  mock('pontoImport', 'findMany', [{ id: 'i1', createdAt: '2026-10-01', periodStart: start, periodEnd: end }]);
  mock('pontoPeriodSummary', 'findMany', [{
    collaboratorId: 'c1', collaborator, monthly: { '2026-09': { days } }
  }]);
  mock('pontoExternalEmployee', 'findMany', []);
  mock('jobRole', 'findMany', [{ name: 'Operador', costProfile: { parameterSets: [
    { effectiveDate: '2026-01-01', params: { salarioBase: 3960 } }
  ] } }]);
  mock('costProfile', 'findMany', [{ key: 'operador', parameterSets: [{ effectiveDate: '2026-01-01', params: {
    cargaHoraria: 220, diasUteis: 22, periculosidadePct: 0.3, transferenciaPct: 0.3
  } }] }]);
  stub('report', 'findMany', async ({ where }) => where.project?.offshore ? [] : reports);
  mock('acompanhamentoSetting', 'findUnique', { numberValue: 0 });
  mock('project', 'findMany', [{ id: 'p1', code: '1001', laborSleepModeByCollaborator: { c1: 'HOME' } }]);
  mock('pontoProjectTagAlias', 'findMany', []);
  mock('acompanhamentoMissionGroup', 'findMany', []);
  mock('efetivoMissionAllocation', 'findMany', allocations);
  mock('efetivoMissionPlan', 'findMany', allocations.map(item => ({ projectId: item.mission.projectId })));
  mock('pontoDayProjectOverride', 'findMany', []);
  mock('collaboratorAbsence', 'findMany', []);
  mock('workforceHoliday', 'findMany', []);
  mock('workforceCalendarState', 'findUnique', { revision: 1 });
}

test('mobilização em 20/09 inclui dez dias de custo antes do primeiro RDO de 30/09', async t => {
  mockCalculation(t, {
    days: [{ date: '2026-09-30', workedMinutes: 480, extrasMinutes: 0 }],
    reports: [{
      reportType: 'RDO', projectId: 'p1', project: { code: '1001' }, reportDate: '2026-09-30',
      sequenceNumber: 1, daytimeWorkedMinutes: 480, collaborators: [{ collaboratorId: 'c1' }]
    }]
  });
  const { byCollaboratorId } = await computeCollaboratorRates();
  const rate = byCollaboratorId.get('c1');
  const alloc = rate.analyticalByProject.p1;
  near(alloc.hours, 11 * 8.8);
  assert.ok(alloc.cost > 0);
  assert.equal(alloc.travelHours, 0, 'alocação não presume viagem');
  assert.deepEqual(rate.workedDates, ['2026-09-30']);
  const idleDays = rate.allocationTrail.filter(day => day.noActivityContext);
  assert.equal(idleDays.length, 10, 'inclui também sábado e domingo dentro da mobilização');
  assert.equal(idleDays[0].date, '2026-09-20');
  assert.equal(idleDays.at(-1).date, '2026-09-29');
  assert.ok(idleDays.every(day => day.normalHours === 0 && day.costNormalHours === 8.8 && !day.travelContext));
  assert.ok(idleDays.every(day => day.tags.includes('Dia sem atividade/viagem')));
  assert.equal(rate.workforceDays.workedDuringAbsence.length, 0);
  near(Object.values(rate.byProject).reduce((sum, item) => sum + item.cost, 0)
    + rate.idle.sede.cost + rate.idle.folga.cost, rate.totalMensal);

  const detail = buildProjectDetailCollaborator({
    rate, allocation: alloc, projectId: 'p1', workedMinutes: 480,
    workedMinutesByDate: new Map([['2026-09-30', 480]]), includeCollaboratorCosts: true
  });
  assert.equal(detail.horas, 8);
  assert.equal(detail.horasRelatoriosPorData.length, 1);
  assert.equal(detail.diasApropriados.filter(day => day.semAtividade).length, 10);
  assert.equal(detail.horasDeslocamento, 0);

  const division = divisionLaborAllocation({ pontoImport: {}, byCollaboratorId }, 'p1', {
    startDate: '2026-09-20', endDate: '2026-09-29'
  });
  near(division.total.hours, 88);
  assert.ok(division.total.laborCost > 0);
  assert.equal(division.byCollaboratorId.get('c1').travelHours, 0);

  const audit = buildAllocationAudit({ rates: [rate], projectId: 'p1' }).collaborators[0];
  near(audit.totals.byProject[0].normalHours, 96.8);
  assert.equal(audit.days[0].totalHours, 0, 'não altera as horas efetivamente registradas no ponto');
  assert.equal(audit.days[0].appropriatedTotalHours, 8.8);
});

test('alocação gera custo antes de qualquer RDO, mesmo com resumo de ponto vazio', async t => {
  mockCalculation(t, { start: '2026-09-20', end: '2026-09-29' });
  const { rates } = await computeCollaboratorRates();
  const rate = rates[0];
  assert.equal(rate.hasCostProfile, true);
  assert.deepEqual(rate.workedDates, []);
  near(rate.byProject.p1.hours, 88);
  assert.ok(rate.byProject.p1.cost > 0);
  const detail = buildProjectDetailCollaborator({
    rate, allocation: rate.analyticalByProject.p1, projectId: 'p1'
  });
  assert.equal(detail.horas, 0);
  assert.equal(detail.horasLancadas, 0);
  assert.deepEqual(detail.horasRelatoriosPorData, []);
  assert.equal(detail.diasApropriados.length, 10);
});

test('ponto existente não duplica custo; RDO e viagem conservam seus contextos', async t => {
  mockCalculation(t, {
    start: '2026-09-20', end: '2026-09-22',
    days: [
      { date: '2026-09-21', workedMinutes: 600, extrasMinutes: 0 },
      { date: '2026-09-22', workedMinutes: 480, extrasMinutes: 0, tags: ['EM VIAGEM'] }
    ]
  });
  const { rates } = await computeCollaboratorRates();
  const rate = rates[0];
  near(rate.byProject.p1.hours, 8.8 + 10 + 8.8);
  near(rate.byProject.p1.travelHours, 8.8);
  assert.deepEqual(rate.workedDates, ['2026-09-21', '2026-09-22']);
  assert.equal(rate.allocationTrail.filter(day => day.date === '2026-09-21').length, 1);
  assert.equal(rate.allocationTrail[2].noActivityContext, false);
});

test('datas individuais e pausas prevalecem, limitadas ao período de custo e sem duplicar linhas', () => {
  const index = buildEffectiveAllocationIndex([allocation({
    cycles: [
      { mobilizationDate: '2026-09-28', demobilizationDate: '2026-10-01' },
      { mobilizationDate: '2026-10-05', demobilizationDate: '2026-10-08' }
    ]
  })]);
  const period = {
    collaboratorId: 'c1', workedDates: ['2026-09-30'], workedMinutes: 480, he70Minutes: 0, he100Minutes: 0
  };
  const months = monthsWithEffectiveAllocationDays(period, index, '2026-09-29', '2026-10-06');
  assert.deepEqual(months.map(month => month.monthKey), ['2026-09', '2026-10']);
  const days = months.flatMap(month => month.days);
  assert.deepEqual(days.map(day => day.date), ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-05', '2026-10-06']);
  assert.equal(days[1].normalHours, 8);
  assert.deepEqual(period.workedDates, ['2026-09-30']);
});

test('alocações conflitantes sem ponto entram em pendência e podem ser resolvidas manualmente', () => {
  const effectiveAllocationIndex = buildEffectiveAllocationIndex([
    allocation(), allocation({ id: 'a2', mission: { ...allocation().mission, projectId: 'p2' } })
  ]);
  const context = { effectiveAllocationIndex, collaboratorId: 'c1' };
  const rows = [{ date: '2026-09-21', normalHours: 0, he70Horas: 0, he100Horas: 0, tags: [] }];
  const classify = overrides => classifyProjectHours(rows, null, undefined, new Map(), overrides, new Map(), 'ACCOUNTING', context);
  const pending = classify(new Map());
  assert.equal(pending.byProject.size, 0);
  const queue = groupUnallocatedDays({ rates: [{ ...pending, allocationTrail: pending.dayTrail }] });
  assert.equal(queue.counts.actionableDays, 1);
  assert.equal(queue.counts.conflictDays, 1);
  const resolved = classify(new Map([['2026-09-21', ['p2']]]));
  near(resolved.byProject.get('p2').normalHours, 8.8);
  assert.deepEqual(resolved.unresolvedDays, []);
  assert.equal(resolved.dayTrail[0].noActivityContext, true);
});
