import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWeeklyProgressComparison, corporateToday, dateOnlyKey, weekStartKey } from '../../shared/modules/mission-weekly-progress.js';
import { buildProgressHistory } from '../src/lib/acompanhamento/avanco.js';
import { deleteWeeklyProgressTarget, deleteWeeklyProgressTargetSchema, listWeeklyProgressTargets, saveWeeklyProgressTarget, weeklyProgressTargetSchema, weeklyTargetReferenceDayHours } from '../src/lib/acompanhamento/weekly-progress-targets.js';
import { deleteMissionWeeklyProgressTarget, getMissionWeeklyProgressTargets, saveMissionWeeklyProgressTarget } from '../src/lib/efetivo/planning/weekly-progress-targets.js';

const target = (weekStartDate, plannedPctPoints, revision = 1) => ({ id: `${weekStartDate}-${revision}`, weekStartDate, plannedPctPoints, revision });
const point = (date, progressPct) => ({ date, progressPct });
const rowFor = (rows, week) => rows.find(row => row.weekStartDate === week);

test('semana começa na segunda, cruza meses/anos e usa a data corporativa', () => {
  assert.equal(weekStartKey('2026-10-04'), '2026-09-28');
  assert.equal(weekStartKey('2027-01-01'), '2026-12-28');
  assert.equal(corporateToday(new Date('2026-09-28T01:00:00Z')), '2026-09-27');
  assert.equal(dateOnlyKey('2026-02-30'), null);
  assert.equal(dateOnlyKey(new Date('invalid')), null);
});

test('compara o ganho semanal, conserva semanas sem medição e não confunde acumulado com ganho', () => {
  const input = {
    today: '2026-10-02',
    targets: [target('2026-09-07', 10), target('2026-09-14', 5), target('2026-09-21', 10), target('2026-09-28', 3)],
    progressHistory: [point('2026-09-06', 30), point('2026-09-09', 35), point('2026-09-11', 40), point('2026-09-27', 55)]
  };
  const before = JSON.stringify(input);
  const rows = buildWeeklyProgressComparison(input);
  assert.equal(rowFor(rows, '2026-09-07').actualPctPoints, 10);
  assert.equal(rowFor(rows, '2026-09-07').status, 'ON_TARGET');
  assert.equal(rowFor(rows, '2026-09-14').actualPctPoints, 0);
  assert.equal(rowFor(rows, '2026-09-14').differencePctPoints, -5);
  assert.equal(rowFor(rows, '2026-09-14').status, 'BELOW');
  assert.equal(rowFor(rows, '2026-09-21').differencePctPoints, 5);
  assert.equal(rowFor(rows, '2026-09-21').status, 'ABOVE');
  assert.equal(rowFor(rows, '2026-09-28').inProgress, true);
  assert.equal(JSON.stringify(input), before);
});

test('semanas futuras, sem meta ou sem histórico não são classificadas como abaixo da meta', () => {
  const rows = buildWeeklyProgressComparison({ today: '2026-09-30', targets: [target('2026-09-21', 0), target('2026-10-05', 10)] });
  assert.equal(rowFor(rows, '2026-09-21').status, 'NO_DATA');
  assert.equal(rowFor(rows, '2026-09-21').actualPctPoints, null);
  assert.equal(rowFor(rows, '2026-09-28').status, 'NO_TARGET');
  assert.equal(rowFor(rows, '2026-10-05').status, 'PLANNED');
  assert.equal(rowFor(rows, '2026-10-05').differencePctPoints, null);
});

test('compara pela última revisão, arredonda decimais e preserva correções negativas', () => {
  const rows = buildWeeklyProgressComparison({ today: '2026-09-30',
    targets: [target('2026-09-28', 0.1, 2), target('2026-09-28', 5, 1), target('2026-09-21', 0)],
    progressHistory: [point('2026-09-20', 50), point('2026-09-27', 40), point('2026-09-29', 40.1), point('2026-10-01', 100)]
  });
  assert.equal(rowFor(rows, '2026-09-28').differencePctPoints, 0);
  assert.equal(rowFor(rows, '2026-09-28').target.revision, 2);
  assert.equal(rowFor(rows, '2026-09-21').actualPctPoints, -10);
});

