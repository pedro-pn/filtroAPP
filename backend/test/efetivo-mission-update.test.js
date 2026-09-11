import assert from 'node:assert/strict';
import test from 'node:test';

import { updateMission } from '../src/lib/efetivo/planning/mission-planning.js';

function fixture({ absences = [], individualCycles = [], missionCycles = null } = {}) {
  const plan = { id: 'plan', kind: 'SCENARIO', status: 'DRAFT', revision: 1 };
  const person = {
    id: 'person', name: 'Pessoa da equipe', isActive: true,
    jobRoleId: 'role', jobRole: { id: 'role', name: 'Operador', isActive: true, isOperational: true }
  };
  const mission = {
    id: 'mission', planId: plan.id, projectId: 'project', project: { name: 'Projeto' },
    version: 1, scheduleStatus: 'CONFIRMED', stage: 'EXECUTION',
    mobilizationDate: '2026-07-06', executionStartDate: '2026-07-06',
    executionEndDate: '2026-08-20', returnDate: null,
    cycles: missionCycles || [{ id: 'legacy-cycle', mobilizationDate: '2026-07-06', demobilizationDate: '2026-08-20' }],
    allocations: [{
      id: 'allocation', collaboratorId: person.id, jobRoleId: person.jobRoleId,
      collaborator: person, mobilizationDate: null, demobilizationDate: null, cycles: individualCycles
    }],
    demands: [{ jobRoleId: 'role', requiredCount: 1 }]
  };
  const writes = [];
  const database = {
    efetivoPlan: { findUnique: async () => plan, update: async () => plan },
    user: { findFirst: async () => ({ id: 'leader', name: 'Líder', collaborator: person }) },
    collaborator: { findMany: async () => [person] },
    collaboratorAbsence: { findMany: async () => absences },
    jobRole: { findMany: async () => [{ id: 'role' }] },
    efetivoMissionPlan: {
      findUnique: async () => mission,
      update: async ({ data }) => {
        writes.push(data);
        Object.assign(mission, data, { demands: data.demands.create, version: 2 });
        return mission;
      }
    },
    efetivoMissionDemand: { deleteMany: async () => {} },
    efetivoMissionCycle: {
      update: async ({ where, data }) => Object.assign(mission.cycles.find(cycle => cycle.id === where.id), data)
    },
    efetivoMissionAllocation: {
      findMany: async ({ where }) => where.missionId
        ? mission.allocations.map(allocation => ({ ...allocation, mission })) : [],
      updateMany: async () => {},
      upsert: async ({ update }) => Object.assign(mission.allocations[0], update)
    },
    efetivoAuditEvent: { create: async () => {} }
  };
  const payload = {
    projectId: mission.projectId, headquartersResponsibleUserId: 'leader',
    scheduleStatus: mission.scheduleStatus,
    mobilizationDate: mission.mobilizationDate, executionStartDate: mission.executionStartDate,
    executionEndDate: mission.executionEndDate, returnDate: null,
    collaboratorIds: ['person'], allocationPeriods: []
  };
  return { mission, database, payload, writes };
}

test('encurtar programação com equipe herdada atualiza o ciclo automático antes de validar as alocações', async () => {
  const { mission, database, payload } = fixture();
  const result = await updateMission(mission.id, {
    ...payload, executionEndDate: '2026-08-19',
    allocationPeriods: [{ collaboratorId: 'person', mobilizationDate: '2026-07-06', demobilizationDate: '2026-08-19' }]
  }, {}, { database });
  assert.equal(result.executionEndDate.toISOString().slice(0, 10), '2026-08-19');
  assert.equal(result.cycles[0].demobilizationDate.toISOString().slice(0, 10), '2026-08-19');
  assert.equal(result.allocations[0].demobilizationDate, null);
});

test('estender programação revalida a equipe herdada também nos novos dias', async () => {
  const { mission, database, payload, writes } = fixture({ absences: [{
    id: 'absence', collaboratorId: 'person', type: 'FERIAS', startDate: '2026-08-25', endDate: '2026-08-30'
  }] });
  await assert.rejects(updateMission(mission.id, {
    ...payload, executionEndDate: '2026-09-01'
  }, {}, { database }), error => error.conflicts?.[0]?.code === 'ABSENCE_FERIAS');
  assert.equal(writes.length, 0);
});

test('reduzir datas gerais não apaga nem encurta ciclos individuais já registrados', async () => {
  const { mission, database, payload, writes } = fixture({ individualCycles: [{
    id: 'individual', mobilizationDate: '2026-07-06', demobilizationDate: '2026-08-20'
  }] });
  await assert.rejects(updateMission(mission.id, {
    ...payload, executionEndDate: '2026-08-19'
  }, {}, { database }), error => error.code === 'ALLOCATION_OUTSIDE_MISSION_PERIOD');
  assert.equal(writes.length, 0);
});

test('remobilização não pode substituir a data geral e excluir o histórico de ciclos', async () => {
  const { mission, database, payload, writes } = fixture({ missionCycles: [
    { id: 'first', mobilizationDate: '2026-07-06', demobilizationDate: '2026-07-20' },
    { id: 'return', mobilizationDate: '2026-08-01', demobilizationDate: null }
  ] });
  await assert.rejects(updateMission(mission.id, {
    ...payload, mobilizationDate: '2026-08-01', executionStartDate: '2026-08-01'
  }, {}, { database }), error => error.code === 'MISSION_CYCLE_OUTSIDE_MISSION_PERIOD' && /Gerenciar equipe/.test(error.message));
  assert.equal(writes.length, 0);
});
