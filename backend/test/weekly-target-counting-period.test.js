import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWeeklyProgressComparison, currentWeeklyProgressComparison, weeklyTargetCountingDays, weeklyTargetCountingPeriod } from '../../shared/modules/mission-weekly-progress.js';
import { weeklyProgressTargetSchema, saveWeeklyProgressTarget, listWeeklyProgressTargets } from '../src/lib/acompanhamento/weekly-progress-targets.js';

const definition = (patch = {}) => ({ metric: 'M', basis: 'WEEK_TOTAL', countingStartDay: 1, countingEndDay: 5,
  scenarios: [{ name: 'Geral', condition: { kind: 'ALWAYS' }, goals: [{ serviceType: null, value: 100 }] }], ...patch });
const target = (weekStartDate, settings) => ({ id: weekStartDate, weekStartDate, revision: 1, definition: settings });
const production = (date, quantity, serviceType = 'LIMPEZA_QUIMICA', extra = {}) => ({ date, serviceType, quantities: { M: quantity, L: 0, UN: 0 }, ...extra });
const row = (rows, week = '2026-09-28') => rows.find(item => item.weekStartDate === week);

test('todos os pares de dias incluem as duas pontas, inclusive um único dia e a virada da semana', () => {
  for (let start = 0; start < 7; start++) for (let end = 0; end < 7; end++) {
    const settings = definition({ countingStartDay: start, countingEndDay: end });
    const period = weeklyTargetCountingPeriod('2026-09-28', settings);
    const history = Array.from({ length: 14 }, (_, index) => production(new Date(Date.UTC(2026, 8, 28 + index)).toISOString().slice(0, 10), 1));
    const result = row(buildWeeklyProgressComparison({ targets: [target('2026-09-28', settings)], serviceHistory: history, today: '2026-10-12' }));
    assert.equal(result.actualValue, (end - start + 7) % 7 + 1, `${start} a ${end}`);
    assert.equal(new Date(period.periodStartDate).getUTCDay(), start);
    assert.equal(new Date(period.periodEndDate).getUTCDay(), end);
  }
  assert.deepEqual(weeklyTargetCountingDays(), [1, 2, 3, 4, 5, 6, 0]);
  assert.deepEqual(weeklyTargetCountingPeriod('2026-12-28', definition({ countingStartDay: 5, countingEndDay: 4 })),
    { periodStartDate: '2027-01-01', periodEndDate: '2027-01-07' });
});

test('segunda a sexta exclui produção, serviços e problemas de jornada do fim de semana', () => {
  const settings = definition({ basis: 'PER_PRODUCTIVE_DAY', referenceDayHours: 9,
    scenarios: [{ name: 'Limpeza', condition: { kind: 'SERVICE_SET', serviceTypes: ['LIMPEZA_QUIMICA'] }, goals: [{ serviceType: null, value: 27 }] }] });
  const history = [production('2026-09-28', 27, 'LIMPEZA_QUIMICA', { productivePersonMinutes: 540, productivityIssues: [] }),
    production('2026-10-02', 27, 'LIMPEZA_QUIMICA', { productivePersonMinutes: 540, productivityIssues: [] }),
    production('2026-10-03', 999, 'TESTE_PRESSAO', { productivePersonMinutes: 540, productivityIssues: ['MISSING_TEAM'] })];
  const result = row(buildWeeklyProgressComparison({ targets: [target('2026-09-28', settings)], serviceHistory: history, today: '2026-10-04' }));
  assert.equal(result.plannedValue, 54);
  assert.equal(result.actualValue, 54);
  assert.equal(result.status, 'ON_TARGET');
  assert.equal(result.inProgress, false);
  assert.deepEqual(result.activeServiceTypes, ['LIMPEZA_QUIMICA']);
  assert.equal(result.goals[0].personDays, 2);
});

test('ganho percentual usa os acumulados diários nas bordas, sem incluir sábado ou domingo', () => {
  const result = row(buildWeeklyProgressComparison({ today: '2026-10-04', targets: [target('2026-09-28', definition({ metric: 'PCT_POINTS',
    scenarios: [{ name: 'Avanço', condition: { kind: 'ALWAYS' }, goals: [{ serviceType: null, value: 10 }] }] }))],
  progressHistory: [{ date: '2026-09-27', progressPct: 10 }, { date: '2026-09-28', progressPct: 15 },
    { date: '2026-10-02', progressPct: 20 }, { date: '2026-10-03', progressPct: 50 }, { date: '2026-10-04', progressPct: 70 }] }));
  assert.equal(result.actualValue, 10);
  assert.equal(result.differenceValue, 0);
  assert.equal(result.status, 'ON_TARGET');
});

