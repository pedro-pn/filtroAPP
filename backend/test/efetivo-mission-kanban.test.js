import assert from 'node:assert/strict';
import test from 'node:test';

import { missionStageSchema, stageInputSchema } from '../src/lib/efetivo/planning/schemas.js';
import {
  missionMoveRequiresMobilizationAuthorization,
  moveMissionStage
} from '../src/lib/efetivo/planning/mission-planning.js';

test('missão operacional aceita exatamente cinco etapas e ordem não negativa', () => {
  for (const stage of ['STANDBY', 'MOBILIZATION', 'EXECUTION', 'FINAL_MEASUREMENT', 'FINISHED']) assert.equal(missionStageSchema.parse(stage), stage);
  assert.equal(stageInputSchema.safeParse({ stage: 'EXECUTION', order: -1 }).success, false);
});

test('gate vale na entrada operacional, sem bloquear cenário ou reordenação', () => {
  assert.equal(missionMoveRequiresMobilizationAuthorization('OFFICIAL', 'STANDBY', 'MOBILIZATION'), true);
  assert.equal(missionMoveRequiresMobilizationAuthorization('OFFICIAL', 'STANDBY', 'EXECUTION'), true);
  assert.equal(missionMoveRequiresMobilizationAuthorization('OFFICIAL', 'MOBILIZATION', 'MOBILIZATION'), false);
  assert.equal(missionMoveRequiresMobilizationAuthorization('SCENARIO', 'STANDBY', 'MOBILIZATION'), false);
  assert.equal(missionMoveRequiresMobilizationAuthorization('OFFICIAL', 'EXECUTION', 'FINAL_MEASUREMENT'), false);
});

test('API bloqueia movimentação enquanto a programação estiver incompleta', async () => {
  const plan = { id: 'plan-1', kind: 'OFFICIAL', status: 'ACTIVE' };
  const database = {
    efetivoPlan: { findUnique: async () => plan },
    projectWorkflow: { findUnique: async () => null },
    efetivoMissionPlan: {
      findUnique: async () => ({
        id: 'mission-1', planId: plan.id, project: { name: 'Missão incompleta' }, version: 1,
        stage: 'STANDBY', scheduleStatus: 'DRAFT', headquartersResponsibleUserId: null,
        headquartersResponsibleName: '', headquartersResponsibleRole: '', demands: [], allocations: []
      })
    }
  };
  await assert.rejects(
    moveMissionStage('mission-1', { stage: 'MOBILIZATION', order: 0 }, { version: 1 }, { database }),
    error => error.code === 'MISSION_INCOMPLETE_FOR_KANBAN'
  );
});

test('missão gerenciada muda de etapa somente pelo Kanban único do projeto', async () => {
  const plan = { id: 'plan-1', kind: 'OFFICIAL', status: 'ACTIVE' };
  const mission = {
    id: 'mission-1', projectId: 'project-1', planId: plan.id, version: 1, stage: 'STANDBY', kanbanOrder: 0,
    scheduleStatus: 'CONFIRMED', headquartersResponsibleUserId: 'u1',
    headquartersResponsibleName: 'Ana', headquartersResponsibleRole: 'Líder',
    mobilizationDate: new Date('2026-09-10T00:00:00.000Z'),
    executionStartDate: new Date('2026-09-11T00:00:00.000Z'),
    executionEndDate: new Date('2026-09-20T00:00:00.000Z'),
    project: { id: 'project-1', name: 'Missão' },
    demands: [{ jobRoleId: 'role-1', requiredCount: 1 }],
    allocations: [{ id: 'allocation-1', jobRoleId: 'role-1', deletedAt: null }]
  };
  const database = {
    efetivoPlan: { findUnique: async () => plan },
    efetivoMissionPlan: { findUnique: async () => mission },
    projectWorkflow: { findUnique: async () => ({
      projectId: 'project-1', stage: 'PREPARATION', version: 1,
      mobilizationAuthorizedAt: null, mobilizationAuthorizationVersion: null,
      checklists: [], commercialFacts: [], issues: []
    }) }
  };
  await assert.rejects(
    moveMissionStage('mission-1', { stage: 'MOBILIZATION', order: 0 }, { version: 1 }, { database }),
    error => error.code === 'MISSION_STAGE_MANAGED_BY_PROJECT'
  );
});

