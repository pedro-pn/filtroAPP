import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { buildWeeklyProgressComparison } from '../../shared/modules/mission-weekly-progress.js';

test('cadastro em lista converte metas antigas, monta E/OU e valida cada linha', async () => {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  try {
    const { targetToDraft, weeklyTargetDraftToInput, changeGoalKind, newGoalDraft } = await server.ssrLoadModule('/src/components/projects/weeklyTargetDraft.ts');
    const { weeklyGoalSentence, workdaysLabel } = await server.ssrLoadModule('/src/components/projects/weeklyTargetPresentation.ts');
    const base = { id: 't', weekStartDate: '2026-09-28', revision: 1, author: { name: 'Gestora' }, createdAt: '2026-09-28T12:00:00Z' };

    const fresh = targetToDraft(null, '2026-10-19', 0);
    assert.deepEqual([fresh.countingStartDay, fresh.countingEndDay, fresh.repeatWeekly, fresh.logic], [5, 4, true, 'ALL']);
    assert.deepEqual(fresh.goals, [{ kind: 'ANY_SERVICE', value: '', unit: 'M', basis: 'PER_PRODUCTIVE_DAY' }]);

    const percent = targetToDraft({ ...base, plannedPctPoints: 12.5 }, '2026-09-28', 1);
    assert.deepEqual(percent.goals, [{ kind: 'PROGRESS', value: '12,5', unit: 'M', basis: 'WEEK_TOTAL' }]);
    assert.equal(percent.replacesLegacyRules, false);
    const scenarios = targetToDraft({ ...base, plannedPctPoints: null, definition: { metric: 'M', basis: 'PER_PRODUCTIVE_DAY', referenceDayHours: 8, countingStartDay: 5, countingEndDay: 4,
      scenarios: [{ name: 'Geral', condition: { kind: 'ALWAYS' }, goals: [{ serviceType: 'LIMPEZA_QUIMICA', value: 30 }, { serviceType: 'FILTRAGEM', value: 1000 }] },
        { name: 'Par', condition: { kind: 'SERVICE_COUNT', count: 2 }, goals: [{ serviceType: null, value: 100 }] }] } }, '2026-09-28', 1);
    assert.equal(scenarios.replacesLegacyRules, true);
    assert.deepEqual(scenarios.goals.map(goal => [goal.kind, goal.unit, goal.basis, goal.value]),
      [['LIMPEZA_QUIMICA', 'M', 'PER_PRODUCTIVE_DAY', '30'], ['FILTRAGEM', 'L', 'PER_PRODUCTIVE_DAY', '1000']]);

    const draft = { ...fresh, weekStartDate: '2026-09-28', logic: 'ANY', goals: [
      { ...newGoalDraft('LIMPEZA_QUIMICA'), value: '30' }, { ...newGoalDraft('FILTRAGEM', 'WEEK_TOTAL'), value: '1000' }] };
    const input = weeklyTargetDraftToInput(draft, [1, 2, 3, 4, 5]);
    assert.deepEqual(input.definition, { version: 2, logic: 'ANY', countingStartDay: 5, countingEndDay: 4, repeatWeekly: true, goals: [
      { kind: 'SERVICE', serviceType: 'LIMPEZA_QUIMICA', metric: 'M', basis: 'PER_PRODUCTIVE_DAY', value: 30 },
      { kind: 'SERVICE', serviceType: 'FILTRAGEM', metric: 'L', basis: 'WEEK_TOTAL', value: 1000 }] });
    assert.equal(weeklyTargetDraftToInput({ ...draft, goals: [draft.goals[0]] }).definition.logic, 'ALL');
    const roundTrip = targetToDraft({ ...base, ...input, plannedPctPoints: null }, '2026-09-28', 1);
    assert.deepEqual(roundTrip.goals, draft.goals);
    assert.equal(roundTrip.logic, 'ANY');

    // Uma semana com só limpeza química cumprida: OU atinge, E fica parcial.
    const serviceHistory = [{ date: '2026-10-02', serviceType: 'LIMPEZA_QUIMICA', quantities: { M: 95, L: 0, UN: 0 }, productivePersonMinutes: 1440, productivePersonDays: 3 }];
    const compare = logic => buildWeeklyProgressComparison({ today: '2026-10-20', serviceHistory,
      targets: [{ ...base, ...weeklyTargetDraftToInput({ ...draft, logic }), plannedPctPoints: null }] }).find(row => row.periodStartDate === '2026-10-02');
    assert.equal(compare('ANY').status, 'ABOVE');
    assert.equal(compare('ALL').status, 'PARTIAL');

    assert.deepEqual(changeGoalKind(draft.goals[1], 'FLUSHING'), { kind: 'FLUSHING', value: '1000', unit: 'M', basis: 'WEEK_TOTAL' });
    assert.deepEqual(changeGoalKind(draft.goals[0], 'PROGRESS').basis, 'WEEK_TOTAL');
    for (const [goals, message] of [
      [[draft.goals[0], draft.goals[0]], /uma linha por serviço/],
      [[{ ...draft.goals[0], value: '0' }], /maior que zero/],
      [[{ ...draft.goals[0], value: '1,234' }], /duas casas/],
      [[{ ...newGoalDraft('TESTE_PRESSAO', 'WEEK_TOTAL'), unit: 'UN', value: '2,5' }], /inteiras/],
      [[{ ...newGoalDraft('PROGRESS'), value: '120' }], /até 100/],
      [[{ ...newGoalDraft('ATTENDANCE'), value: '5,5' }], /inteiro/],
      [[], /ao menos uma/]
    ]) assert.throws(() => weeklyTargetDraftToInput({ ...draft, goals }), message);
    assert.throws(() => weeklyTargetDraftToInput({ ...draft, countingStartDay: 6, countingEndDay: 0, goals: [{ ...newGoalDraft('ATTENDANCE'), value: '5' }] }, [1, 2, 3, 4, 5]), /dias de trabalho/);

    assert.equal(weeklyGoalSentence({ kind: 'SERVICE', serviceType: 'LIMPEZA_QUIMICA', metric: 'M', basis: 'PER_PRODUCTIVE_DAY', value: 30 }),
      'Cada colaborador deve fazer 30 m de limpeza química por dia trabalhado. Cada pessoa da equipe do RDO conta 1 por dia com RDO deste serviço.');
    assert.equal(weeklyGoalSentence({ kind: 'SERVICE', serviceType: null, metric: 'M', basis: 'PER_PRODUCTIVE_DAY', value: 27 }),
      'Cada colaborador deve fazer 27 m somando todos os serviços por dia trabalhado. Cada pessoa da equipe do RDO conta 1 por dia com RDO.');

    // "Qualquer serviço" grava serviceType null, aceita litros e substitui o "Total geral" das metas antigas.
    const any = weeklyTargetDraftToInput({ ...draft, goals: [{ ...newGoalDraft('ANY_SERVICE'), value: '27' }] });
    assert.deepEqual(any.definition.goals, [{ kind: 'SERVICE', serviceType: null, metric: 'M', basis: 'PER_PRODUCTIVE_DAY', value: 27 }]);
    assert.equal(weeklyTargetDraftToInput({ ...draft, goals: [{ ...newGoalDraft('ANY_SERVICE', 'WEEK_TOTAL'), unit: 'L', value: '500' }] }).definition.goals[0].metric, 'L');
    assert.equal(weeklyTargetDraftToInput({ ...draft, goals: [{ ...newGoalDraft('FLUSHING', 'WEEK_TOTAL'), unit: 'L', value: '500' }] }).definition.goals[0].metric, 'M');
    assert.throws(() => weeklyTargetDraftToInput({ ...draft, goals: [newGoalDraft('ANY_SERVICE'), newGoalDraft('ANY_SERVICE')].map(goal => ({ ...goal, value: '1' })) }), /qualquer serviço/);
    const total = targetToDraft({ ...base, plannedPctPoints: null, definition: { metric: 'M', basis: 'PER_PRODUCTIVE_DAY',
      scenarios: [{ name: 'Meta geral', condition: { kind: 'ALWAYS' }, goals: [{ serviceType: null, value: 27 }] }] } }, '2026-09-28', 1);
    assert.deepEqual(total.goals, [{ kind: 'ANY_SERVICE', value: '27', unit: 'M', basis: 'PER_PRODUCTIVE_DAY' }]);
    assert.equal(total.replacesLegacyRules, false);
    assert.equal(weeklyGoalSentence({ kind: 'SERVICE', serviceType: 'FILTRAGEM', metric: 'L', basis: 'WEEK_TOTAL', value: 1000 }), 'A equipe deve fazer 1.000 L de óleo filtrado na semana.');
    assert.match(weeklyGoalSentence({ kind: 'ATTENDANCE', value: 6, workdays: [1, 2, 3, 4, 5, 6] }), /6 colaboradores .*\(seg a sáb\)/);
    assert.equal(workdaysLabel([1, 3, 5]), 'seg, qua, sex');
  } finally { await server.close(); }
});
