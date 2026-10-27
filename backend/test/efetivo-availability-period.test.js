import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAvailabilityPeriod, getPlanningAvailabilityPeriod } from '../src/lib/efetivo/planning/availability-period.js';

function ongoingProjectProjection() {
  return {
    jobRoles: [{ id: 'r1', name: 'Operador', isOperational: true, isActive: true }],
    collaborators: ['Antonio', 'Daniel', 'Wilton'].map((name, index) => ({ id: `c${index + 1}`, name, jobRoleId: 'r1', isActive: true })),
    absences: [],
    missions: [{
      id: 'future', projectId: '5843', scheduleStatus: 'CONFIRMED', stage: 'STANDBY',
      project: { code: '5843', name: 'Próxima missão' },
      mobilizationDate: '2026-10-25', executionEndDate: '2026-11-09', returnDate: null,
      cycles: [{ isDefault: true, mobilizationDate: '2026-10-25', demobilizationDate: null }],
      demands: [], allocations: [{ collaboratorId: 'c3' }]
    }, {
      id: 'current', projectId: '5800', scheduleStatus: 'CONFIRMED', stage: 'EXECUTION',
      project: { code: '5800', name: 'Reframax' },
      mobilizationDate: '2026-07-06', executionEndDate: '2026-08-20', returnDate: null,
      cycles: [{ isDefault: true, mobilizationDate: '2026-07-06', demobilizationDate: null }],
      demands: [{ jobRoleId: 'r1', requiredCount: 3 }],
      allocations: [
        { collaboratorId: 'c1' },
        { collaboratorId: 'c2', cycles: [{ mobilizationDate: '2026-08-20', demobilizationDate: null }] },
        { collaboratorId: 'c3', cycles: [{ mobilizationDate: '2026-10-05', demobilizationDate: null }] }
      ]
    }]
  };
}

test('ciclos gerais e individuais abertos mantêm os três colaboradores mobilizados após o fim previsto', () => {
  const projection = ongoingProjectProjection();
  const before = structuredClone(projection);
  const result = buildAvailabilityPeriod({ startDate: '2026-10-16', endDate: '2026-10-27', projection });
  assert.equal(result.people.length, 3);
  for (const person of result.people) {
    assert.equal(person.days.length, 12);
    assert.ok(person.days.every(day => day.status === 'MOBILIZED' && day.detail === '5800 · Reframax'), person.name);
  }
  assert.ok(result.roles[0].daily.every(day => day.allocated === 3 && day.free === 0 && day.demand === 3));
  assert.deepEqual(projection, before);
});

test('consulta da disponibilidade carrega ciclos abertos em campo mesmo quando a previsão terminou antes do período', async () => {
  const projection = ongoingProjectProjection();
  let missionQuery;
  const database = {
    efetivoPlan: { findFirst: async () => ({ id: 'official', kind: 'OFFICIAL', status: 'ACTIVE' }) },
    collaborator: { findMany: async () => projection.collaborators },
    jobRole: { findMany: async () => projection.jobRoles },
    efetivoMissionPlan: { findMany: async query => { missionQuery = query; return projection.missions; } },
    collaboratorAbsence: { findMany: async () => [] },
    workforceHoliday: { findMany: async () => [] },
    workforceCalendarState: { findUnique: async () => ({ revision: 1 }) },
    efetivoSetting: { findUnique: async () => null },
    efetivoPlannedHire: { findMany: async () => [] },
    projectWorkflow: { findMany: async () => [] }
  };
  const result = await getPlanningAvailabilityPeriod({ startDate: '2026-10-16', endDate: '2026-10-16' }, { database });
  assert.equal(missionQuery.where.planId, 'official');
  assert.deepEqual(missionQuery.where.OR.at(-1), {
    stage: { in: ['MOBILIZATION', 'EXECUTION', 'FINAL_MEASUREMENT'] },
    OR: [
      { cycles: { some: { demobilizationDate: null } } },
      { cycles: { none: {} }, returnDate: null },
      { allocations: { some: { deletedAt: null, OR: [
        { cycles: { some: { demobilizationDate: null } } },
        { cycles: { none: {} }, mobilizationDate: { not: null }, demobilizationDate: null }
      ] } } }
    ]
  });
  assert.ok(missionQuery.include.cycles);
  assert.ok(missionQuery.include.allocations.include.cycles);
  assert.ok(result.people.every(person => person.days[0].status === 'MOBILIZED'));
});

