import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWeeklyAttendanceHistory, loadWeeklyAttendanceHistory } from '../src/lib/acompanhamento/weekly-attendance-history.js';
import { weeklyProgressTargetSchema } from '../src/lib/acompanhamento/weekly-progress-targets.js';
import { buildWeeklyProgressComparison } from '../../shared/modules/mission-weekly-progress.js';

const definition = { metric: 'COLLABORATORS', basis: 'PER_WORKDAY', workdays: [1, 2],
  scenarios: [{ name: 'Meta geral', condition: { kind: 'ALWAYS' }, goals: [{ serviceType: null, value: 5 }] }] };
const target = { id: 't1', weekStartDate: '2026-09-28', revision: 1, definition };
const attendance = (date, count) => ({ date, collaboratorIds: Array.from({ length: count }, (_, index) => `c${index}`) });
const compare = (attendanceHistory, extra = {}) => buildWeeklyProgressComparison({ targets: [target], attendanceHistory, today: '2026-10-02', ...extra })
  .find(row => row.weekStartDate === target.weekStartDate);
const report = (crew, extra = {}) => ({ reportType: 'RDO', reportDate: '2026-09-28',
  collaborators: crew.map(collaboratorId => ({ collaboratorId })), ...extra });

test('presença diária não permite que excedentes compensem faltas e ignora avanço de escopo', () => {
  const row = compare([attendance('2026-09-28', 6), attendance('2026-09-29', 4)], {
    progressHistory: [{ date: '2026-09-29', progressPct: 100 }],
    serviceHistory: [{ date: '2026-09-29', serviceType: 'FILTRAGEM', quantities: { M: 0, L: 99999, UN: 0 } }]
  });
  assert.equal(row.status, 'BELOW');
  assert.equal(row.plannedValue, 5);
  assert.equal(row.actualValue, 4);
  assert.equal(row.differenceValue, -1);
  assert.equal(row.achievementPct, 80);
  assert.deepEqual(row.dailyAttendance.map(day => day.status), ['ON_TARGET', 'BELOW']);
  assert.equal(row.plannedPctPoints, null);
  assert.equal(row.target.revision, 1);
});

test('atingir ou superar o mínimo em todos os dias fica dentro da meta', () => {
  for (const counts of [[5, 5], [5, 6], [7, 6]]) {
    const row = compare(counts.map((count, index) => attendance(`2026-09-${28 + index}`, count)));
    assert.equal(row.status, 'ON_TARGET');
    assert.ok(row.achievementPct >= 100);
    assert.deepEqual(row.dailyAttendance.map(day => day.status), ['ON_TARGET', 'ON_TARGET']);
  }
});

test('meta de seis: oito presenças geram superávit de dois; quatro no dia seguinte zeram o saldo', () => {
  const six = { ...target, definition: { ...definition, scenarios: [{ ...definition.scenarios[0], goals: [{ serviceType: null, value: 6 }] }] } };
  const history = [attendance('2026-09-28', 8), attendance('2026-09-29', 4)];
  const first = compare(history, { targets: [six], today: '2026-09-28' });
  assert.deepEqual(first.cumulativeAttendance, { plannedValue: 6, actualValue: 8, differenceValue: 2 });
  const second = compare(history, { targets: [six], today: '2026-09-29' });
  assert.deepEqual(second.cumulativeAttendance, { plannedValue: 12, actualValue: 12, differenceValue: 0 });
  assert.deepEqual(second.dailyAttendance.map(day => day.cumulativeDifferenceValue), [2, 0]);
  assert.equal(second.status, 'BELOW');
  const deficit = compare([attendance('2026-09-28', 4), attendance('2026-09-29', 4)], { targets: [six] });
  assert.equal(deficit.cumulativeAttendance.differenceValue, -4);
});

