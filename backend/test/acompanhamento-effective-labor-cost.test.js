import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/lib/prisma.js';
import {
  buildEffectiveAllocationIndex,
  classifyProjectHours,
  computeCollaboratorRates,
  laborCostByProject,
  monthsWithEffectiveAllocationDays
} from '../src/lib/acompanhamento/labor-cost.js';
import { clearProjectDerivedCaches } from '../src/lib/resource-list-cache.js';
import { buildProjectDetailCollaborator, divisionLaborAllocation } from '../src/lib/acompanhamento/project-detail.js';
import { buildAllocationAudit, groupUnallocatedDays } from '../src/lib/acompanhamento/allocation-audit.js';
import { computeMonthlyCost } from '../src/lib/acompanhamento/cost-engine.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} ≠ ${expected}`);
const collaborator = { id: 'c1', name: 'Ana', jobRoleId: 'role1', jobRole: { id: 'role1', name: 'Operador' }, jobRoleHistory: [] };
const modelParams = {
  cargaHoraria: 220, diasUteis: 22, periculosidadePct: 0.3, produtividadePct: 0.15, transferenciaPct: 0.3
};

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

function mockCalculation(t, {
  start = '2026-09-01', end = '2026-09-30', days = [], reports = [], allocations = [allocation()],
  laborSleepModeByCollaborator = { c1: 'HOME' }, person = collaborator, reportRead, availabilityRead
} = {}) {
  const stub = (model, method, implementation) => {
    const original = prisma[model][method];
    prisma[model][method] = implementation;
    t.after(() => { prisma[model][method] = original; });
  };
  const mock = (model, method, value) => stub(model, method, async () => value);
  mock('pontoImport', 'findMany', [{ id: 'i1', createdAt: '2026-10-01', periodStart: start, periodEnd: end }]);
  mock('pontoPeriodSummary', 'findMany', [{
    collaboratorId: 'c1', collaborator: person, monthly: { '2026-09': { days } }
  }]);
  mock('pontoExternalEmployee', 'findMany', []);
  mock('jobRole', 'findMany', [{ id: person.jobRole.id, name: person.jobRole.name }]);
  mock('costProfile', 'findMany', [
    { key: 'role-profile', jobRoleId: person.jobRole.id, parameterSets: [{ effectiveDate: '2026-01-01', params: { salarioBase: 3960 } }] },
    { key: 'operador', jobRoleId: null, parameterSets: [{ effectiveDate: '2026-01-01', params: modelParams }] }
  ]);
  const reportRows = reports.map((report, index) => ({ id: 'report-' + index, ...report }));
  stub('report', 'findMany', async args => reportRead
    ? (await reportRead(args)).map((report, index) => ({ id: 'report-' + index, ...report }))
    : args.where.project?.offshore ? [] : reportRows);
  mock('reportService', 'findMany', reportRows.filter(report => report.reportType !== 'RDO')
    .flatMap(report => (report.services || []).map(service => ({ reportId: report.id, ...service }))));
  mock('acompanhamentoSetting', 'findUnique', { numberValue: 0 });
  mock('acompanhamentoSetting', 'findMany', ['epiAnnualCost', 'examsTrainingAnnualCost', 'offshoreExamsTrainingAnnualCost'].map(key => ({ key, numberValue: 0 })));
  mock('project', 'findMany', [{ id: 'p1', code: '1001', laborSleepModeByCollaborator }]);
  mock('pontoProjectTagAlias', 'findMany', []);
  mock('acompanhamentoMissionGroup', 'findMany', []);
  mock('efetivoMissionAllocation', 'findMany', allocations.map(({ mission, cycles, ...item }) => ({ ...item, missionId: mission.id })));
  mock('efetivoMissionPlan', 'findMany', allocations.map(({ mission: { plan, cycles, ...mission } }) => ({ ...mission, planId: 'official' })));
  mock('efetivoAllocationCycle', 'findMany', allocations.flatMap(item => (item.cycles || []).map(cycle => ({ ...cycle, allocationId: item.id }))));
  mock('efetivoMissionCycle', 'findMany', allocations.flatMap(item => (item.mission.cycles || []).map(cycle => ({ ...cycle, missionId: item.mission.id }))));
  mock('efetivoPlan', 'findMany', [{ id: 'official', kind: 'OFFICIAL', status: 'ACTIVE' }]);
  mock('pontoDayProjectOverride', 'findMany', []);
  mock('allocationReviewDay', 'findMany', []);
  stub('collaboratorAbsence', 'findMany', async args => availabilityRead ? availabilityRead(args) : []);
  mock('workforceHoliday', 'findMany', []);
  mock('workforceCalendarState', 'findUnique', { revision: 1 });
  mock('collaborator', 'findMany', person.rdoCostSimulationExcluded ? [{ id: person.id }] : []);
  clearProjectDerivedCaches();
  t.after(clearProjectDerivedCaches);
}

