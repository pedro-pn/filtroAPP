import assert from 'node:assert/strict';
import test from 'node:test';

import {
  missionStageForProjectWorkflow,
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
    project: { id: 'project-1', code: 'P-1', name: 'Projeto' },
    cycles: [],
    demands: [{ jobRoleId: 'role-1', requiredCount: 1 }],
    allocations: [{ id: 'allocation-1', jobRoleId: 'role-1', deletedAt: null, cycles: [] }],
    ...overrides
  };
}

function fakeDatabase(mission = completeMission()) {
  const state = { mission, updates: [], audits: [], planBumps: 0 };
  const database = {
    efetivoMissionPlan: {
      findFirst: async () => state.mission,
      findMany: async () => [],
      update: async input => {
        state.updates.push(input);
        if (input.where.id === state.mission.id) {
          state.mission = { ...state.mission, stage: input.data.stage, kanbanOrder: input.data.kanbanOrder, version: state.mission.version + 1 };
        }
        return state.mission;
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
  assert.equal(missionStageForProjectWorkflow('PREPARATION'), null);
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
