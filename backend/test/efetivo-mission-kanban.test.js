import assert from 'node:assert/strict';
import test from 'node:test';

import { missionStageSchema, stageInputSchema } from '../src/lib/efetivo/planning/schemas.js';
import { moveMissionStage } from '../src/lib/efetivo/planning/mission-planning.js';

test('kanban aceita exatamente cinco etapas e ordem não negativa', () => {
  for (const stage of ['STANDBY', 'MOBILIZATION', 'EXECUTION', 'FINAL_MEASUREMENT', 'FINISHED']) assert.equal(missionStageSchema.parse(stage), stage);
  assert.equal(stageInputSchema.safeParse({ stage: 'EXECUTION', order: -1 }).success, false);
});

test('API bloqueia movimentação enquanto a programação estiver incompleta', async () => {
  const plan = { id: 'plan-1', kind: 'OFFICIAL', status: 'ACTIVE' };
  const database = {
    efetivoPlan: { findUnique: async () => plan },
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

test('concluir missão aceita desmobilização opcional e sincroniza o projeto', async () => {
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
    project: { update: async input => { projectUpdate = input; } },
    efetivoAuditEvent: { create: async () => ({ id: 'audit-1' }) }
  };
  const moved = await moveMissionStage('mission-1', {
    stage: 'FINISHED', order: 0, returnDate: '2026-08-12'
  }, { version: 1 }, { database });
  assert.equal(projectUpdate.data.demobilizationDate.toISOString(), '2026-08-12T00:00:00.000Z');
  assert.ok(missionUpdates.some(input => input.data.returnDate?.toISOString() === '2026-08-12T00:00:00.000Z'));
  assert.equal(moved.returnDate.toISOString(), '2026-08-12T00:00:00.000Z');
});
