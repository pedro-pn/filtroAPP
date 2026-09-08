import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AllocationAuditError,
  buildAllocationAudit,
  groupUnallocatedDays,
  validateUnallocatedSelection
} from '../src/lib/acompanhamento/allocation-audit.js';

const PROJECTS = new Map([
  ['p-5804', { id: 'p-5804', code: '5804', name: 'MRN' }],
  ['p-5820', { id: 'p-5820', code: '5820', name: 'Outra' }]
]);
const KNOWN_CODES = new Set(['5804', '5820']);

function day(date, overrides = {}) {
  const reason = overrides.reason || 'EFFECTIVE_PERIOD_MISMATCH';
  return {
    date,
    normalHours: 8.8,
    he70Hours: 0,
    he100Hours: 0,
    tags: [],
    tagProjectIds: [],
    rdoProjects: [],
    manualProjectIds: [],
    allocations: [],
    reason,
    ...overrides,
    pending: overrides.pending ?? !['NO_PROJECT_EVIDENCE', 'NO_RDO_EVIDENCE', 'NO_POINT_HOURS'].includes(reason)
  };
}

function rate(days, overrides = {}) {
  return {
    collaboratorId: 'c-1',
    name: 'Valdecir Rodrigues Rumpel',
    role: 'Encarregado(a) de Operações III',
    allocationTrail: days,
    unresolvedDays: days
      .filter(item => item.allocations.length === 0 && item.normalHours + item.he70Hours + item.he100Hours > 0)
      .map(item => ({ date: item.date, reason: item.reason })),
    ...overrides
  };
}

test('dias contíguos do mesmo motivo viram um bloco só', () => {
  const days = ['2026-08-17', '2026-08-18', '2026-08-19'].map(date => day(date));
  const result = groupUnallocatedDays({
    rates: [rate(days)],
    projectsById: PROJECTS,
    knownMissionCodes: KNOWN_CODES,
    cutoffDateKey: '2025-01-01'
  });

  assert.equal(result.actionable.length, 1);
  assert.equal(result.actionable[0].days.length, 3);
  assert.equal(result.counts.actionableDays, 3);
  assert.ok(Math.abs(result.counts.actionableHours - 26.4) < 1e-6);
});

test('lacuna no calendário quebra o bloco', () => {
  const days = [day('2026-08-17'), day('2026-08-18'), day('2026-08-21')];
  const result = groupUnallocatedDays({
    rates: [rate(days)],
    projectsById: PROJECTS,
    knownMissionCodes: KNOWN_CODES,
    cutoffDateKey: '2025-01-01'
  });

  assert.deepEqual(result.actionable.map(block => block.days.length), [2, 1]);
});

test('etiqueta isolada de missão não cadastrada não vira pendência', () => {
  const days = [day('2026-08-17', {
    tags: ['Missão 9999 - cliente'],
    reason: 'NO_PROJECT_EVIDENCE'
  })];
  const result = groupUnallocatedDays({
    rates: [rate(days)],
    projectsById: PROJECTS,
    knownMissionCodes: KNOWN_CODES,
    cutoffDateKey: '2025-01-01'
  });

  assert.equal(result.actionable.length, 0);
  assert.equal(result.missingProjects.length, 0);
  assert.equal(result.counts.actionableDays, 0);
  assert.equal(result.counts.missingProjectDays, 0);
});

test('etiqueta de viagem sem RDO ou Efetivo não vira pendência', () => {
  const days = [day('2026-08-17', {
    tags: ['EM VIAGEM - 07.264.184/0001-46'],
    reason: 'NO_PROJECT_EVIDENCE'
  })];
  const result = groupUnallocatedDays({
    rates: [rate(days)],
    projectsById: PROJECTS,
    knownMissionCodes: KNOWN_CODES,
    cutoffDateKey: '2025-01-01'
  });

  assert.equal(result.actionable.length, 0);
  assert.equal(result.missingProjects.length, 0);
});

test('evidência substitui o corte fixo e o filtro de período continua sendo respeitado', () => {
  const days = [day('2024-12-31'), day('2026-08-17')];
  const comCorte = groupUnallocatedDays({
    rates: [rate(days)],
    projectsById: PROJECTS,
    knownMissionCodes: KNOWN_CODES,
    cutoffDateKey: '2025-01-01'
  });
  assert.deepEqual(comCorte.actionable.flatMap(block => block.days.map(item => item.date)), [
    '2024-12-31',
    '2026-08-17'
  ]);

  const tentandoAfrouxar = groupUnallocatedDays({
    rates: [rate(days)],
    projectsById: PROJECTS,
    knownMissionCodes: KNOWN_CODES,
    cutoffDateKey: '2025-01-01',
    from: '2026-01-01'
  });
  assert.deepEqual(tentandoAfrouxar.actionable.flatMap(block => block.days.map(item => item.date)), ['2026-08-17']);
});

