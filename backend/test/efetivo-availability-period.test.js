import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAvailabilityPeriod } from '../src/lib/efetivo/planning/availability-period.js';

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
  assert.deepEqual(result.roles[0].daily.map(day => [day.demand, day.allocated, day.deficit]), [[2, 0, 2], [2, 1, 1], [2, 0, 2]]);
  assert.equal(result.roles[0].peakDeficit, 2);
  assert.equal(result.roles[0].deficitDays, 3);
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