test('concluir missão aceita desmobilização anterior ao fim previsto e sincroniza o projeto', async () => {
  const plan = { id: 'plan-1', kind: 'OFFICIAL', status: 'ACTIVE' };
  const mission = {
    id: 'mission-1', planId: plan.id, version: 1, stage: 'EXECUTION', kanbanOrder: 0,
    scheduleStatus: 'CONFIRMED', headquartersResponsibleUserId: 'u1',
    headquartersResponsibleName: 'Ana', headquartersResponsibleRole: 'Líder',
    mobilizationDate: new Date('2026-08-01T00:00:00.000Z'),
    executionStartDate: new Date('2026-08-02T00:00:00.000Z'),
    executionEndDate: new Date('2026-08-10T00:00:00.000Z'), returnDate: null,
    project: { id: 'project-1', name: 'Missão', mobilizationDate: new Date('2026-08-01T00:00:00.000Z') },
    demands: [{ requiredCount: 1 }], allocations: [{ id: 'allocation-1' }]
  };
  const missionUpdates = [];
  let projectUpdate;
  const database = {
    efetivoPlan: { findUnique: async () => plan, update: async () => plan },
    efetivoMissionPlan: {
      findUnique: async () => mission,
      findMany: async () => [],
      update: async input => {
        missionUpdates.push(input);
        return { ...mission, stage: input.data.stage || 'FINISHED', returnDate: input.data.returnDate ?? mission.returnDate };
      }
    },
    projectWorkflow: { findUnique: async () => null },
    project: { update: async input => { projectUpdate = input; } },
    efetivoAuditEvent: { create: async () => ({ id: 'audit-1' }) }
  };
  const moved = await moveMissionStage('mission-1', {
    stage: 'FINISHED', order: 0, returnDate: '2026-08-08'
  }, { version: 1 }, { database });
  assert.equal(projectUpdate.data.demobilizationDate.toISOString(), '2026-08-08T00:00:00.000Z');
  assert.ok(missionUpdates.some(input => input.data.returnDate?.toISOString() === '2026-08-08T00:00:00.000Z'));
  assert.equal(moved.returnDate.toISOString(), '2026-08-08T00:00:00.000Z');
  assert.equal(moved.executionEndDate.toISOString(), '2026-08-10T00:00:00.000Z');
});

function legacyExecutionDatabase(kind = 'OFFICIAL') {
  const state = {
    plan: { id: 'plan-1', kind, status: kind === 'OFFICIAL' ? 'ACTIVE' : 'DRAFT' },
    project: { id: 'project-1', name: 'Missão antiga', mobilizationDate: new Date('2026-09-10T00:00:00Z') },
    users: [], audits: [], notifications: [],
    mission: {
      id: 'mission-1', projectId: 'project-1', planId: 'plan-1', version: 1, stage: 'MOBILIZATION', kanbanOrder: 0,
      scheduleStatus: 'CONFIRMED', headquartersResponsibleUserId: 'leader', headquartersResponsibleName: 'Líder', headquartersResponsibleRole: 'Supervisor',
      mobilizationDate: new Date('2026-09-10T00:00:00Z'), executionStartDate: new Date('2026-09-11T00:00:00Z'), executionEndDate: new Date('2026-09-20T00:00:00Z'),
      demands: [{ jobRoleId: 'role-1', requiredCount: 2 }],
      allocations: ['ana', 'carlos'].map(collaboratorId => ({
        id: `allocation-${collaboratorId}`, collaboratorId, jobRoleId: 'role-1', deletedAt: null,
        collaborator: { id: collaboratorId, name: collaboratorId, isActive: true,
          user: { id: `user-${collaboratorId}`, isActive: true, accountType: 'INTERNAL', role: 'COLLABORATOR', moduleRoles: [{ role: 'RDO_COLLABORATOR' }] } }
      }))
    }
  };
  const database = {
    $transaction: async callback => {
      const before = structuredClone(state);
      try { return await callback(database); } catch (error) { Object.assign(state, before); throw error; }
    },
    efetivoPlan: { findUnique: async () => state.plan, update: async () => state.plan },
    projectWorkflow: { findUnique: async () => null },
    project: { update: async ({ data }) => { Object.assign(state.project, data); } },
    projectAuthorizedUser: { createMany: async ({ data }) => state.users.push(...data) },
    notificationEvent: { upsert: async ({ create }) => { state.notifications.push(create); } },
    efetivoMissionPlan: {
      findUnique: async () => ({ ...state.mission, project: state.project }),
      findMany: async () => [],
      update: async ({ data }) => {
        if (typeof data.version === 'object') state.mission.version += 1;
        if (data.stage) state.mission.stage = data.stage;
        return { ...state.mission, project: state.project };
      }
    },
    efetivoAuditEvent: { create: async ({ data }) => state.audits.push(data) }
  };
  return { database, state };
}