test('avançar para desmobilização sem informar saída efetiva mantém a equipe no projeto após a previsão', () => {
  const projection = ongoingProjectProjection();
  projection.missions[1].stage = 'FINAL_MEASUREMENT';
  const result = buildAvailabilityPeriod({ startDate: '2026-10-27', endDate: '2026-10-27', projection });
  assert.ok(result.people.every(person => person.days[0].status === 'MOBILIZED'
    && person.days[0].detail === '5800 · Reframax'));
  assert.equal(result.roles[0].daily[0].demand, 3);
  assert.equal(result.roles[0].daily[0].allocated, 3);
});

test('registro da saída geral libera a equipe herdada sem encerrar um ciclo individual ainda aberto', () => {
  const projection = ongoingProjectProjection();
  const mission = projection.missions[1];
  mission.stage = 'FINAL_MEASUREMENT';
  mission.returnDate = '2026-10-27';
  mission.cycles[0].demobilizationDate = '2026-10-27';
  mission.allocations[1].cycles = [];
  const result = buildAvailabilityPeriod({ startDate: '2026-10-27', endDate: '2026-10-28', projection });
  for (const person of result.people.filter(person => person.id !== 'c3')) {
    assert.deepEqual(person.days.map(day => day.status), ['MOBILIZED', 'AVAILABLE']);
  }
  assert.ok(result.people.find(person => person.id === 'c3').days.every(day => day.status === 'MOBILIZED'));
});

test('desmobilização individual, pausas e afastamentos continuam liberando ou bloqueando os dias corretos', () => {
  const projection = ongoingProjectProjection();
  const mission = projection.missions[1];
  mission.allocations[1].cycles[0].demobilizationDate = '2026-10-17';
  mission.allocations[1].cycles.push({ mobilizationDate: '2026-10-20', demobilizationDate: null });
  projection.absences.push({ collaboratorId: 'c1', type: 'FERIAS', startDate: '2026-10-18', endDate: '2026-10-18' });
  const result = buildAvailabilityPeriod({ startDate: '2026-10-16', endDate: '2026-10-20', projection });
  assert.deepEqual(result.people.find(person => person.id === 'c2').days.map(day => day.status), ['MOBILIZED', 'MOBILIZED', 'AVAILABLE', 'AVAILABLE', 'MOBILIZED']);
  assert.equal(result.people.find(person => person.id === 'c1').days[2].status, 'ON_VACATION');
});

test('ciclo encerrado, missão cancelada ou finalizada e programação em standby não prolongam alocação', () => {
  for (const change of [
    mission => { mission.cycles[0].demobilizationDate = '2026-10-15'; mission.allocations.forEach(allocation => { allocation.cycles = []; }); },
    mission => { mission.scheduleStatus = 'CANCELLED'; },
    mission => { mission.stage = 'FINISHED'; },
    mission => { mission.deletedAt = new Date(); },
    mission => { mission.stage = 'STANDBY'; }
  ]) {
    const projection = ongoingProjectProjection();
    change(projection.missions[1]);
    const result = buildAvailabilityPeriod({ startDate: '2026-10-16', endDate: '2026-10-16', projection });
    assert.ok(result.people.every(person => person.days[0].status === 'AVAILABLE'));
  }
});

test('fadiga offshore bloqueia o período inclusivo e recebe status e detalhe próprios', () => {
  const projection = {
    jobRoles: [{ id: 'r1', name: 'Operador', isOperational: true, isActive: true }],
    collaborators: [{ id: 'c1', name: 'Ana', jobRoleId: 'r1', isActive: true }],
    missions: [],
    absences: [{ id: 'a1', collaboratorId: 'c1', type: 'FADIGA_OFFSHORE', startDate: '2026-09-02', endDate: '2026-09-03' }]
  };
  const result = buildAvailabilityPeriod({ startDate: '2026-09-01', endDate: '2026-09-04', projection });
  assert.deepEqual(result.people[0].days, [
    { date: '2026-09-01', status: 'AVAILABLE', detail: null },
    { date: '2026-09-02', status: 'OFFSHORE_FATIGUE', detail: 'Fadiga - offshore' },
    { date: '2026-09-03', status: 'OFFSHORE_FATIGUE', detail: 'Fadiga - offshore' },
    { date: '2026-09-04', status: 'AVAILABLE', detail: null }
  ]);
  assert.deepEqual(result.roles[0].daily.map(day => day.free), [1, 0, 0, 1]);
});