test('usa o histórico real ponderado dos serviços finalizados e o histórico manual', () => {
  const scope = [{ serviceType: 'FLUSHING', weight: 1, systems: [{ systemType: 'TUBULACAO', unit: 'M', quantity: 100 }] }];
  const history = buildProgressHistory(scope, [
    { reportDate: '2026-09-20', serviceType: 'FLUSHING', finalized: true, extraData: { tubes: [{ c: 30, lengthUnit: 'm' }] } },
    { reportDate: '2026-09-22', serviceType: 'FLUSHING', finalized: false, extraData: { tubes: [{ c: 50, lengthUnit: 'm' }] } },
    { reportDate: '2026-09-25', serviceType: 'FLUSHING', finalized: true, extraData: { tubes: [{ c: 10, lengthUnit: 'm' }] } }
  ], { startDate: '2026-09-01' });
  const rows = buildWeeklyProgressComparison({ today: '2026-09-30', progressHistory: history, targets: [target('2026-09-21', 10)] });
  assert.equal(rowFor(rows, '2026-09-21').actualPctPoints, 10);
  const manual = buildProgressHistory([], [], { startDate: '2026-09-01', manualProgressPct: 40,
    manualProgressHistory: [{ recordedAt: '2026-09-20', progressPct: 30 }, { recordedAt: '2026-09-25', progressPct: 40 }] });
  assert.equal(rowFor(buildWeeklyProgressComparison({ today: '2026-09-30', progressHistory: manual }), '2026-09-21').actualPctPoints, 10);
});

test('valida meta, precisão, segunda-feira e revisão antes de gravar', () => {
  const payload = { weekStartDate: '2026-09-28', plannedPctPoints: 10, expectedRevision: 0 };
  for (const changes of [{ plannedPctPoints: -1 }, { plannedPctPoints: 101 }, { plannedPctPoints: 0.001 }, { plannedPctPoints: '' }, { weekStartDate: '2026-09-29' }, { weekStartDate: '2026-02-30' }, { expectedRevision: -1 }]) {
    assert.equal(weeklyProgressTargetSchema.safeParse({ ...payload, ...changes }).success, false);
  }
  assert.equal(weeklyProgressTargetSchema.safeParse({ ...payload, plannedPctPoints: 0 }).success, true);
  assert.equal(weeklyProgressTargetSchema.safeParse({ ...payload, plannedPctPoints: 100 }).success, true);
});

function database() {
  const records = [];
  const matches = (row, where) => Object.entries(where).every(([key, value]) => key === 'weekStartDate' ? +row[key] === +value : row[key] === value);
  return {
    records,
    project: { findFirst: async () => ({ id: 'p1' }), findMany: async () => [{ workdayHours: '09:00', weekendWorkdayHours: '08:00' }] },
    acompanhamentoMissionGroup: { findFirst: async () => ({ id: 'g1' }) },
    efetivoMissionPlan: { findFirst: async () => ({ projectId: 'p1' }) },
    missionWeeklyProgressTarget: {
      findFirst: async ({ where }) => records.filter(row => matches(row, where)).sort((a, b) => b.revision - a.revision)[0] ?? null,
      findMany: async ({ where }) => records.filter(row => matches(row, where)),
      create: async ({ data }) => {
        const row = { ...data, id: `target-${records.length}`, createdAt: new Date('2026-09-28T12:00:00Z') };
        records.push(row);
        return row;
      }
    }
  };
}
const actor = { userId: 'u1', userName: 'Gestora' };
const payload = { weekStartDate: '2026-09-28', plannedPctPoints: 10, expectedRevision: 0 };

test('preserva revisões e metas anteriores, sem misturar missões ou agrupamentos', async () => {
  const client = database();
  await saveWeeklyProgressTarget({ projectId: 'p1' }, payload, { client, ...actor });
  await saveWeeklyProgressTarget({ projectId: 'p1' }, { ...payload, plannedPctPoints: 15, expectedRevision: 1 }, { client, ...actor });
  await saveWeeklyProgressTarget({ projectId: 'p1' }, { ...payload, weekStartDate: '2026-10-05' }, { client, ...actor });
  await saveWeeklyProgressTarget({ projectId: 'p2' }, payload, { client, ...actor });
  await saveWeeklyProgressTarget({ groupId: 'g1' }, payload, { client, ...actor });
  const rows = await listWeeklyProgressTargets({ projectId: 'p1' }, { client });
  assert.deepEqual(rows.map(row => row.plannedPctPoints), [10, 15, 10]);
  assert.deepEqual(rows[0].author, { id: 'u1', name: 'Gestora' });
  assert.equal((await listWeeklyProgressTargets({ groupId: 'g1' }, { client })).length, 1);
  await assert.rejects(saveWeeklyProgressTarget({ projectId: 'p1', groupId: 'g1' }, payload, { client, ...actor }), { status: 400 });
});