test('exclusão cadastrada impede custo e horas de apropriação sintética no dashboard, preservando o cálculo mensal', async t => {
  for (const role of ['Gerente de Operação', 'Coordenador(a) de Operações']) {
    await t.test(role, async t => {
      mockCalculation(t, {
        start: '2026-09-21', end: '2026-09-27',
        person: { ...collaborator, jobRole: { id: 'role1', name: role }, rdoCostSimulationExcluded: true }
      });
      const monthly = (await computeCollaboratorRates()).byCollaboratorId.get('c1');
      near(monthly.analyticalByProject.p1.hours, 61.6);
      assert.ok(monthly.analyticalByProject.p1.cost > 0);
      assert.deepEqual(monthly.workedDates, []);

      const projectLabor = await laborCostByProject();
      assert.equal(projectLabor.byCollaboratorId.has('c1'), false);
      assert.equal(projectLabor.byProjectId.has('p1'), false);
      const detail = buildProjectDetailCollaborator({
        workedMinutes: 480, workedMinutesByDate: new Map([['2026-09-21', 480]]),
        allocation: projectLabor.byCollaboratorId.get('c1')?.analyticalByProject.p1,
        includeCollaboratorCosts: true
      });
      assert.equal(detail.horas, 8);
      assert.equal(detail.horasApropriadas, null);
      assert.equal(detail.custo, null);
      assert.equal(detail.custoHora, null);
      assert.equal(detail.custoEstimadoRdo, null);
    });
  }
});

test('excluir e reincluir nos projetos também vale com ponto real, sem alterar o cálculo mensal', async t => {
  mockCalculation(t, {
    start: '2026-09-21', end: '2026-09-21',
    days: [{ date: '2026-09-21', workedMinutes: 600, extrasMinutes: 0 }],
    reports: [{
      reportType: 'RDO', projectId: 'p1', project: { code: '1001' }, reportDate: '2026-09-21',
      daytimeWorkedMinutes: 480, collaborators: [{ collaboratorId: 'c1' }]
    }]
  });
  let excluded = false;
  prisma.collaborator.findMany = async () => excluded ? [{ id: 'c1' }] : [];
  const monthlyBefore = (await computeCollaboratorRates()).byCollaboratorId.get('c1');
  const included = await laborCostByProject();
  assert.ok(included.byProjectId.get('p1').laborCost > 0);
  near(included.byProjectId.get('p1').hours, 10);

  excluded = true;
  clearProjectDerivedCaches();
  const hidden = await laborCostByProject();
  assert.equal(hidden.byProjectId.has('p1'), false);
  assert.equal(hidden.byCollaboratorId.has('c1'), false);
  const monthlyAfter = (await computeCollaboratorRates()).byCollaboratorId.get('c1');
  near(monthlyAfter.totalMensal, monthlyBefore.totalMensal);
  assert.deepEqual(monthlyAfter.analyticalByProject, monthlyBefore.analyticalByProject);
  assert.deepEqual(monthlyAfter.workedDates, monthlyBefore.workedDates);

  excluded = false;
  clearProjectDerivedCaches();
  const restored = await laborCostByProject();
  assert.deepEqual(restored.byProjectId.get('p1'), included.byProjectId.get('p1'));
});

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
    startDate: '2026-09-20', mobilizationDate: '2026-09-20', endDate: '2026-09-29'
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

