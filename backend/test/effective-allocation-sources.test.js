import assert from 'node:assert/strict';
import test from 'node:test';
import { loadOfficialAllocationSources, officialMissionWhere } from '../src/lib/acompanhamento/effective-allocation-sources.js';
import { buildEffectiveAllocationIndex, buildScheduleWindows } from '../src/lib/acompanhamento/labor-cost.js';

test('empty allocations avoid child reads while confirmed missions still disable legacy windows', async () => {
  for (const missions of [[], [{ id: 'm1', projectId: 'p1', planId: 'plan' }]]) {
    const database = {
      efetivoMissionAllocation: { findMany: async query => { assert.deepEqual(query.where, { deletedAt: null, mission: officialMissionWhere }); return []; } },
      efetivoMissionPlan: { findMany: async query => { assert.deepEqual(query.where, officialMissionWhere); return missions; } }
    };
    const sources = await loadOfficialAllocationSources(database);
    assert.deepEqual(sources.allocations, []);
    const windows = buildScheduleWindows([{ id: 'p1', mobilizationDate: '2026-09-01', demobilizationDate: '2026-09-30' }], sources.missionProjectIds);
    assert.equal(windows.length, missions.length ? 0 : 1);
  }
});

test('batched actual plan state and cycles retain individual precedence, pauses, open ends and source order', async () => {
  const allocations = [{ id: 'a1', missionId: 'm1', collaboratorId: 'c1' }, { id: 'a2', missionId: 'm1', collaboratorId: 'c2' }];
  const missions = [{ id: 'm1', planId: 'plan', projectId: 'p1', scheduleStatus: 'CONFIRMED',
    mobilizationDate: '2026-09-01', executionEndDate: '2026-09-30', returnDate: null }];
  const individual = [{ id: 'i2', allocationId: 'a1', mobilizationDate: '2026-09-20', demobilizationDate: null },
    { id: 'i1', allocationId: 'a1', mobilizationDate: '2026-09-02', demobilizationDate: '2026-09-04' }];
  const general = [{ id: 'g1', missionId: 'm1', mobilizationDate: '2026-09-01', demobilizationDate: '2026-09-10' }];
  const before = structuredClone({ allocations, missions, individual, general });
  let active = true, missingPlan = false;
  const database = {
    efetivoMissionAllocation: { findMany: async () => allocations }, efetivoMissionPlan: { findMany: async () => missions },
    efetivoAllocationCycle: { findMany: async query => { assert.deepEqual(query.where.allocationId.in, ['a1', 'a2']); return individual; } },
    efetivoMissionCycle: { findMany: async query => { assert.deepEqual(query.where.missionId.in, ['m1']); return general; } },
    efetivoPlan: { findMany: async query => { assert.deepEqual(query.where.id.in, ['plan']); return missingPlan ? [] : [{ id: 'plan', kind: 'OFFICIAL', status: active ? 'ACTIVE' : 'SUPERSEDED' }]; } }
  };
  const sources = await loadOfficialAllocationSources(database);
  assert.deepEqual({ allocations, missions, individual, general }, before);
  assert.deepEqual(sources.allocations[0].cycles.map(row => row.id), ['i2', 'i1']);
  const index = buildEffectiveAllocationIndex(sources.allocations);
  assert.deepEqual(index.get('c1').windows.map(row => [row.cycleId, row.startKey, row.endKey]),
    [['i1', '2026-09-02', '2026-09-04'], ['i2', '2026-09-20', '2026-09-30']]);
  assert.deepEqual(index.get('c2').windows.map(row => [row.cycleId, row.startKey, row.endKey]), [['g1', '2026-09-01', '2026-09-10']]);
  active = false;
  assert.equal(buildEffectiveAllocationIndex((await loadOfficialAllocationSources(database)).allocations).size, 0,
    'Read the real plan state rather than manufacturing an ACTIVE plan from the parent predicate');
  missingPlan = true;
  assert.equal(buildEffectiveAllocationIndex((await loadOfficialAllocationSources(database)).allocations).size, 0,
    'A plan removed between reads cannot create a window with unknown eligibility');
});

test('failed cycle reads reject the complete context and a later request retries', async () => {
  let failed = true;
  const database = {
    efetivoMissionAllocation: { findMany: async () => [{ id: 'a1', collaboratorId: 'c1', missionId: 'm1' }] },
    efetivoMissionPlan: { findMany: async () => [] },
    efetivoAllocationCycle: { findMany: async () => { if (failed) throw new Error('cycle read failed'); return []; } }
  };
  await assert.rejects(loadOfficialAllocationSources(database), /cycle read failed/);
  failed = false;
  const sources = await loadOfficialAllocationSources(database);
  assert.equal(buildEffectiveAllocationIndex(sources.allocations).size, 0, 'Missing missions cannot create allocation windows');
});