test('revisão desatualizada e colisão concorrente retornam conflito sem sobrescrever metas', async () => {
  const client = database();
  await saveWeeklyProgressTarget({ projectId: 'p1' }, payload, { client, ...actor });
  await assert.rejects(saveWeeklyProgressTarget({ projectId: 'p1' }, { ...payload, plannedPctPoints: 50 }, { client, ...actor }), { status: 409 });
  assert.equal(client.records.length, 1);
  client.missionWeeklyProgressTarget.create = async () => { throw { code: 'P2002' }; };
  await assert.rejects(saveWeeklyProgressTarget({ projectId: 'p1' }, { ...payload, plannedPctPoints: 50, expectedRevision: 1 }, { client, ...actor }), { status: 409 });
});

test('excluir desativa todas as versões anteriores da semana, preserva histórico e permite recriar', async () => {
  const client = database();
  const owner = { projectId: 'p1' };
  await saveWeeklyProgressTarget(owner, payload, { client, ...actor });
  await saveWeeklyProgressTarget(owner, { ...payload, plannedPctPoints: 20, expectedRevision: 1 }, { client, ...actor });
  await saveWeeklyProgressTarget(owner, { ...payload, weekStartDate: '2026-10-05' }, { client, ...actor });
  await saveWeeklyProgressTarget({ groupId: 'g1' }, payload, { client, ...actor });
  const removed = await deleteMissionWeeklyProgressTarget('m1', { weekStartDate: payload.weekStartDate, expectedRevision: 2 }, actor, { database: client });
  assert.equal(removed.isDeleted, true);
  assert.equal(removed.revision, 3);
  assert.equal(removed.plannedPctPoints, null);
  assert.deepEqual(removed.author, { id: 'u1', name: 'Gestora' });
  const targets = await listWeeklyProgressTargets(owner, { client });
  assert.deepEqual(targets.filter(row => row.weekStartDate === payload.weekStartDate).map(row => row.plannedPctPoints), [10, 20, null]);
  const rows = buildWeeklyProgressComparison({ targets, today: '2026-10-02', progressHistory: [point('2026-09-28', 10)] });
  assert.equal(rowFor(rows, payload.weekStartDate).status, 'NO_TARGET');
  assert.equal(rowFor(rows, payload.weekStartDate).target, null);
  assert.equal(rowFor(rows, '2026-10-05').target.plannedPctPoints, 10);
  assert.equal((await listWeeklyProgressTargets({ groupId: 'g1' }, { client }))[0].plannedPctPoints, 10);
  await assert.rejects(saveWeeklyProgressTarget(owner, { ...payload, expectedRevision: 2 }, { client, ...actor }), { status: 409 });
  const recreated = await saveWeeklyProgressTarget(owner, { ...payload, plannedPctPoints: 0, expectedRevision: 3 }, { client, ...actor });
  assert.equal(recreated.revision, 4);
  assert.equal(recreated.isDeleted, undefined);
  assert.equal(rowFor(buildWeeklyProgressComparison({ targets: await listWeeklyProgressTargets(owner, { client }), today: '2026-10-02' }), payload.weekStartDate).target.revision, 4);
});

test('exclusão valida semana, revisão, responsável e conflitos concorrentes', async () => {
  const client = database();
  const owner = { projectId: 'p1' };
  const input = { weekStartDate: payload.weekStartDate, expectedRevision: 1 };
  for (const changes of [{ weekStartDate: '2026-09-29' }, { expectedRevision: 0 }, { expectedRevision: 1.5 }, { expectedRevision: '1' }, { definition: {} }]) {
    assert.equal(deleteWeeklyProgressTargetSchema.safeParse({ ...input, ...changes }).success, false);
  }
  await assert.rejects(deleteWeeklyProgressTarget(owner, input, { client }), { status: 400 });
  await assert.rejects(deleteWeeklyProgressTarget(owner, input, { client, ...actor }), { status: 404 });
  await saveWeeklyProgressTarget(owner, payload, { client, ...actor });
  await assert.rejects(deleteWeeklyProgressTarget(owner, { ...input, expectedRevision: 2 }, { client, ...actor }), { status: 409 });
  const originalCreate = client.missionWeeklyProgressTarget.create;
  client.missionWeeklyProgressTarget.create = async () => { throw { code: 'P2002' }; };
  await assert.rejects(deleteWeeklyProgressTarget(owner, input, { client, ...actor }), { status: 409 });
  assert.equal(client.records.length, 1);
  client.missionWeeklyProgressTarget.create = originalCreate;
  await deleteWeeklyProgressTarget(owner, input, { client, ...actor });
  await assert.rejects(deleteWeeklyProgressTarget(owner, input, { client, ...actor }), { status: 409 });
  await assert.rejects(deleteWeeklyProgressTarget(owner, { ...input, expectedRevision: 2 }, { client, ...actor }), { status: 404 });
});