test('auditoria por projeto traz o dia alocado e também o candidato que não levou as horas', () => {
  const days = [
    day('2026-07-20', {
      rdoProjects: [{ projectId: 'p-5804', hours: 9.5 }],
      allocations: [{ projectId: 'p-5804', weight: 1 }],
      reason: 'SINGLE_RDO_FALLBACK'
    }),
    // Etiqueta cita o 5804, mas o RDO único do dia é de outro projeto e prevalece: o 5804 é
    // candidato e não levou as horas. É exatamente o dia que o gestor precisa ver ao auditar.
    day('2026-08-06', {
      tags: ['Missão 5804'],
      tagProjectIds: ['p-5804'],
      rdoProjects: [{ projectId: 'p-5820', hours: 9 }],
      allocations: [{ projectId: 'p-5820', weight: 1 }],
      reason: 'SINGLE_RDO_OVERRIDES_TAG'
    }),
    // Sem qualquer menção ao 5804: fica de fora da visão do projeto.
    day('2026-08-17', { tags: ['EM VIAGEM - 07.264.184/0001-46'] })
  ];
  const result = buildAllocationAudit({
    rates: [rate(days)],
    projectsById: PROJECTS,
    knownMissionCodes: KNOWN_CODES,
    projectId: 'p-5804'
  });

  const [collaborator] = result.collaborators;
  assert.deepEqual(collaborator.days.map(item => item.date), ['2026-07-20', '2026-08-06']);
  assert.equal(collaborator.days[0].allocations[0].code, '5804');
  assert.equal(collaborator.days[1].allocations[0].code, '5820');
  assert.equal(collaborator.days[1].reason, 'SINGLE_RDO_OVERRIDES_TAG');
});

test('auditoria por colaborador soma por projeto respeitando o peso do rateio', () => {
  const days = [
    day('2026-07-20', {
      normalHours: 10,
      allocations: [{ projectId: 'p-5804', weight: 0.6 }, { projectId: 'p-5820', weight: 0.4 }],
      reason: 'MULTIPLE_CONFIRMED_TAGS'
    }),
    day('2026-07-21', { normalHours: 8, tags: [] })
  ];
  const result = buildAllocationAudit({
    rates: [rate(days)],
    projectsById: PROJECTS,
    knownMissionCodes: KNOWN_CODES,
    collaboratorId: 'c-1'
  });

  const [collaborator] = result.collaborators;
  const porProjeto = new Map(collaborator.totals.byProject.map(item => [item.code, item.normalHours]));
  assert.ok(Math.abs(porProjeto.get('5804') - 6) < 1e-6);
  assert.ok(Math.abs(porProjeto.get('5820') - 4) < 1e-6);
  assert.ok(Math.abs(collaborator.totals.unallocatedHours - 8) < 1e-6);
});

test('auditoria soma por projeto as horas efetivamente apropriadas após o piso diário', () => {
  const days = [day('2026-08-17', {
    normalHours: 7,
    costNormalHours: 7.8,
    minimumNormalHoursApplied: true,
    he70Hours: 1,
    rdoProjects: [{ projectId: 'p-5804', hours: 8 }],
    allocations: [{ projectId: 'p-5804', weight: 1 }],
    reason: 'SINGLE_RDO_FALLBACK'
  })];
  const result = buildAllocationAudit({
    rates: [rate(days)],
    projectsById: PROJECTS,
    knownMissionCodes: KNOWN_CODES,
    collaboratorId: 'c-1'
  });

  const [collaborator] = result.collaborators;
  assert.ok(Math.abs(collaborator.totals.byProject[0].normalHours - 7.8) < 1e-6);
  assert.ok(Math.abs(collaborator.days[0].appropriatedTotalHours - 8.8) < 1e-6);
  assert.equal(collaborator.days[0].minimumNormalHoursApplied, true);
});

test('filtro de não alocados esconde os dias já resolvidos', () => {
  const days = [
    day('2026-07-20', { allocations: [{ projectId: 'p-5804', weight: 1 }], reason: 'SINGLE_RDO_FALLBACK' }),
    day('2026-07-21')
  ];
  const result = buildAllocationAudit({
    rates: [rate(days)],
    projectsById: PROJECTS,
    knownMissionCodes: KNOWN_CODES,
    collaboratorId: 'c-1',
    onlyUnallocated: true
  });

  assert.deepEqual(result.collaborators[0].days.map(item => item.date), ['2026-07-21']);
});

test('etiqueta ignorada tira o dia das duas listas e da contagem', () => {
  const days = [
    day('2026-08-17', { tags: ['Missão 9999 - cliente antigo'] }),
    day('2026-08-19', { tags: ['EM VIAGEM - 07.264.184/0001-46'] })
  ];
  const semIgnorar = groupUnallocatedDays({
    rates: [rate(days)],
    projectsById: PROJECTS,
    knownMissionCodes: KNOWN_CODES,
    cutoffDateKey: '2025-01-01'
  });
  assert.equal(semIgnorar.counts.missingProjectDays, 1);
  assert.equal(semIgnorar.counts.actionableDays, 1);

  const ignorando = groupUnallocatedDays({
    rates: [rate(days)],
    projectsById: PROJECTS,
    knownMissionCodes: KNOWN_CODES,
    ignoredTagSet: new Set(['missao 9999 - cliente antigo']),
    cutoffDateKey: '2025-01-01'
  });
  assert.equal(ignorando.counts.missingProjectDays, 0);
  assert.equal(ignorando.missingProjects.length, 0);
  // O dia de viagem, que não foi ignorado, continua na fila.
  assert.equal(ignorando.counts.actionableDays, 1);
});

