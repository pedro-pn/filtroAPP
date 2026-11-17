import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWorkedDaysProgress, validateProgressConfiguration } from '../src/lib/acompanhamento/worked-days-progress.js';
import { buildRequiredWeeklyProgress } from '../src/lib/acompanhamento/avanco.js';
import { combineProgressBreakdowns } from '../src/lib/acompanhamento/progress-groups.js';

const rdo = (id, day, ids, patch = {}) => ({ id, reportType: 'RDO', reportDate: `2026-09-${day}`,
  collaborators: ids.map(collaboratorId => ({ collaboratorId })), ...patch });
const calculate = reports => buildWorkedDaysProgress({ plannedDays: 10, plannedCollaborators: 4, reports });

test('dias trabalhados: avanço proporcional à equipe, independente de horas e serviços finalizados', () => {
  const reports = [rdo('a', '01', ['a', 'b'], { daytimeWorkedMinutes: 60, services: [{ finalized: false }] }),
    rdo('b', '02', ['a', 'b', 'c', 'd']), rdo('c', '03', ['a', 'b', 'c', 'd', 'e', 'f'])];
  const original = structuredClone(reports);
  const result = calculate(reports);
  assert.deepEqual(result.dailyProgressHistory.map(point => point.progressPct), [5, 15, 30]);
  assert.deepEqual(result.progress.workedDays, { plannedDays: 10, plannedCollaborators: 4,
    plannedPersonDays: 40, realizedPersonDays: 12, equivalentWorkedDays: 3, rdoCount: 3 });
  assert.equal(result.progress.progressPct, 30);
  assert.deepEqual(reports, original);
});

test('cada RDO conta uma vez, mesmo sem serviço; turnos repetidos não duplicam pessoas', () => {
  const first = rdo('a', '01', ['a', 'a', 'b'], {
    specialConditions: { noturnoDetails: { collaboratorIds: ['b', 'c', 'c'] } }
  });
  const result = calculate([first, first, rdo('b', '01', ['a']),
    rdo('empty', '02', []), rdo('deleted', '03', ['a'], { deletedAt: new Date() }),
    rdo('derived', '03', ['a'], { reportType: 'RLF', specialConditions: { parentRdoId: 'a' } }),
    rdo('standalone', '03', ['a'], { reportType: 'RLF' })]);
  assert.equal(result.progress.progressPct, 10);
  assert.equal(result.progress.workedDays.realizedPersonDays, 4);
  assert.equal(result.progress.workedDays.rdoCount, 3);
  assert.deepEqual(result.dailyProgressHistory.map(point => [point.date, point.progressPct]), [
    ['2026-09-01', 10], ['2026-09-02', 10]
  ]);
});

test('sem meta não divide por zero e não usa avanço manual; sem RDO o avanço é zero', () => {
  assert.equal(calculate([]).progress.progressPct, 0);
  for (const plannedDays of [null, 0]) {
    const result = buildWorkedDaysProgress({ plannedDays, plannedCollaborators: 4, reports: [rdo('a', '01', ['a'])] });
    assert.equal(result.progress.progressPct, null);
    assert.equal(result.progress.progressMethod, 'WORKED_DAYS');
    assert.deepEqual(result.dailyProgressHistory, []);
  }
  assert.equal(buildWorkedDaysProgress({ plannedDays: 1, plannedCollaborators: 2,
    reports: [rdo('a', '01', ['a', 'b', 'c'])] }).progress.progressPct, 150);
});

test('metas semanais e grupos somam pessoas-dia de equipes com tamanhos diferentes', () => {
  const first = calculate([rdo('a', '01', ['a', 'b'])]).progress; // 2/40
  const second = buildWorkedDaysProgress({ plannedDays: 10, plannedCollaborators: 2,
    reports: [rdo('b', '02', ['a', 'b'])] }).progress; // 2/20
  const grouped = combineProgressBreakdowns([first, second]);
  assert.equal(grouped.progressPct, 6.7); // 4/60, não a média simples dos percentuais
  const weekly = buildRequiredWeeklyProgress(first, { referenceDate: '2026-09-01', expectedEndDate: '2026-09-08' });
  assert.equal(weekly.services[0].systems[0].requiredQtyPerWeek, 38);
  assert.equal(weekly.services[0].systems[0].unit, 'PESSOA_DIA');
});

test('configuração exige equipe inteira positiva e valida atualizações parciais', () => {
  const current = { progressModel: 'WORKED_DAYS', plannedCollaborators: 4 };
  for (const value of [0, -1, 1.5, '2', NaN, Infinity, 2147483648]) {
    assert.throws(() => validateProgressConfiguration(current, { plannedCollaborators: value }));
  }
  assert.throws(() => validateProgressConfiguration({}, { progressModel: 'WORKED_DAYS' }), /colaboradores planejados/);
  assert.throws(() => validateProgressConfiguration(current, { plannedCollaborators: null }), /colaboradores planejados/);
  assert.doesNotThrow(() => validateProgressConfiguration(current, { plannedCollaborators: 2 }));
  assert.doesNotThrow(() => validateProgressConfiguration(current, { progressModel: 'QUANTITIES', plannedCollaborators: null }));
});