test('Efetivo compartilha a meta por projeto e carrega o mesmo histórico; cenário não acessa metas oficiais', async () => {
  const client = database();
  await saveWeeklyProgressTarget({ projectId: 'p1' }, payload, { client, ...actor });
  const history = [point('2026-09-25', 30)];
  const comparison = await getMissionWeeklyProgressTargets('m1', { database: client, loadHistory: async ids => {
    assert.deepEqual(ids, ['p1']);
    return new Map([['p1', history]]);
  } });
  assert.equal(comparison.targets[0].plannedPctPoints, 10);
  assert.equal(comparison.defaultReferenceDayHours, 9);
  assert.deepEqual(comparison.progressHistory, history);
  await saveMissionWeeklyProgressTarget('m1', { ...payload, plannedPctPoints: 20, expectedRevision: 1 }, actor, { database: client });
  assert.equal((await listWeeklyProgressTargets({ projectId: 'p1' }, { client }))[1].plannedPctPoints, 20);
  client.efetivoMissionPlan.findFirst = async ({ where }) => {
    assert.deepEqual(where.plan, { kind: 'OFFICIAL', status: 'ACTIVE' });
    return null;
  };
  await assert.rejects(getMissionWeeklyProgressTargets('scenario-mission', { database: client }), { status: 404 });
});

test('jornada de referência usa a jornada semanal do projeto e converte minutos, sem usar fins de semana', async () => {
  const client = database();
  client.project.findMany = async ({ where, select }) => {
    assert.deepEqual(where, { id: { in: ['p1'] }, deletedAt: null });
    assert.deepEqual(select, { workdayHours: true });
    return [{ workdayHours: '09:30', weekendWorkdayHours: '04:00' }];
  };
  assert.equal(await weeklyTargetReferenceDayHours({ projectId: 'p1' }, { client }), 9.5);
  client.project.findMany = async () => [{ workdayHours: '08:20', weekendWorkdayHours: '03:00' }];
  assert.equal(await weeklyTargetReferenceDayHours({ projectId: 'p1' }, { client }), 8.33);
  for (const workdayHours of ['', 'inválida', '00:00', '08:99', '25:00']) {
    client.project.findMany = async () => [{ workdayHours, weekendWorkdayHours: '08:00' }];
    assert.equal(await weeklyTargetReferenceDayHours({ projectId: 'p1' }, { client }), null);
  }
});

test('agrupamento usa uma jornada semanal comum; jornadas distintas não escolhem um projeto arbitrário', async () => {
  const client = database();
  client.acompanhamentoMissionGroupMember = { findMany: async () => [{ projectId: 'p1' }, { projectId: 'p2' }] };
  client.project.findMany = async ({ where }) => {
    assert.deepEqual(where, { id: { in: ['p1', 'p2'] }, deletedAt: null });
    return [{ workdayHours: '09:00' }, { workdayHours: '9:00' }];
  };
  assert.equal(await weeklyTargetReferenceDayHours({ groupId: 'g1' }, { client }), 9);
  client.project.findMany = async () => [{ workdayHours: '09:00' }, { workdayHours: '08:00' }];
  assert.equal(await weeklyTargetReferenceDayHours({ groupId: 'g1' }, { client }), null);
});

test('missões excluídas e agrupamentos dissolvidos não recebem novas metas', async () => {
  const client = database();
  client.project.findFirst = async () => null;
  await assert.rejects(saveWeeklyProgressTarget({ projectId: 'p1' }, payload, { client, ...actor }), { status: 404 });
  await assert.rejects(deleteWeeklyProgressTarget({ projectId: 'p1' }, { weekStartDate: payload.weekStartDate, expectedRevision: 1 }, { client, ...actor }), { status: 404 });
  client.acompanhamentoMissionGroup.findFirst = async ({ where }) => where.status === 'ACTIVE' ? null : { id: 'g1' };
  await assert.rejects(saveWeeklyProgressTarget({ groupId: 'g1' }, payload, { client, ...actor }), { status: 404 });
  await assert.rejects(deleteWeeklyProgressTarget({ groupId: 'g1' }, { weekStartDate: payload.weekStartDate, expectedRevision: 1 }, { client, ...actor }), { status: 404 });
  assert.deepEqual(await listWeeklyProgressTargets({ groupId: 'g1' }, { client }), []);
});

