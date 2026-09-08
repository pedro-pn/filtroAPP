import assert from 'node:assert/strict';
import test from 'node:test';

import { createMission } from '../src/lib/efetivo/planning/mission-planning.js';

const payload = {
  planId: 'plan-1',
  projectId: 'project-1',
  scheduleStatus: 'DRAFT',
  headquartersResponsibleUserId: 'user-1',
  mobilizationDate: '2026-09-01',
  executionStartDate: '2026-09-02',
  executionEndDate: '2026-09-09',
  returnDate: '2026-09-10',
  demands: []
};

function fakeDatabase() {
  const plan = { id: 'plan-1', kind: 'SCENARIO', status: 'DRAFT', revision: 4 };
  const project = { id: 'project-1', name: 'Projeto restaurado' };
  const deletedMission = {
    id: 'mission-1',
    planId: plan.id,
    projectId: project.id,
    version: 3,
    deletedAt: new Date('2026-08-20T12:00:00.000Z')
  };
  const calls = {
    create: 0,
    demandDelete: null,
    allocationDelete: null,
    update: null,
    audit: null,
    revision: null
  };
  const database = {
    efetivoPlan: {
      findUnique: async () => plan,
      update: async args => { calls.revision = args; return plan; }
    },
    project: { findFirst: async () => project },
    user: {
      findFirst: async () => ({
        id: 'user-1',
        name: 'Coordenação',
        collaborator: { id: 'collaborator-1', name: 'Ana Líder', isActive: true, jobRole: { name: 'Coordenadora' } }
      })
    },
    jobRole: { findMany: async () => [] },
    efetivoMissionPlan: {
      findUnique: async args => args.where.planId_projectId ? deletedMission : null,
      aggregate: async () => ({ _max: { kanbanOrder: 2 } }),
      create: async () => {
        calls.create += 1;
        const error = new Error('Unique constraint');
        error.code = 'P2002';
        throw error;
      },
      update: async args => {
        calls.update = args;
        return {
          ...deletedMission,
          ...args.data,
          deletedAt: null,
          project,
          demands: [],
          allocations: []
        };
      }
    },
    efetivoMissionDemand: {
      deleteMany: async args => { calls.demandDelete = args; return { count: 1 }; }
    },
    efetivoMissionAllocation: {
      updateMany: async args => { calls.allocationDelete = args; return { count: 1 }; }
    },
    efetivoAuditEvent: {
      create: async args => { calls.audit = args; return args.data; }
    }
  };
  return { calls, database };
}

test('reprogramar projeto restaura a missão excluída sem violar unicidade', async () => {
  const { calls, database } = fakeDatabase();
  const restored = await createMission(payload, { actorUserId: 'actor-1' }, { database });

  assert.equal(restored.id, 'mission-1');
  assert.equal(calls.create, 0);
  assert.deepEqual(calls.demandDelete.where, { missionId: 'mission-1' });
  assert.deepEqual(calls.allocationDelete.where, { missionId: 'mission-1', deletedAt: null });
  assert.ok(calls.allocationDelete.data.deletedAt instanceof Date);
  assert.equal(calls.update.data.deletedAt, null);
  assert.equal(calls.update.data.stage, 'STANDBY');
  assert.deepEqual(calls.update.data.version, { increment: 1 });
  assert.equal(calls.update.data.kanbanOrder, 3);
  assert.equal(calls.audit.data.action, 'MISSION_RESTORE');
  assert.equal(calls.audit.data.entityId, 'mission-1');
  assert.deepEqual(calls.revision.data, { revision: { increment: 1 } });
});