test('quarta a terça mantém o período anterior ativo na segunda e não conta dados duas vezes', () => {
  const settings = definition({ countingStartDay: 3, countingEndDay: 2, repeatWeekly: true });
  const rows = buildWeeklyProgressComparison({ today: '2026-10-05', targets: [target('2026-09-28', settings)],
    serviceHistory: [production('2026-09-29', 999), production('2026-09-30', 50), production('2026-10-05', 50), production('2026-10-07', 999)] });
  const current = currentWeeklyProgressComparison(rows, '2026-10-05');
  assert.equal(current.weekStartDate, '2026-09-28');
  assert.equal(current.periodStartDate, '2026-09-30');
  assert.equal(current.periodEndDate, '2026-10-06');
  assert.equal(current.actualValue, 100);
  assert.equal(current.inProgress, true);
  assert.equal(row(rows, '2026-10-05').status, 'PLANNED');
  assert.equal(row(rows, '2026-10-05').actualValue, null);
});

test('mudança do intervalo encerra o anterior antes do novo, sem sobrepor os dias', () => {
  const rows = buildWeeklyProgressComparison({ today: '2026-10-09', targets: [
    target('2026-09-28', definition({ countingStartDay: 3, countingEndDay: 2, repeatWeekly: true })),
    target('2026-10-05', definition())], serviceHistory: [production('2026-09-30', 10), production('2026-10-04', 20),
    production('2026-10-05', 30), production('2026-10-06', 40)] });
  assert.equal(row(rows).periodEndDate, '2026-10-04');
  assert.equal(row(rows).actualValue, 30);
  assert.equal(row(rows, '2026-10-05').actualValue, 70);
});

test('presença usa somente os dias contratados dentro do período, inclusive na semana seguinte', () => {
  const settings = definition({ metric: 'COLLABORATORS', basis: 'PER_WORKDAY', workdays: [1, 5], countingStartDay: 5, countingEndDay: 1,
    repeatWeekly: true, scenarios: [{ name: 'Equipe', condition: { kind: 'ALWAYS' }, goals: [{ serviceType: null, value: 2 }] }] });
  const rows = buildWeeklyProgressComparison({ today: '2026-10-05', targets: [target('2026-09-28', settings)],
    attendanceHistory: ['2026-10-02', '2026-10-05'].map(date => ({ date, collaboratorIds: ['a', 'b'] })) });
  const result = currentWeeklyProgressComparison(rows, '2026-10-05');
  assert.deepEqual(result.dailyAttendance.map(day => day.date), ['2026-10-02', '2026-10-05']);
  assert.equal(result.status, 'ON_TARGET');
  assert.deepEqual(result.cumulativeAttendance, { plannedValue: 4, actualValue: 4, differenceValue: 0 });
});

test('API valida os dois dias e preserva o intervalo em revisões e metas antigas', async () => {
  const input = settings => ({ weekStartDate: '2026-09-28', expectedRevision: 0, definition: settings });
  for (const patch of [{ countingStartDay: -1 }, { countingEndDay: 7 }, { countingStartDay: 1.5 }, { countingEndDay: '5' }, { countingEndDay: undefined }]) {
    assert.equal(weeklyProgressTargetSchema.safeParse(input(definition(patch))).success, false);
  }
  const legacy = definition(); delete legacy.countingStartDay; delete legacy.countingEndDay;
  assert.equal(weeklyProgressTargetSchema.safeParse(input(legacy)).success, true);
  const records = [];
  const client = { project: { findFirst: async () => ({ id: 'p' }) }, missionWeeklyProgressTarget: {
    findFirst: async () => records.at(-1), findMany: async () => records,
    create: async ({ data }) => { const saved = { ...data, id: String(records.length), createdAt: new Date() }; records.push(saved); return saved; }
  } };
  await saveWeeklyProgressTarget({ projectId: 'p' }, input(legacy), { client, userId: 'u', userName: 'Gestora' });
  await saveWeeklyProgressTarget({ projectId: 'p' }, { ...input(definition()), expectedRevision: 1 }, { client, userId: 'u', userName: 'Gestora' });
  const listed = await listWeeklyProgressTargets({ projectId: 'p' }, { client });
  assert.equal(listed[0].definition.countingStartDay, undefined);
  assert.equal(listed[1].definition.countingEndDay, 5);
  assert.equal(listed[1].revision, 2);
});