const servicePoint = (date, serviceType, M = 0, L = 0, UN = 0) => ({ date, serviceType, quantities: { M, L, UN } });
const scenario = (name, condition, goals) => ({ name, condition, goals });
const goal = (value, serviceType = null, extra = {}) => ({ serviceType, value, ...extra });
const flexibleTarget = (definition, revision = 1) => ({ ...target('2026-09-28', null, revision), definition });
const comparePhysical = (definition, serviceHistory, other = {}) => rowFor(buildWeeklyProgressComparison({
  today: '2026-10-02', targets: [flexibleTarget(definition)], serviceHistory, ...other
}), '2026-09-28');
const singleAndPair = {
  metric: 'M', scenarios: [
    scenario('Um serviço', { kind: 'SERVICE_COUNT', count: 1 }, [goal(300)]),
    scenario('Limpeza + teste', { kind: 'SERVICE_SET', serviceTypes: ['LIMPEZA_QUIMICA', 'TESTE_PRESSAO'] }, [goal(100, 'LIMPEZA_QUIMICA'), goal(100, 'TESTE_PRESSAO')])
  ]
};

test('300 m com um tipo; limpeza + teste exige 100 m de cada sem compensar entre serviços', () => {
  const single = comparePhysical(singleAndPair, [servicePoint('2026-09-28', 'LIMPEZA_QUIMICA', 100), servicePoint('2026-09-29', 'LIMPEZA_QUIMICA', 200)]);
  assert.equal(single.scenarioName, 'Um serviço');
  assert.equal(single.plannedValue, 300);
  assert.equal(single.status, 'ON_TARGET');
  const pair = comparePhysical(singleAndPair, [servicePoint('2026-09-28', 'LIMPEZA_QUIMICA', 150), servicePoint('2026-09-29', 'TESTE_PRESSAO', 50)]);
  assert.equal(pair.scenarioName, 'Limpeza + teste');
  assert.equal(pair.plannedValue, 200);
  assert.equal(pair.actualValue, 200);
  assert.equal(pair.differenceValue, 0);
  assert.equal(pair.status, 'BELOW');
  assert.equal(pair.achievementPct, 50);
  assert.deepEqual(pair.goals.map(item => item.differenceValue), [50, -50]);
});

test('filtragem usa litros no comparativo mesmo quando a medida geral é metragem', () => {
  const history = [servicePoint('2026-09-28', 'FILTRAGEM', 999, 1200)];
  const row = comparePhysical({ metric: 'M', scenarios: [scenario('Filtragem', { kind: 'ALWAYS' }, [goal(1000, 'FILTRAGEM')])] }, history);
  assert.equal(row.metric, 'L');
  assert.equal(row.goals[0].metric, 'L');
  assert.equal(row.actualValue, 1200);
  assert.equal(row.plannedValue, 1000);
  assert.equal(row.differenceValue, 200);
  assert.equal(row.status, 'ABOVE');
  const exact = comparePhysical({ metric: 'M', scenarios: [scenario('Só filtragem', { kind: 'SERVICE_SET', serviceTypes: ['FILTRAGEM'] }, [goal(1000)])] }, history);
  assert.equal(exact.metric, 'L');
  assert.equal(exact.actualValue, 1200);
});

test('limpeza e filtragem mantêm metros e litros separados, com cumprimento avaliado por serviço', () => {
  const row = comparePhysical({ metric: 'M', scenarios: [scenario('Limpeza + filtragem',
    { kind: 'SERVICE_SET', serviceTypes: ['LIMPEZA_QUIMICA', 'FILTRAGEM'] }, [goal(100, 'LIMPEZA_QUIMICA'), goal(1000, 'FILTRAGEM')])] },
  [servicePoint('2026-09-28', 'LIMPEZA_QUIMICA', 150), servicePoint('2026-09-28', 'FILTRAGEM', 9000, 500)]);
  assert.equal(row.mixedUnits, true);
  assert.equal(row.plannedValue, null);
  assert.equal(row.actualValue, null);
  assert.equal(row.differenceValue, null);
  assert.deepEqual(row.goals.map(goal => [goal.metric, goal.actualValue, goal.plannedValue, goal.differenceValue]), [['M', 150, 100, 50], ['L', 500, 1000, -500]]);
  assert.equal(row.achievementPct, 50);
  assert.equal(row.status, 'BELOW');
});

