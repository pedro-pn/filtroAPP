import assert from 'node:assert/strict';
import test from 'node:test';

import {
  missionStageForProjectWorkflow,
  synchronizeOfficialMissionDemobilization,
  synchronizeOfficialMissionStage
} from '../src/lib/efetivo/planning/mission-stage-sync.js';

function completeMission(overrides = {}) {
  return {
    id: 'mission-1',
    projectId: 'project-1',
    planId: 'plan-1',
    stage: 'STANDBY',
    kanbanOrder: 0,
    version: 2,
    scheduleStatus: 'CONFIRMED',
    headquartersResponsibleUserId: 'leader-1',
    headquartersResponsibleName: 'Líder',
    headquartersResponsibleRole: 'Supervisor',
    mobilizationDate: new Date('2026-09-10T00:00:00Z'),
    executionStartDate: new Date('2026-09-11T00:00:00Z'),
    executionEndDate: new Date('2026-09-20T00:00:00Z'),
    returnDate: null,
    plan: { id: 'plan-1', revision: 4 },
    project: { id: 'project-1', code: 'P-1', name: 'Projeto', mobilizationDate: new Date('2026-09-10T00:00:00Z'), demobilizationDate: null },
    cycles: [],
    demands: [{ jobRoleId: 'role-1', requiredCount: 1 }],
    allocations: [{ id: 'allocation-1', jobRoleId: 'role-1', deletedAt: null, cycles: [] }],
    ...overrides
  };
}

function fakeDatabase(mission = completeMission()) {
  const state = { mission, updates: [], audits: [], planBumps: 0, projectUpdates: [] };
  const database = {
    efetivoMissionPlan: {
      findFirst: async () => state.mission,
      findMany: async () => [],
      update: async input => {
        state.updates.push(input);
        if (input.where.id === state.mission.id) {
          state.mission = {
            ...state.mission,
            ...(input.data.stage !== undefined ? { stage: input.data.stage } : {}),
            ...(input.data.kanbanOrder !== undefined ? { kanbanOrder: input.data.kanbanOrder } : {}),
            ...(input.data.returnDate !== undefined ? { returnDate: input.data.returnDate } : {}),
            version: state.mission.version + (input.data.version ? 1 : 0)
          };
        }
        return state.mission;
      }
    },
    project: {
      update: async input => {
        state.projectUpdates.push(input);
        state.mission.project = { ...state.mission.project, ...input.data };
        return state.mission.project;
      }
    },
    efetivoPlan: { update: async () => { state.planBumps += 1; return state.mission.plan; } },
    efetivoAuditEvent: { create: async input => { state.audits.push(input.data); return input.data; } }
  };
  return { database, state };
}

test('etapa do workflow possui projeção operacional única', () => {
  assert.equal(missionStageForProjectWorkflow('READY_TO_MOBILIZE'), 'STANDBY');
  assert.equal(missionStageForProjectWorkflow('MOBILIZATION'), 'MOBILIZATION');
  assert.equal(missionStageForProjectWorkflow('EXECUTION'), 'EXECUTION');
  assert.equal(missionStageForProjectWorkflow('DEMOBILIZATION'), 'FINAL_MEASUREMENT');
  assert.equal(missionStageForProjectWorkflow('PREPARATION'), null);
});

test('desmobilização atualiza retorno sem alterar equipe ou ciclos', async () => {
  const cycles = [{ id: 'cycle-1', mobilizationDate: new Date('2026-09-10T00:00:00Z') }];
  const allocations = [{ id: 'allocation-1', jobRoleId: 'role-1', deletedAt: null, cycles: [{ id: 'allocation-cycle-1' }] }];
  const { database, state } = fakeDatabase(completeMission({ stage: 'FINAL_MEASUREMENT', cycles, allocations }));
  const result = await synchronizeOfficialMissionDemobilization(database, 'project-1', '2026-09-22', { actorUserId: 'leader-1' });
  assert.equal(result.returnDate.toISOString().slice(0, 10), '2026-09-22');
  assert.deepEqual(state.mission.cycles, cycles);
  assert.deepEqual(state.mission.allocations, allocations);
  assert.equal(state.projectUpdates[0].data.demobilizationDate.toISOString().slice(0, 10), '2026-09-22');
  assert.equal(state.audits.at(-1).action, 'MISSION_DEMOBILIZATION_UPDATE');
});

test('desmobilização rejeita retorno anterior ao fim da execução', async () => {
  const { database } = fakeDatabase(completeMission({ stage: 'FINAL_MEASUREMENT' }));
  await assert.rejects(
    synchronizeOfficialMissionDemobilization(database, 'project-1', '2026-09-19'),
    error => error.code === 'INVALID_MISSION_CHRONOLOGY'
  );
});

test('avanço do projeto sincroniza missão oficial completa e registra auditoria', async () => {
  const { database, state } = fakeDatabase();
  const result = await synchronizeOfficialMissionStage(database, 'project-1', 'MOBILIZATION', { actorUserId: 'leader-1' });
  assert.equal(result.stage, 'MOBILIZATION');
  assert.equal(state.mission.version, 3);
  assert.equal(state.planBumps, 1);
  assert.equal(state.audits[0].action, 'MISSION_STAGE_CHANGE');
  assert.match(state.audits[0].summary, /sincronizada pelo fluxo do projeto/i);
});

test('mobilização exige missão oficial confirmada e completa', async () => {
  const missing = fakeDatabase(null);
  await assert.rejects(
    synchronizeOfficialMissionStage(missing.database, 'project-1', 'MOBILIZATION'),
    error => error.code === 'PROJECT_WORKFLOW_OFFICIAL_MISSION_REQUIRED'
  );
  const incomplete = fakeDatabase(completeMission({ scheduleStatus: 'DRAFT', allocations: [] }));
  await assert.rejects(
    synchronizeOfficialMissionStage(incomplete.database, 'project-1', 'EXECUTION'),
    error => error.code === 'PROJECT_WORKFLOW_MISSION_INCOMPLETE'
  );
});

test('retorno a Pronto para mobilizar não cria missão inexistente', async () => {
  const { database } = fakeDatabase(null);
  assert.equal(await synchronizeOfficialMissionStage(database, 'project-1', 'READY_TO_MOBILIZE'), null);
});
