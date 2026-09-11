import assert from 'node:assert/strict';
import test from 'node:test';

import { addMissionAllocation, listEligibleCollaborators, updateMissionAllocationPeriod } from '../src/lib/efetivo/planning/allocations.js';
import { autoAllocateMission } from '../src/lib/efetivo/planning/auto-allocation.js';
import { collectAllocationConflicts } from '../src/lib/efetivo/planning/conflicts.js';
import { createAllocationCycle, createMissionCycle, updateAllocationCycle, updateMissionCycle } from '../src/lib/efetivo/planning/cycles.js';
import { resolveSelectedMissionTeam } from '../src/lib/efetivo/planning/mission-team.js';
import { listPlanningCollaborators } from '../src/lib/efetivo/planning/read-model.js';
import { allocationInputSchema, allocationPeriodInputSchema, mobilizationCycleInputSchema } from '../src/lib/efetivo/planning/schemas.js';

function fixture({ allocated = true, ownCycles = false } = {}) {
  const role = { id: 'r1', name: 'Operador', isActive: true, isOperational: true };
  const person = { id: 'c1', name: 'Colaborador desligado', jobRoleId: role.id, jobRole: role, isActive: false, admissionDate: null, terminationDate: null };
  const plan = { id: 'p1', kind: 'SCENARIO', status: 'DRAFT', revision: 1 };
  const cycle = { id: 'cycle1', mobilizationDate: '2026-07-01', demobilizationDate: '2026-07-10' };
  const allocation = { id: 'a1', collaboratorId: person.id, collaborator: person, jobRoleId: role.id, jobRole: role, cycles: ownCycles ? [{ ...cycle, id: 'own1' }] : [] };
  const mission = {
    id: 'm1', planId: plan.id, plan, project: { code: '5800', name: 'Missão histórica' },
    scheduleStatus: 'CONFIRMED', mobilizationDate: '2026-07-01', executionEndDate: '2026-07-31', returnDate: null,
    cycles: [cycle], demands: [{ jobRoleId: role.id, jobRole: role, requiredCount: 1 }], allocations: allocated ? [allocation] : []
  };
  const writes = [];
  const audits = [];
  const collaboratorQueries = [];
  const write = async ({ data, where }) => { const result = { id: where?.id || 'created', ...data }; writes.push(result); return result; };
  const database = {
    efetivoPlan: { findFirst: async () => plan, findUnique: async () => plan, update: async () => plan },
    collaborator: {
      findUnique: async () => person,
      findMany: async ({ where }) => {
        collaboratorQueries.push(where);
        if (where.isActive === true) return [];
        if (where.isActive === false || where.id) return [person];
        return where.OR ? [] : [person];
      }
    },
    jobRole: { findMany: async () => [role] },
    collaboratorAbsence: { findMany: async () => [] },
    efetivoMissionPlan: { findUnique: async () => mission, findMany: async () => [] },
    efetivoMissionAllocation: {
      findMany: async ({ where }) => where.missionId ? mission.allocations.map(item => ({ ...item, mission })) : [],
      findFirst: async () => allocation,
      update: write,
      upsert: async ({ create }) => write({ data: create })
    },
    efetivoMissionCycle: { create: write, update: write },
    efetivoAllocationCycle: { create: write, update: write, findFirst: async () => null },
    efetivoAuditEvent: { create: async ({ data }) => audits.push(data) },
    workforceHoliday: { findMany: async () => [] },
    workforceCalendarState: { findUnique: async () => ({ id: 'global', revision: 1 }) },
    efetivoSetting: { findUnique: async () => null },
    efetivoPlannedHire: { findMany: async () => [] }
  };
  return { person, mission, allocation, database, writes, audits, collaboratorQueries };
}

const inactiveConflict = error => error.conflicts?.some(conflict => conflict.code === 'OUTSIDE_EMPLOYMENT');

test('confirmação de inativo preserva limites do vínculo, função, ausências e sobreposições', () => {
  const { person } = fixture();
  const input = { collaborator: person, jobRoleId: 'r1', period: { startDate: '2026-07-01', endDate: '2026-07-10' } };
  assert.equal(collectAllocationConflicts(input)[0].code, 'OUTSIDE_EMPLOYMENT');
  assert.deepEqual(collectAllocationConflicts({ ...input, allowInactiveCollaborator: true }), []);
  for (const bounds of [{ admissionDate: '2026-07-02' }, { terminationDate: '2026-07-09' }]) {
    assert.equal(collectAllocationConflicts({ ...input, collaborator: { ...person, ...bounds }, allowInactiveCollaborator: true })[0].code, 'OUTSIDE_EMPLOYMENT');
  }
  const conflicts = collectAllocationConflicts({
    ...input, allowInactiveCollaborator: true, jobRoleId: 'other-role',
    absences: [{ id: 'absence', type: 'FERIAS', startDate: '2026-07-02', endDate: '2026-07-03' }],
    allocations: [{ id: 'other', mission: { id: 'other-mission', scheduleStatus: 'CONFIRMED', mobilizationDate: '2026-07-02', returnDate: '2026-07-03' } }]
  });
  assert.deepEqual(conflicts.map(conflict => conflict.code), ['WRONG_JOB_ROLE', 'ABSENCE_FERIAS', 'MISSION_OVERLAP']);
});