test('prioriza combinação exata, depois quantidade, depois regra geral; não aplica combinação a três serviços', () => {
  const definition = { ...singleAndPair, scenarios: [
    scenario('Geral', { kind: 'ALWAYS' }, [goal(500)]),
    scenario('Dois tipos', { kind: 'SERVICE_COUNT', count: 2 }, [goal(250)]), ...singleAndPair.scenarios
  ] };
  const history = [servicePoint('2026-09-28', 'LIMPEZA_QUIMICA', 100), servicePoint('2026-09-28', 'TESTE_PRESSAO', 100)];
  assert.equal(comparePhysical(definition, history).scenarioName, 'Limpeza + teste');
  assert.equal(comparePhysical(definition, [history[0], servicePoint('2026-09-29', 'FLUSHING', 200)]).scenarioName, 'Dois tipos');
  assert.equal(comparePhysical(definition, [...history, servicePoint('2026-09-29', 'FLUSHING', 200)]).scenarioName, 'Geral');
  assert.equal(comparePhysical(singleAndPair, [...history, servicePoint('2026-09-29', 'FLUSHING', 200)]).status, 'NO_RULE');
  assert.equal(comparePhysical(singleAndPair, []).status, 'NO_DATA');
});

test('ignora dados futuros, mantém semanas sem medição e separa litros e unidades de sistema', () => {
  const definition = { metric: 'L', scenarios: [scenario('Filtragem', { kind: 'ALWAYS' }, [goal(1000, 'FILTRAGEM')])] };
  const history = [servicePoint('2026-09-28', 'FILTRAGEM', 10000, 1000, 4), servicePoint('2026-10-03', 'FILTRAGEM', 0, 9000)];
  const row = comparePhysical(definition, history);
  assert.equal(row.actualValue, 1000);
  assert.equal(row.status, 'ON_TARGET');
  const units = comparePhysical({ metric: 'UN', scenarios: [scenario('Sistemas', { kind: 'ALWAYS' }, [goal(4)])] }, history);
  assert.equal(units.actualValue, 4);
  const withoutWeek = comparePhysical(definition, [servicePoint('2026-09-20', 'FILTRAGEM', 0, 1000)]);
  assert.equal(withoutWeek.actualValue, 0);
  assert.equal(withoutWeek.status, 'BELOW');
  const future = comparePhysical(definition, history, { today: '2026-09-27' });
  assert.equal(future.status, 'PLANNED');
  assert.equal(future.actualValue, null);
});

const productivePoint = (date, serviceType, personDays, issues = []) => ({ ...servicePoint(date, serviceType),
  productivePersonMinutes: personDays * 8 * 60, productivityIssues: issues });

test('42 m e 1.000 L por colaborador/dia calculam a base do RDO com equipe variável e meio dia', () => {
  const m = { metric: 'M', basis: 'PER_PRODUCTIVE_DAY', referenceDayHours: 8,
    scenarios: [scenario('Limpeza', { kind: 'ALWAYS' }, [goal(42, 'LIMPEZA_QUIMICA')])] };
  const history = [servicePoint('2026-09-28', 'LIMPEZA_QUIMICA', 630),
    ...[2, 4, 3, 3, 3].map((count, i) => productivePoint(`2026-${i < 3 ? '09' : '10'}-${['28', '29', '30', '01', '02'][i]}`, 'LIMPEZA_QUIMICA', count))];
  const meters = comparePhysical(m, history);
  assert.equal(meters.plannedValue, 630);
  assert.equal(meters.goals[0].personDays, 15);
  assert.equal(meters.goals[0].productiveHours, 120);
  assert.equal(meters.goals[0].actualRate, 42);
  assert.equal(meters.status, 'ON_TARGET');
  const liters = comparePhysical({ metric: 'L', basis: 'PER_PRODUCTIVE_DAY', scenarios: [scenario('Óleo', { kind: 'ALWAYS' }, [goal(1000, 'FILTRAGEM')])] },
    [servicePoint('2026-09-28', 'FILTRAGEM', 0, 12000), productivePoint('2026-09-28', 'FILTRAGEM', 10)]);
  assert.equal(liters.plannedValue, 10000);
  assert.equal(liters.goals[0].actualRate, 1200);
  assert.equal(liters.achievementPct, 120);
  const partial = comparePhysical(m, [servicePoint('2026-09-28', 'LIMPEZA_QUIMICA', 21), productivePoint('2026-09-28', 'LIMPEZA_QUIMICA', 0.5)]);
  assert.equal(partial.plannedValue, 21);
  assert.equal(partial.goals[0].actualRate, 42);
  assert.equal(comparePhysical({ ...m, referenceDayHours: 4 }, [productivePoint('2026-09-28', 'LIMPEZA_QUIMICA', 0.5)]).plannedValue, 42);
});

