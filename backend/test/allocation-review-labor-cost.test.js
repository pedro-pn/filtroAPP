import assert from 'node:assert/strict';
import test from 'node:test';

import {
  allocationDecisionRequiresAction,
  buildDailyProjectWeights,
  classifyProjectHours,
  manualProjectsByCollaborator,
  monthsWithEffectiveAllocationDays,
  reviewedDayEntry,
  reviewedProjectDatesByCollaborator
} from '../src/lib/acompanhamento/labor-cost.js';

const rdo = entries => new Map(entries.map(([projectId, hours]) => [projectId, { projectId, hours }]));

test('dia conferido em projeto vence ajuste manual, RDO e etiqueta', () => {
  const decision = buildDailyProjectWeights({
    tags: ['5484'],
    resolveTag: () => 'pTag',
    rdoProjects: rdo([['pRdo', 8]]),
    manualProjectIds: reviewedDayEntry(['pB'], 'PROJECT')
  });
  assert.equal(decision.reason, 'REVIEW_CONFIRMED');
  assert.deepEqual(decision.allocations.map(item => [item.projectId, item.weight]), [['pB', 1]]);
});

test('dois projetos conferidos dividem como o ajuste manual (por horas de RDO, senão igual)', () => {
  const byRdo = buildDailyProjectWeights({
    rdoProjects: rdo([['pA', 6], ['pB', 2]]),
    manualProjectIds: reviewedDayEntry(['pA', 'pB'], 'PROJECT')
  });
  assert.equal(byRdo.reason, 'REVIEW_SHARED_CONFIRMED');
  assert.deepEqual(byRdo.allocations.map(item => item.weight), [0.75, 0.25]);
  const equal = buildDailyProjectWeights({ manualProjectIds: reviewedDayEntry(['pA', 'pB'], 'PROJECT') });
  assert.deepEqual(equal.allocations.map(item => item.weight), [0.5, 0.5]);
});

test('dia conferido fora de projeto tira as horas de qualquer projeto e não vira pendência', () => {
  const decision = buildDailyProjectWeights({
    rdoProjects: rdo([['pRdo', 8]]),
    effectiveProjectIds: ['pEf'],
    manualProjectIds: reviewedDayEntry([], 'IDLE')
  });
  assert.deepEqual(decision, { allocations: [], reason: 'REVIEW_IDLE' });
  assert.equal(allocationDecisionRequiresAction(decision), false);
});

test('ajuste manual comum continua com o motivo de sempre', () => {
  assert.equal(buildDailyProjectWeights({ manualProjectIds: ['pA'] }).reason, 'MANUAL_OVERRIDE');
});

test('manualProjectsByCollaborator: conferência sobrepõe o ajuste manual do mesmo dia; viagem vira projeto', () => {
  const map = manualProjectsByCollaborator(
    [{ collaboratorId: 'c1', workDate: new Date('2026-10-27T00:00:00.000Z'), projectId: 'pOld' }],
    [
      { collaboratorId: 'c1', date: '2026-10-27', kind: 'SEDE', projectIds: [] },
      { collaboratorId: 'c1', date: '2026-10-28', kind: 'TRAVEL', projectIds: ['pDest'] }
    ]
  );
  const days = map.get('c1');
  assert.equal(days.get('2026-10-27').reviewKind, 'IDLE');
  assert.deepEqual([...days.get('2026-10-27')], []);
  assert.equal(days.get('2026-10-28').reviewKind, 'PROJECT');
  assert.deepEqual([...days.get('2026-10-28')], ['pDest']);
});

test('classifyProjectHours: Sede conferida tira as horas do RDO; projeto conferido sem ponto em dia útil recebe 8h48', () => {
  const manual = manualProjectsByCollaborator([], [
    { collaboratorId: 'c1', date: '2026-10-26', kind: 'SEDE', projectIds: [] },
    { collaboratorId: 'c1', date: '2026-10-27', kind: 'PROJECT', projectIds: ['pB'] },
    { collaboratorId: 'c1', date: '2026-10-31', kind: 'PROJECT', projectIds: ['pB'] }
  ]).get('c1');
  const dayRows = [
    { date: '2026-10-26', normalHours: 8, he70Horas: 1, he100Horas: 0, tags: [] },
    { date: '2026-10-27', normalHours: 0, he70Horas: 0, he100Horas: 0, tags: [] },
    { date: '2026-10-31', normalHours: 0, he70Horas: 0, he100Horas: 0, tags: [] }
  ];
  const rdoData = { dayProjects: new Map([['2026-10-26', rdo([['pA', 8]])]]), byProject: new Map() };
  const result = classifyProjectHours(dayRows, rdoData, () => null, new Map(), manual);
  const [sede, reviewed, saturday] = result.dayTrail;
  assert.equal(sede.reason, 'REVIEW_IDLE');
  assert.deepEqual(sede.allocations, []);
  assert.equal(sede.pending, false);
  assert.equal(sede.reviewKind, 'IDLE');
  assert.equal(reviewed.reason, 'REVIEW_CONFIRMED');
  assert.equal(reviewed.costNormalHours, 8.8);
  assert.deepEqual(reviewed.reviewedProjectIds, ['pB']);
  assert.deepEqual(reviewed.manualProjectIds, []);
  assert.equal(saturday.reason, 'NO_POINT_HOURS', 'fim de semana sem ponto não ganha piso');
  // Horas da folha: 8 do dia em Sede (sem piso, fora de projeto) + 8,8 do dia conferido sem ponto.
  assert.equal(result.costNormalHours, 16.8);
});

test('dias úteis conferidos em projeto entram como dias vazios no mês', () => {
  const extra = reviewedProjectDatesByCollaborator([
    { collaboratorId: 'c1', date: '2026-10-27', kind: 'PROJECT', projectIds: ['pB'] },
    { collaboratorId: 'c1', date: '2026-10-31', kind: 'PROJECT', projectIds: ['pB'] },
    { collaboratorId: 'c1', date: '2026-10-28', kind: 'FOLGA', projectIds: [] }
  ]);
  assert.deepEqual(extra.get('c1'), ['2026-10-27']);
  const period = { collaboratorId: 'c1', monthly: { '2026-10': { days: [{ date: '2026-10-26', normalHours: 8 }] } } };
  const months = monthsWithEffectiveAllocationDays(period, new Map(), '2026-10-01', '2026-10-31', extra.get('c1'));
  assert.deepEqual(months[0].days.map(day => day.date), ['2026-10-26', '2026-10-27']);
});