test('vaga sem alocação não vira falta quando há colaborador livre do cargo', () => {
  const projection = {
    jobRoles: [{ id: 'r1', name: 'Operador', isOperational: true, isActive: true }],
    collaborators: [
      { id: 'c1', name: 'Ana', jobRoleId: 'r1', jobRole: { name: 'Operador' }, isActive: true },
      { id: 'c2', name: 'Bia', jobRoleId: 'r1', jobRole: { name: 'Operador' }, isActive: true }
    ],
    missions: [{
      id: 'm1', scheduleStatus: 'CONFIRMED', stage: 'STANDBY',
      mobilizationDate: '2026-09-01', returnDate: '2026-09-01',
      project: { code: 'P-1', name: 'Projeto' },
      demands: [{ jobRoleId: 'r1', requiredCount: 2 }], allocations: []
    }],
    absences: []
  };

  const result = buildAvailabilityPeriod({ startDate: '2026-09-01', endDate: '2026-09-01', projection });
  assert.equal(result.days[0].deficit, 2);
  assert.equal(result.days[0].shortage, 0);
  assert.equal(result.roles[0].peakShortage, 0);
});

test('período mostra transições individuais e déficit diário do projeto', () => {
  const projection = {
    jobRoles: [{ id: 'r1', name: 'Operador', isOperational: true, isActive: true, calendarColor: '#2563eb' }],
    collaborators: [
      { id: 'c1', name: 'Ana', jobRoleId: 'r1', jobRole: { name: 'Operador' }, admissionDate: '2025-01-01', isActive: true },
      { id: 'c2', name: 'Bia', jobRoleId: 'r1', jobRole: { name: 'Operador' }, admissionDate: '2025-01-01', isActive: true }
    ],
    missions: [{
      id: 'm1', scheduleStatus: 'CONFIRMED', stage: 'EXECUTION',
      mobilizationDate: '2026-09-01', executionEndDate: '2026-09-03', returnDate: '2026-09-03',
      project: { code: 'P-1', name: 'Projeto' },
      demands: [{ jobRoleId: 'r1', requiredCount: 2 }],
      allocations: [{ collaboratorId: 'c1', mobilizationDate: '2026-09-02', demobilizationDate: '2026-09-03' }]
    }],
    absences: [{ id: 'a1', collaboratorId: 'c1', type: 'FERIAS', startDate: '2026-09-03', endDate: '2026-09-03' }]
  };

  const result = buildAvailabilityPeriod({ startDate: '2026-09-01', endDate: '2026-09-03', projection });
  assert.deepEqual(result.days.map(day => day.deficit), [2, 1, 2]);
  assert.deepEqual(result.days.map(day => day.shortage), [0, 0, 1]);
  assert.deepEqual(result.roles[0].daily.map(day => [day.demand, day.allocated, day.free, day.deficit, day.shortage]), [[2, 0, 2, 2, 0], [2, 1, 1, 1, 0], [2, 0, 1, 2, 1]]);
  assert.equal(result.roles[0].peakDeficit, 2);
  assert.equal(result.roles[0].deficitDays, 3);
  assert.equal(result.roles[0].peakShortage, 1);
  assert.equal(result.roles[0].shortageDays, 1);
  assert.deepEqual(result.people.find(person => person.id === 'c1').days.map(day => day.status), ['AVAILABLE', 'MOBILIZED', 'ON_VACATION']);
  assert.equal(result.people.find(person => person.id === 'c1').days[1].detail, 'P-1 · Projeto');
});

