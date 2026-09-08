import assert from 'node:assert/strict';
import test from 'node:test';

import {
  availabilityPeriodsOverlap,
  checkWorkforceAvailability,
  createWorkforceAbsence,
  markMissionsAffectedByAbsence,
  updateWorkforceAbsence
} from '../src/lib/collaborators/availability-service.js';

test('sobreposição é inclusiva e nova alocação permanece bloqueada', async () => {
  assert.equal(availabilityPeriodsOverlap(
    { startDate: '2026-08-10', endDate: '2026-08-12' },
    { startDate: '2026-08-12', endDate: '2026-08-15' }
  ), true);
  const database = {
    collaboratorAbsence: { findMany: async () => [{ id: 'a1', collaboratorId: 'c1', startDate: '2026-08-10', endDate: '2026-08-12' }] },
    efetivoMissionAllocation: { findMany: async () => [] },
    workforceHoliday: { findMany: async () => [] },
    workforceCalendarState: { findUnique: async () => ({ revision: 4 }) }
  };
  const result = await checkWorkforceAvailability(database, {
    collaboratorIds: ['c1'], startDate: '2026-08-12', endDate: '2026-08-12', context: 'PLANNING'
  });
  assert.equal(result.conflicts[0].policy, 'BLOCK');
});

test('ausência superveniente é salva e marca missão para replanejamento', async () => {
  const calls = [];
  const tx = {
    collaborator: { findUnique: async () => ({ id: 'c1' }) },
    collaboratorAbsence: {
      findFirst: async () => null,
      create: async input => ({ id: 'a1', version: 1, ...input.data })
    },
    efetivoMissionAllocation: { findMany: async () => [{
      missionId: 'm1',
      mobilizationDate: '2026-08-01',
      demobilizationDate: '2026-08-20',
      mission: { mobilizationDate: '2026-08-01', executionEndDate: '2026-08-30', returnDate: '2026-08-31' }
    }] },
    efetivoMissionPlan: { updateMany: async input => { calls.push(input); } },
    workforceCalendarState: {
      upsert: async () => ({ id: 'global', revision: 1 }),
      update: async () => ({ id: 'global', revision: 2 })
    }
  };
  const database = { ...tx, $transaction: callback => callback(tx) };
  const result = await createWorkforceAbsence(database, {
    collaboratorId: 'c1', type: 'FERIAS', startDate: '2026-08-10', endDate: '2026-08-12'
  }, { actorUserId: 'u1' });
  assert.deepEqual(result.affectedMissionIds, ['m1']);
  assert.equal(calls[0].data.needsReplanning, true);
});

test('ausência após a desmobilização individual não reabre pendência na missão', async () => {
  let updated = false;
  const database = {
    efetivoMissionAllocation: { findMany: async () => [{
      missionId: 'm1',
      mobilizationDate: '2026-08-01',
      demobilizationDate: '2026-08-09',
      mission: { mobilizationDate: '2026-08-01', executionEndDate: '2026-08-30', returnDate: '2026-08-31' }
    }] },
    efetivoMissionPlan: { updateMany: async () => { updated = true; } }
  };
  const affected = await markMissionsAffectedByAbsence(database, 'c1', {
    startDate: '2026-08-10',
    endDate: '2026-08-12'
  });
  assert.deepEqual(affected, []);
  assert.equal(updated, false);
});

test('versão divergente impede atualização concorrente', async () => {
  const tx = { collaboratorAbsence: { findUnique: async () => ({ id: 'a1', version: 2, deletedAt: null }) } };
  await assert.rejects(
    updateWorkforceAbsence({ $transaction: callback => callback(tx) }, 'a1', {}, { expectedVersion: 1 }),
    error => error.code === 'VERSION_CONFLICT' && error.statusCode === 409
  );
});