test('hospedagem do cronograma define as verbas na folha e no projeto, inclusive em viagem', async t => {
  for (const mode of ['HOME', 'AWAY', null]) {
    await t.test(mode ?? 'fora por padrão', async t => {
      const laborSleepModeByCollaborator = mode ? { c1: mode } : {};
      mockCalculation(t, {
        start: '2026-09-21', end: '2026-09-23', laborSleepModeByCollaborator,
        days: [
          { date: '2026-09-21', workedMinutes: 528, extrasMinutes: 0 },
          { date: '2026-09-22', workedMinutes: 528, extrasMinutes: 0, tags: ['EM VIAGEM'] }
        ],
        reports: [{
          reportType: 'RDO', projectId: 'p1', project: { code: '1001', laborSleepModeByCollaborator },
          reportDate: '2026-09-21', daytimeWorkedMinutes: 528, collaborators: [{ collaboratorId: 'c1' }]
        }]
      });
      const { rates: [rate] } = await computeCollaboratorRates();
      const params = { ...modelParams, salarioBase: 3960 };
      const expected = computeMonthlyCost(params, mode === 'HOME' ? { diasCasa: 3 } : { diasFora: 3 });
      const fixed = computeMonthlyCost(params).totalMensal;
      const variable = expected.totalMensal - fixed;
      const total = Math.round((fixed * 3 / 30 + variable) * 100) / 100;
      assert.ok((mode === 'HOME' ? expected.produtividade : expected.transferencia) > 0);
      assert.equal(mode === 'HOME' ? expected.transferencia : expected.produtividade, 0);
      near(rate.totalMensal, total);
      near(rate.variavelMensal, variable);
      for (const allocation of [rate.byProject.p1, rate.analyticalByProject.p1]) {
        near(allocation.cost, total);
        near(allocation.costBase, total);
        near(allocation.hours, 26.4);
        near(allocation.travelHours, 8.8);
      }
      assert.deepEqual(rate.allocationTrail.map(day => day.travelContext), [false, true, false]);
      assert.equal(rate.allocationTrail[2].noActivityContext, true);
    });
  }
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

test('calendário/ausências começam enquanto relatórios estão pendentes, sem alterar o resultado', { timeout: 3000 }, async t => {
  let armed = false, releaseReports;
  const gate = new Promise(resolve => { releaseReports = resolve; });
  const events = [];
  const reports = [{ reportType: 'RDO', sequenceNumber: 1, projectId: 'p1', reportDate: new Date('2026-09-21'),
    daytimeWorkedMinutes: 480, nighttimeWorkedMinutes: 0, collaborators: [{ collaboratorId: 'c1' }], services: [] }];
  mockCalculation(t, {
    days: [{ date: '2026-09-21', workedMinutes: 480, tags: [] }], reports,
    reportRead: async ({ where }) => {
      if (where.project?.offshore) return [];
      if (armed) { events.push('reports-pending'); await gate; events.push('reports-complete'); }
      return reports;
    },
    availabilityRead: async () => { if (armed) { events.push('availability'); releaseReports(); } return []; }
  });
  t.after(releaseReports);
  const expected = await computeCollaboratorRates();
  armed = true;
  const actual = await computeCollaboratorRates();
  assert.deepEqual(actual, expected);
  assert.ok(events.indexOf('availability') < events.indexOf('reports-complete'), events.join(', '));
});

test('falha na disponibilidade rejeita a leitura e a requisição seguinte consulta novamente', async t => {
  let fail = true, reads = 0;
  mockCalculation(t, { availabilityRead: async () => {
    reads++;
    if (fail) throw new Error('availability temporarily unavailable');
    return [];
  } });
  await assert.rejects(computeCollaboratorRates(), /availability temporarily unavailable/);
  fail = false;
  const recovered = await computeCollaboratorRates();
  assert.equal(reads, 2);
  assert.equal(recovered.rates.length, 1);
  assert.equal(recovered.rates[0].workforceCalendarRevision, 1);
});
