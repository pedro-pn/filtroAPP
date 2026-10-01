import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWeeklyProgressComparison, corporateToday, dateOnlyKey, weekStartKey } from '../../shared/modules/mission-weekly-progress.js';
import { buildProgressHistory } from '../src/lib/acompanhamento/avanco.js';
import { listWeeklyProgressTargets, saveWeeklyProgressTarget, weeklyProgressTargetSchema } from '../src/lib/acompanhamento/weekly-progress-targets.js';
import { getMissionWeeklyProgressTargets, saveMissionWeeklyProgressTarget } from '../src/lib/efetivo/planning/weekly-progress-targets.js';

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
    project: { findFirst: async () => ({ id: 'p1' }) },
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

test('Efetivo compartilha a meta por projeto e carrega o mesmo histórico; cenário não acessa metas oficiais', async () => {
  const client = database();
  await saveWeeklyProgressTarget({ projectId: 'p1' }, payload, { client, ...actor });
  const history = [point('2026-09-25', 30)];
  const comparison = await getMissionWeeklyProgressTargets('m1', { database: client, loadHistory: async ids => {
    assert.deepEqual(ids, ['p1']);
    return new Map([['p1', history]]);
  } });
  assert.equal(comparison.targets[0].plannedPctPoints, 10);
  assert.deepEqual(comparison.progressHistory, history);
  await saveMissionWeeklyProgressTarget('m1', { ...payload, plannedPctPoints: 20, expectedRevision: 1 }, actor, { database: client });
  assert.equal((await listWeeklyProgressTargets({ projectId: 'p1' }, { client }))[1].plannedPctPoints, 20);
  client.efetivoMissionPlan.findFirst = async ({ where }) => {
    assert.deepEqual(where.plan, { kind: 'OFFICIAL', status: 'ACTIVE' });
    return null;
  };
  await assert.rejects(getMissionWeeklyProgressTargets('scenario-mission', { database: client }), { status: 404 });
});

test('missões excluídas e agrupamentos dissolvidos não recebem novas metas', async () => {
  const client = database();
  client.project.findFirst = async () => null;
  await assert.rejects(saveWeeklyProgressTarget({ projectId: 'p1' }, payload, { client, ...actor }), { status: 404 });
  client.acompanhamentoMissionGroup.findFirst = async ({ where }) => where.status === 'ACTIVE' ? null : { id: 'g1' };
  await assert.rejects(saveWeeklyProgressTarget({ groupId: 'g1' }, payload, { client, ...actor }), { status: 404 });
  assert.deepEqual(await listWeeklyProgressTargets({ groupId: 'g1' }, { client }), []);
});