test('base incompleta e semanas futuras ficam sem avaliação; RDO atualizado recalcula a mesma meta', () => {
  const definition = { metric: 'M', basis: 'PER_PRODUCTIVE_DAY', scenarios: [scenario('Limpeza', { kind: 'ALWAYS' }, [goal(42, 'LIMPEZA_QUIMICA')])] };
  const quantity = servicePoint('2026-09-28', 'LIMPEZA_QUIMICA', 42);
  for (const history of [[quantity], [quantity, productivePoint('2026-09-28', 'LIMPEZA_QUIMICA', 1, ['MISSING_TEAM'])],
    [quantity, productivePoint('2026-09-28', 'LIMPEZA_QUIMICA', 0)]]) {
    const row = comparePhysical(definition, history);
    assert.equal(row.status, 'NO_DATA');
    assert.equal(row.plannedValue, null);
    assert.equal(row.actualValue, 42);
    assert.equal(row.differenceValue, null);
    assert.equal(row.achievementPct, null);
    assert.equal(row.goals[0].actualRate, null);
  }
  const future = comparePhysical(definition, [quantity], { today: '2026-09-27' });
  assert.equal(future.status, 'PLANNED');
  assert.equal(future.plannedValue, null);
  assert.equal(comparePhysical(definition, [quantity, productivePoint('2026-09-28', 'LIMPEZA_QUIMICA', 1)]).status, 'ON_TARGET');
  const updated = comparePhysical(definition, [quantity, productivePoint('2026-09-28', 'LIMPEZA_QUIMICA', 2)]);
  assert.equal(updated.plannedValue, 84);
  assert.equal(updated.status, 'BELOW');
  assert.equal(updated.target.revision, 1);
});

test('cenários consideram serviços em andamento e cada serviço usa só sua base produtiva', () => {
  const definition = { ...singleAndPair, basis: 'PER_PRODUCTIVE_DAY' };
  const points = [servicePoint('2026-09-28', 'LIMPEZA_QUIMICA', 150), productivePoint('2026-09-28', 'LIMPEZA_QUIMICA', 1),
    productivePoint('2026-09-28', 'TESTE_PRESSAO', 0.5)];
  const row = comparePhysical(definition, points);
  assert.equal(row.scenarioName, 'Limpeza + teste');
  assert.equal(row.status, 'BELOW');
  assert.deepEqual(row.goals.map(goal => goal.plannedValue), [100, 50]);
  assert.deepEqual(row.goals.map(goal => goal.actualValue), [150, 0]);
  const general = comparePhysical({ metric: 'M', basis: 'PER_PRODUCTIVE_DAY', scenarios: [scenario('Geral', { kind: 'ALWAYS' }, [goal(100)])] }, points);
  assert.equal(general.plannedValue, 150);
});

test('valida ambiguidades, condições exatas e bases de produtividade; mantém o formato percentual antigo', () => {
  const input = definition => ({ weekStartDate: '2026-09-28', definition });
  assert.equal(weeklyProgressTargetSchema.safeParse(input(singleAndPair)).success, true);
  const invalid = [
    ...[0, 24.01, 8.001].map(referenceDayHours => ({ metric: 'M', basis: 'PER_PRODUCTIVE_DAY', referenceDayHours,
      scenarios: [scenario('Referência', { kind: 'ALWAYS' }, [goal(42)])] })),
    { metric: 'M', basis: 'WEEK_TOTAL', referenceDayHours: 8, scenarios: [scenario('Total', { kind: 'ALWAYS' }, [goal(42)])] },
    { ...singleAndPair, scenarios: [...singleAndPair.scenarios, singleAndPair.scenarios[0]] },
    { metric: 'M', scenarios: [scenario('Duplicado', { kind: 'SERVICE_SET', serviceTypes: ['FLUSHING', 'FLUSHING'] }, [goal(100)])] },
    { metric: 'M', scenarios: [scenario('Faltante', { kind: 'SERVICE_SET', serviceTypes: ['FLUSHING', 'TESTE_PRESSAO'] }, [goal(100, 'FLUSHING')])] },
    { metric: 'M', scenarios: [scenario('Mistura', { kind: 'ALWAYS' }, [goal(100), goal(100, 'FLUSHING')])] },
    { metric: 'M', scenarios: [scenario('Quantidade', { kind: 'SERVICE_COUNT', count: 5 }, [goal(100)])] },
    { metric: 'UN', scenarios: [scenario('Fração', { kind: 'ALWAYS' }, [goal(1.5)])] },
    ...[{ productiveCollaborators: 0, productiveDays: 5 }, { productiveCollaborators: 1.5, productiveDays: 5 }, { productiveCollaborators: 2, productiveDays: 8 }].map(extra => ({ metric: 'M', basis: 'PER_PRODUCTIVE_DAY', scenarios: [scenario('Base', { kind: 'ALWAYS' }, [goal(42, 'FLUSHING', extra)])] }))
  ];
  for (const definition of invalid) assert.equal(weeklyProgressTargetSchema.safeParse(input(definition)).success, false, JSON.stringify(definition));
  assert.equal(weeklyProgressTargetSchema.safeParse({ ...input(singleAndPair), plannedPctPoints: 5 }).success, false);
  assert.equal(weeklyProgressTargetSchema.safeParse(input({ metric: 'UN', basis: 'PER_PRODUCTIVE_DAY', scenarios: [scenario('Taxa fracionada', { kind: 'ALWAYS' }, [goal(0.5, 'LIMPEZA_QUIMICA')])] })).success, true);
});