test('missão antiga também confirma operador e início real e libera a equipe para relatórios', async () => {
  const { database, state } = legacyExecutionDatabase();
  const input = stageInputSchema.parse({ stage: 'EXECUTION', order: 0, startDate: '2026-09-12', operatorId: 'ana' });
  await moveMissionStage('mission-1', input, { version: 1 }, { database, now: new Date('2026-09-14T12:00:00Z') });
  assert.equal(state.project.operatorId, 'ana');
  assert.equal(state.project.startDate.toISOString(), '2026-09-12T00:00:00.000Z');
  assert.deepEqual(state.users.map(link => link.userId), ['user-ana', 'user-carlos']);
  assert.equal(state.mission.stage, 'EXECUTION');
  assert.equal(state.audits[0].afterData.operatorId, 'ana');
  assert.equal(state.notifications.length, 0);
  // Reordenar na mesma etapa não redefine o responsável nem repete a liberação.
  await moveMissionStage('mission-1', { stage: 'EXECUTION', order: 0 }, { version: 2 }, { database });
  assert.equal(state.users.length, 2);
});

test('missão antiga rejeita execução sem responsável ou data válida e preserva o estado', async () => {
  for (const [overrides, code] of [
    [{ startDate: undefined }, 'PROJECT_WORKFLOW_EXECUTION_START_REQUIRED'],
    [{ startDate: '2026-09-09' }, 'INVALID_PROJECT_WORKFLOW_EXECUTION_START'],
    [{ startDate: '2026-09-15' }, 'INVALID_PROJECT_WORKFLOW_EXECUTION_START'],
    [{ operatorId: undefined }, 'PROJECT_WORKFLOW_REPORT_OPERATOR_REQUIRED'],
    [{ operatorId: 'outsider' }, 'INVALID_PROJECT_WORKFLOW_REPORT_OPERATOR']
  ]) {
    const { database, state } = legacyExecutionDatabase();
    await assert.rejects(moveMissionStage('mission-1', { stage: 'EXECUTION', order: 0, startDate: '2026-09-12', operatorId: 'ana', ...overrides },
      { version: 1 }, { database, now: new Date('2026-09-14T12:00:00Z') }), error => error.code === code);
    assert.equal(state.mission.stage, 'MOBILIZATION');
    assert.equal(state.users.length, 0);
    assert.equal(state.project.operatorId, undefined);
  }
});

test('mover cenário para execução não altera operador ou acessos do projeto oficial', async () => {
  const { database, state } = legacyExecutionDatabase('SCENARIO');
  await moveMissionStage('mission-1', { stage: 'EXECUTION', order: 0 }, { version: 1 }, { database });
  assert.equal(state.project.operatorId, undefined);
  assert.equal(state.users.length, 0);
  assert.equal(state.project.startDate, undefined);
  assert.equal(state.notifications.length, 0);
});

test('missão antiga sem contas habilitadas inicia sem operador e registra aviso transacional', async () => {
  const { database, state } = legacyExecutionDatabase();
  for (const allocation of state.mission.allocations) allocation.collaborator.user = null;
  state.project.operatorId = 'old-operator';
  await moveMissionStage('mission-1', { stage: 'EXECUTION', order: 0, startDate: '2026-09-12' },
    { version: 1 }, { database, now: new Date('2026-09-14T12:00:00Z') });
  assert.equal(state.mission.stage, 'EXECUTION');
  assert.equal(state.project.operatorId, null);
  assert.equal(state.notifications[0].kind, 'EXECUTION_WITHOUT_REPORT_OPERATOR');
  assert.equal(state.notifications[0].projectId, 'project-1');
  assert.equal(state.users.length, 0);
  await moveMissionStage('mission-1', { stage: 'EXECUTION', order: 0 }, { version: 2 }, { database });
  assert.equal(state.notifications.length, 1);
});