test('saldo total continua entre semanas com metas diferentes e não inclui dias sem meta', () => {
  const next = { ...target, id: 't2', weekStartDate: '2026-10-05', definition: { ...definition, workdays: [1],
    scenarios: [{ ...definition.scenarios[0], goals: [{ serviceType: null, value: 6 }] }] } };
  const history = [attendance('2026-09-28', 8), attendance('2026-09-29', 5), attendance('2026-09-30', 100), attendance('2026-10-05', 4)];
  const rows = buildWeeklyProgressComparison({ targets: [target, next], attendanceHistory: history, today: '2026-10-05' });
  assert.deepEqual(rows[0].cumulativeAttendance, { plannedValue: 16, actualValue: 17, differenceValue: 1 });
  assert.equal(rows[0].dailyAttendance[0].cumulativeDifferenceValue, 1);
  assert.equal(rows[1].cumulativeAttendance.differenceValue, 3);
  const deleted = buildWeeklyProgressComparison({ targets: [target, { ...target, revision: 2, isDeleted: true }, next], attendanceHistory: history, today: '2026-10-05' });
  assert.deepEqual(deleted[0].cumulativeAttendance, { plannedValue: 6, actualValue: 4, differenceValue: -2 });
});

test('sem RDO fica pendente, RDO sem equipe tem zero e uma falta comprovada prevalece sobre dias pendentes', () => {
  assert.equal(compare([]).status, 'NO_DATA');
  const pending = compare([attendance('2026-09-28', 6)]);
  assert.equal(pending.status, 'NO_DATA');
  assert.equal(pending.actualValue, null);
  assert.equal(pending.dailyAttendance[1].actualValue, null);
  assert.equal(pending.cumulativeAttendance.differenceValue, null);
  assert.equal(pending.dailyAttendance[1].cumulativeDifferenceValue, null);
  const shortfall = compare([attendance('2026-09-28', 0)]);
  assert.equal(shortfall.status, 'BELOW');
  assert.equal(shortfall.dailyAttendance[0].actualValue, 0);
  const unconfirmed = compare([attendance('2026-09-28', 6), { ...attendance('2026-09-29', 6), attendanceIssues: ['UNCONFIRMED_TEAM'] }]);
  assert.equal(unconfirmed.status, 'NO_DATA');
  assert.deepEqual(unconfirmed.dailyAttendance[1].attendanceIssues, ['UNCONFIRMED_TEAM']);
});

test('avalia apenas dias selecionados já ocorridos, incluindo fim de semana quando contratado', () => {
  const history = [attendance('2026-09-28', 5), attendance('2026-09-29', 0), attendance('2026-10-03', 6)];
  const current = compare(history, { today: '2026-09-28' });
  assert.equal(current.status, 'ON_TARGET');
  assert.deepEqual(current.dailyAttendance.map(day => day.status), ['ON_TARGET', 'PLANNED']);
  const weekend = { ...target, definition: { ...definition, workdays: [1, 6] } };
  const selected = compare(history, { targets: [weekend], today: '2026-10-03' });
  assert.equal(selected.status, 'ON_TARGET');
  assert.deepEqual(selected.dailyAttendance.map(day => day.date), ['2026-09-28', '2026-10-03']);
  const future = compare(history, { today: '2026-09-27' });
  assert.equal(future.status, 'PLANNED');
  assert.equal(future.actualValue, null);
  assert.ok(future.dailyAttendance.every(day => day.status === 'PLANNED'));
});

test('recalcula presença sem editar meta e não recupera uma revisão excluída', () => {
  const oldHistory = [attendance('2026-09-28', 5), attendance('2026-09-29', 4)];
  const updatedHistory = [attendance('2026-09-28', 5), attendance('2026-09-29', 6)];
  assert.equal(compare(oldHistory).status, 'BELOW');
  assert.equal(compare(updatedHistory).status, 'ON_TARGET');
  assert.equal(compare(updatedHistory).target.revision, 1);
  const deleted = compare(updatedHistory, { targets: [target, { ...target, revision: 2, definition: undefined, isDeleted: true }] });
  assert.equal(deleted.status, 'NO_TARGET');
  assert.deepEqual(deleted.dailyAttendance, []);
});