test('revisões físicas guardam condições e jornada de referência, são idempotentes e permitem retornar ao percentual', async () => {
  const client = database();
  const input = { weekStartDate: payload.weekStartDate, expectedRevision: 0, definition: singleAndPair };
  const saved = await saveWeeklyProgressTarget({ projectId: 'p1' }, input, { client, ...actor });
  assert.equal(saved.plannedPctPoints, null);
  assert.equal(saved.definition.metric, 'M');
  // PostgreSQL JSONB não conserva a ordem das chaves dos objetos.
  client.records[0].definition = { scenarios: saved.definition.scenarios.map(item => ({
    goals: item.goals.map(entry => ({ value: entry.value, serviceType: entry.serviceType })), condition: item.condition, name: item.name
  })), basis: saved.definition.basis, metric: saved.definition.metric };
  const same = await saveWeeklyProgressTarget({ projectId: 'p1' }, { ...input, expectedRevision: 1 }, { client, ...actor });
  assert.equal(same.revision, 1);
  const rate = { metric: 'L', basis: 'PER_PRODUCTIVE_DAY', referenceDayHours: 8, scenarios: [scenario('Filtragem', { kind: 'ALWAYS' }, [goal(1000, 'FILTRAGEM')])] };
  await saveWeeklyProgressTarget({ projectId: 'p1' }, { ...input, definition: rate, expectedRevision: 1 }, { client, ...actor });
  await saveWeeklyProgressTarget({ projectId: 'p1' }, { ...input, definition: { ...rate, referenceDayHours: 10 }, expectedRevision: 2 }, { client, ...actor });
  await saveWeeklyProgressTarget({ projectId: 'p1' }, { ...payload, expectedRevision: 3 }, { client, ...actor });
  const records = await listWeeklyProgressTargets({ projectId: 'p1' }, { client });
  assert.deepEqual(records.map(record => record.revision), [1, 2, 3, 4]);
  assert.equal(records[1].definition.referenceDayHours, 8);
  assert.equal(records[2].definition.referenceDayHours, 10);
  assert.equal(records[3].plannedPctPoints, 10);
  assert.equal(records[3].definition, undefined);
});

test('meta de presença salva mínimo e dias de trabalho em revisões preservadas', async () => {
  const client = database();
  const definition = { metric: 'COLLABORATORS', basis: 'PER_WORKDAY', workdays: [1, 2, 3, 4, 5],
    scenarios: [scenario('Meta geral', { kind: 'ALWAYS' }, [goal(5)])] };
  const input = { weekStartDate: payload.weekStartDate, expectedRevision: 0, definition };
  const saved = await saveWeeklyProgressTarget({ projectId: 'p1' }, input, { client, ...actor });
  assert.deepEqual(saved.definition, definition);
  assert.equal(saved.plannedPctPoints, null);
  assert.equal((await saveWeeklyProgressTarget({ projectId: 'p1' }, { ...input, expectedRevision: 1 }, { client, ...actor })).revision, 1);
  await saveWeeklyProgressTarget({ projectId: 'p1' }, { ...input, expectedRevision: 1,
    definition: { ...definition, workdays: [1, 2, 3, 4, 5, 6], scenarios: [scenario('Meta geral', { kind: 'ALWAYS' }, [goal(6)])] } }, { client, ...actor });
  const records = await listWeeklyProgressTargets({ projectId: 'p1' }, { client });
  assert.equal(records.length, 2);
  assert.deepEqual(records[0].definition, definition);
  assert.equal(records[1].definition.scenarios[0].goals[0].value, 6);
  assert.deepEqual(records[1].definition.workdays, [1, 2, 3, 4, 5, 6]);
});