test('dia com etiqueta ignorada e outra ainda pendente não some da fila', () => {
  const days = [day('2026-08-17', { tags: ['Missão 9999', 'EM VIAGEM - 07.264.184/0001-46'] })];
  const result = groupUnallocatedDays({
    rates: [rate(days)],
    projectsById: PROJECTS,
    knownMissionCodes: KNOWN_CODES,
    ignoredTagSet: new Set(['missao 9999']),
    cutoffDateKey: '2025-01-01'
  });

  assert.equal(result.counts.missingProjectDays + result.counts.actionableDays, 1);
});

test('conflito é subconjunto dos dias sem alocação, nunca uma fila paralela', () => {
  const days = [
    day('2026-08-17', { reason: 'TAG_RDO_CONFLICT' }),
    day('2026-08-18', { reason: 'AMBIGUOUS_WITHOUT_TAGS' }),
    day('2026-08-19', { reason: 'RDO_PERIOD_MISMATCH' })
  ];
  const result = groupUnallocatedDays({
    rates: [rate(days)],
    projectsById: PROJECTS,
    knownMissionCodes: KNOWN_CODES,
    cutoffDateKey: '2025-01-01'
  });

  assert.equal(result.counts.actionableDays, 3);
  assert.equal(result.counts.conflictDays, 2);
  assert.ok(result.counts.conflictDays < result.counts.actionableDays);
});

test('marcação sem RDO/Efetivo não vira pendência, mas conflito com RDO continua acionável', () => {
  const days = [
    day('2026-03-30', { reason: 'NO_RDO_EVIDENCE' }),
    day('2026-03-31', {
      reason: 'NO_RDO_EVIDENCE',
      tags: ['Missão 5804'],
      tagProjectIds: ['p-5804']
    }),
    day('2026-04-01', {
      reason: 'TAG_RDO_CONFLICT',
      rdoProjects: [{ projectId: 'p-5820', hours: 8.8 }],
      tags: ['Missão 5804'],
      tagProjectIds: ['p-5804']
    })
  ];
  const result = groupUnallocatedDays({
    rates: [rate(days)],
    projectsById: PROJECTS,
    knownMissionCodes: KNOWN_CODES,
    cutoffDateKey: '2025-01-01'
  });

  assert.deepEqual(result.actionable.flatMap(block => block.days.map(item => item.date)), ['2026-04-01']);
  assert.equal(result.counts.actionableDays, 1);
  assert.equal(result.counts.conflictDays, 1);
});

// === Validação da resolução manual de dias sem alocação ===

const SELECTION_CONTEXT = {
  unallocatedKeys: new Set(['c-1:2026-08-17']),
  knownProjectIds: new Set(['p-5804', 'p-5820'])
};

test('seleção válida normaliza os projetos, removendo espaços, vazios e repetidos', () => {
  assert.deepEqual(
    validateUnallocatedSelection(
      { collaboratorId: 'c-1', date: '2026-08-17', projectIds: [' p-5804 ', 'p-5804', '', 'p-5820'] },
      SELECTION_CONTEXT
    ),
    ['p-5804', 'p-5820']
  );
});

test('resolução recusa seleção vazia, projeto inexistente e dia que já não está pendente', () => {
  const cases = [
    [{ collaboratorId: 'c-1', date: '2026-08-17', projectIds: [] }, 'INVALID_PROJECT_SELECTION'],
    [{ collaboratorId: 'c-1', date: '2026-08-17', projectIds: ['  '] }, 'INVALID_PROJECT_SELECTION'],
    [{ collaboratorId: 'c-1', date: '2026-08-17', projectIds: ['p-inexistente'] }, 'PROJECT_NOT_FOUND'],
    // A trava que impede esta porta de sobrescrever em silêncio um dia já resolvido.
    [{ collaboratorId: 'c-1', date: '2026-08-18', projectIds: ['p-5804'] }, 'DAY_NOT_UNALLOCATED'],
    [{ collaboratorId: 'c-outro', date: '2026-08-17', projectIds: ['p-5804'] }, 'DAY_NOT_UNALLOCATED']
  ];
  for (const [item, code] of cases) {
    assert.throws(
      () => validateUnallocatedSelection(item, SELECTION_CONTEXT),
      error => error instanceof AllocationAuditError && error.code === code,
      `esperava ${code} para ${JSON.stringify(item)}`
    );
  }
});