test('conta pessoas distintas no RDO, entre turnos e relatórios, sem exigir horas, serviços ou cargo operacional', () => {
  const history = buildWeeklyAttendanceHistory([
    report(['c1', 'c2', 'c1', 'administrativo'], { specialConditions: { noturno: true, noturnoDetails: { collaboratorIds: ['c2', 'c3'] } } }),
    report(['c2', 'c4']), report(['c4'], { reportDate: '2026-09-29' }),
    report(['fora'], { reportType: 'LIMPEZA_QUIMICA' }), report(['fora'], { deletedAt: new Date() }),
    report(['fora'], { reportDate: 'inválida' }), report(['c5'], { specialConditions: { noturnoDetails: { collaboratorIds: ['turno-desativado'] } } })
  ]);
  assert.deepEqual(history, [
    { date: '2026-09-28', collaboratorIds: ['administrativo', 'c1', 'c2', 'c3', 'c4', 'c5'], attendanceIssues: [] },
    { date: '2026-09-29', collaboratorIds: ['c4'], attendanceIssues: [] }
  ]);
  const row = compare([attendance('2026-09-28', 5), attendance('2026-09-28', 5), attendance('2026-09-29', 5)]);
  assert.equal(row.actualValue, 5);
});

test('equipe histórica inferida do ponto pede confirmação; equipe extraída do documento é aceita', () => {
  const manual = collaboratorSource => ({ __manualUpload: { importedByScript: 'import-manual-rdo-pdfs', collaboratorSource } });
  const unconfirmed = buildWeeklyAttendanceHistory([report(['c1'], { specialConditions: manual(undefined) })]);
  assert.deepEqual(unconfirmed, [{ date: '2026-09-28', collaboratorIds: [], attendanceIssues: ['UNCONFIRMED_TEAM'] }]);
  assert.deepEqual(buildWeeklyAttendanceHistory([report(['c1'], { specialConditions: manual('RDO_DOCUMENT') })])[0].collaboratorIds, ['c1']);
});

test('carrega somente RDOs ativos dos projetos da missão ou do grupo e deduplica colaboradores entre projetos', async () => {
  const client = {
    project: { findFirst: async () => ({ id: 'p1' }) },
    acompanhamentoMissionGroup: { findFirst: async () => ({ id: 'g1' }) },
    acompanhamentoMissionGroupMember: { findMany: async ({ where }) => {
      assert.deepEqual(where, { groupId: 'g1', project: { deletedAt: null } });
      return [{ projectId: 'p1' }, { projectId: 'p2' }];
    } },
    report: { findMany: async ({ where, select }) => {
      assert.deepEqual(where, { projectId: { in: ['p1', 'p2'] }, reportType: 'RDO', deletedAt: null });
      assert.deepEqual(select.collaborators, { select: { collaboratorId: true } });
      return [report(['c1', 'c2']), report(['c2', 'c3'])];
    } }
  };
  assert.deepEqual((await loadWeeklyAttendanceHistory({ groupId: 'g1' }, { client }))[0].collaboratorIds, ['c1', 'c2', 'c3']);
  client.report.findMany = async ({ where }) => {
    assert.deepEqual(where.projectId, { in: ['p1'] });
    return [report(['c1'])];
  };
  assert.deepEqual((await loadWeeklyAttendanceHistory({ projectId: 'p1' }, { client }))[0].collaboratorIds, ['c1']);
});

test('valida quantidade inteira positiva, dias válidos e regra independente de produção', () => {
  const input = definition => ({ weekStartDate: '2026-09-28', definition });
  assert.equal(weeklyProgressTargetSchema.safeParse(input(definition)).success, true);
  const invalid = [
    ...[0, -1, 1.5].map(value => ({ ...definition, scenarios: [{ ...definition.scenarios[0], goals: [{ serviceType: null, value }] }] })),
    ...[undefined, [], [1, 1], [-1], [7], [1.5]].map(workdays => ({ ...definition, workdays })),
    { ...definition, referenceDayHours: 8 }, { ...definition, basis: 'WEEK_TOTAL' }, { ...definition, basis: 'PER_PRODUCTIVE_DAY' },
    { ...definition, scenarios: [{ ...definition.scenarios[0], goals: [{ serviceType: 'FILTRAGEM', value: 5 }] }] },
    { ...definition, scenarios: [{ ...definition.scenarios[0], condition: { kind: 'SERVICE_COUNT', count: 1 } }] },
    { ...definition, scenarios: [...definition.scenarios, { ...definition.scenarios[0], condition: { kind: 'SERVICE_COUNT', count: 1 } }] },
    { ...definition, metric: 'M' }, { ...definition, metric: 'M', basis: 'WEEK_TOTAL' }
  ];
  for (const rule of invalid) assert.equal(weeklyProgressTargetSchema.safeParse(input(rule)).success, false, JSON.stringify(rule));
});