test('consulta de elegíveis inclui inativos somente quando solicitado e identifica a confirmação necessária', async () => {
  const { database, collaboratorQueries } = fixture({ allocated: false });
  assert.deepEqual(await listEligibleCollaborators('m1', 'r1', {}, { database }), []);
  const candidates = await listEligibleCollaborators('m1', 'r1', { includeInactive: true }, { database });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].isActive, false);
  assert.equal(candidates[0].requiresInactiveConfirmation, true);
  assert.equal(collaboratorQueries[0].isActive, true);
});

test('seletor inclui inativos sem data de desligamento que não participam da projeção', async () => {
  const { database } = fixture();
  assert.deepEqual(await listPlanningCollaborators({ date: '2026-09-08' }, { database }), []);
  const people = await listPlanningCollaborators({ date: '2026-09-08', includeInactive: true }, { database });
  assert.equal(people.length, 1);
  assert.equal(people[0].isActive, false);
  assert.equal(people[0].terminationDate, null);
  assert.equal(people[0].status, 'OUTSIDE_EMPLOYMENT');
  assert.equal(people[0].plannedUtilization90d, null);
});

test('inclusão manual exige confirmação e a registra na auditoria sem reativar o colaborador', async () => {
  const { database, person, writes, audits } = fixture({ allocated: false });
  const payload = { collaboratorId: 'c1', jobRoleId: 'r1', mobilizationDate: '2026-07-01', demobilizationDate: '2026-07-10' };
  await assert.rejects(addMissionAllocation('m1', payload, {}, { database }), inactiveConflict);
  assert.equal(writes.length, 0);
  await addMissionAllocation('m1', { ...payload, allowInactiveCollaborator: true }, {}, { database });
  assert.equal(audits[0].afterData.inactiveCollaboratorConfirmed, true);
  assert.equal(person.isActive, false);
  assert.equal(writes[0].collaboratorId, 'c1');
});

test('autoalocação continua excluindo colaboradores inativos', async () => {
  const { database, writes } = fixture({ allocated: false });
  const result = await autoAllocateMission('m1', {}, { database });
  assert.equal(result.created.length, 0);
  assert.equal(result.remainingDeficits[0].deficit, 1);
  assert.equal(writes.length, 0);
});

test('equipe da programação exige confirmação específica para cada inativo', async () => {
  const { database } = fixture({ allocated: false });
  const payload = { collaboratorIds: ['c1'], scheduleStatus: 'CONFIRMED', mobilizationDate: '2026-07-01', executionEndDate: '2026-07-10' };
  await assert.rejects(resolveSelectedMissionTeam(database, { ...payload, confirmedInactiveCollaboratorIds: ['another-person'] }, 'p1'), inactiveConflict);
  const team = await resolveSelectedMissionTeam(database, { ...payload, confirmedInactiveCollaboratorIds: ['c1'] }, 'p1');
  assert.equal(team.allocations[0].collaboratorId, 'c1');
});

for (const operation of ['criar ciclo individual', 'editar ciclo individual', 'criar ciclo herdado', 'editar ciclo herdado', 'editar período individual']) {
  test(`${operation} de colaborador inativo exige aviso confirmado antes de persistir`, async () => {
    const { database, writes, audits, person } = fixture({ ownCycles: operation.includes('ciclo individual') });
    const payload = { mobilizationDate: '2026-07-01', demobilizationDate: '2026-07-09' };
    if (operation.startsWith('criar')) {
      payload.mobilizationDate = '2026-07-11';
      payload.demobilizationDate = '2026-07-20';
      if (operation.includes('individual')) {
        const mission = await database.efetivoMissionPlan.findUnique();
        mission.cycles[0].demobilizationDate = '2026-07-31';
      }
    }
    const invoke = confirmation => {
      const data = { ...payload, ...(confirmation ? { allowInactiveCollaborator: true } : {}) };
      switch (operation) {
        case 'criar ciclo individual': return createAllocationCycle('m1', 'a1', data, {}, { database });
        case 'editar ciclo individual': return updateAllocationCycle('m1', 'a1', 'own1', data, {}, { database });
        case 'criar ciclo herdado': return createMissionCycle('m1', data, {}, { database });
        case 'editar ciclo herdado': return updateMissionCycle('m1', 'cycle1', data, {}, { database });
        default: return updateMissionAllocationPeriod('m1', 'a1', data, {}, { database });
      }
    };
    await assert.rejects(invoke(false), inactiveConflict);
    assert.equal(writes.length, 0);
    await invoke(true);
    assert.equal(audits[0].afterData.inactiveCollaboratorConfirmed, true);
    assert.equal(person.isActive, false);
  });
}

test('contratos exigem booleano explícito para confirmar uso de inativos', () => {
  const base = { collaboratorId: 'c1', jobRoleId: 'r1', mobilizationDate: '2026-07-01', demobilizationDate: '2026-07-10' };
  for (const schema of [allocationInputSchema, allocationPeriodInputSchema, mobilizationCycleInputSchema]) {
    assert.equal(schema.parse(base).allowInactiveCollaborator, false);
    assert.equal(schema.parse({ ...base, allowInactiveCollaborator: true }).allowInactiveCollaborator, true);
    assert.equal(schema.safeParse({ ...base, allowInactiveCollaborator: 'true' }).success, false);
  }
});