test('filtro de função usa família de cargos e não mistura déficits de outras funções', () => {
  const projection = {
    jobRoles: [
      { id: 'r1', name: 'Assistente de Operações I', isOperational: true, isActive: true },
      { id: 'r2', name: 'Assistente de Operações II', isOperational: true, isActive: true },
      { id: 'r3', name: 'Soldador', isOperational: true, isActive: true }
    ],
    collaborators: [
      { id: 'c1', name: 'Ana', jobRoleId: 'r2', jobRole: { name: 'Assistente de Operações II' }, isActive: true },
      { id: 'c2', name: 'Bia', jobRoleId: 'r3', jobRole: { name: 'Soldador' }, isActive: true }
    ],
    missions: [{
      id: 'm1', scheduleStatus: 'CONFIRMED', stage: 'STANDBY',
      mobilizationDate: '2026-09-01', returnDate: '2026-09-01',
      project: { code: 'P-1', name: 'Projeto' },
      demands: [{ jobRoleId: 'r1', requiredCount: 2 }, { jobRoleId: 'r3', requiredCount: 3 }],
      allocations: [{ collaboratorId: 'c1' }]
    }],
    absences: []
  };
  const result = buildAvailabilityPeriod({ startDate: '2026-09-01', endDate: '2026-09-01', jobRoleId: 'r2', projection });
  assert.deepEqual(result.people.map(person => person.id), ['c1']);
  assert.equal(result.people[0].days[0].status, 'AWAITING_MOBILIZATION');
  assert.equal(result.roles.length, 1);
  assert.equal(result.roles[0].peakDeficit, 1);
  assert.equal(result.roles[0].peakShortage, 1);
  assert.equal(result.days[0].deficit, 1);
});

test('riscos planejados somam projetos no mesmo dia e descontam vagas já programadas', () => {
  const projection = {
    jobRoles: [{ id: 'r1', name: 'Operador', isOperational: true, isActive: true }],
    collaborators: [
      { id: 'c1', name: 'Ana', jobRoleId: 'r1', isActive: true },
      { id: 'c2', name: 'Bia', jobRoleId: 'r1', isActive: true }
    ],
    missions: [{
      id: 'm1', projectId: 'p1', scheduleStatus: 'CONFIRMED', stage: 'EXECUTION',
      mobilizationDate: '2026-09-01', returnDate: '2026-09-01',
      demands: [{ jobRoleId: 'r1', requiredCount: 1 }], allocations: [{ collaboratorId: 'c1' }]
    }],
    absences: []
  };
  const plannedWorkflows = [
    { projectId: 'p1', plannedMobilizationDate: '2026-09-01', project: { code: 'P1', name: 'Já programado' }, teamDemands: [{ jobRoleId: 'r1', requiredCount: 1 }] },
    { projectId: 'p2', plannedMobilizationDate: '2026-09-01', project: { code: 'P2', name: 'Novo' }, teamDemands: [{ jobRoleId: 'r1', requiredCount: 1 }] },
    { projectId: 'p3', plannedMobilizationDate: '2026-09-01', project: { code: 'P3', name: 'Outro' }, teamDemands: [{ jobRoleId: 'r1', requiredCount: 2 }] }
  ];
  const result = buildAvailabilityPeriod({ startDate: '2026-09-01', endDate: '2026-09-01', projection, plannedWorkflows });
  assert.equal(result.days[0].deficit, 0);
  assert.deepEqual(result.plannedRisks.map(risk => ({
    required: risk.required, free: risk.free, deficit: risk.deficit, projects: risk.projects.map(project => project.id)
  })), [{ required: 3, free: 1, deficit: 2, projects: ['p2', 'p3'] }]);
  const largerPlan = buildAvailabilityPeriod({
    startDate: '2026-09-01',
    endDate: '2026-09-01',
    projection,
    plannedWorkflows: [{ ...plannedWorkflows[0], teamDemands: [{ jobRoleId: 'r1', requiredCount: 4 }] }, ...plannedWorkflows.slice(1)]
  });
  assert.deepEqual(largerPlan.plannedRisks.map(risk => ({
    required: risk.required, free: risk.free, deficit: risk.deficit, projects: risk.projects.map(project => project.id)
  })), [{ required: 6, free: 1, deficit: 5, projects: ['p1', 'p2', 'p3'] }]);
});
