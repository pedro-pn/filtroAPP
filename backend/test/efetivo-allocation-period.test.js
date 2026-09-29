import assert from 'node:assert/strict';
import test from 'node:test';

import {
  allocationCoversDate,
  allocationPeriod,
  allocationPeriods,
  allocationPeriodWithinMission,
  maximumConcurrentAllocationCount
} from '../src/lib/efetivo/planning/allocation-period.js';
import { allocateCollaboratorInTransaction } from '../src/lib/efetivo/planning/allocations.js';

const mission = {
  mobilizationDate: '2026-09-01',
  executionEndDate: '2026-09-29',
  returnDate: '2026-09-30'
};

test('período individual herda as datas globais da missão quando não foi personalizado', () => {
  assert.deepEqual(allocationPeriod({}, mission), {
    startDate: '2026-09-01',
    endDate: '2026-09-30'
  });
});

test('mobilização e desmobilização individuais limitam os dias da alocação', () => {
  const allocation = { mobilizationDate: '2026-09-05', demobilizationDate: '2026-09-20' };
  assert.deepEqual(allocationPeriod(allocation, mission), {
    startDate: '2026-09-05',
    endDate: '2026-09-20'
  });
  assert.equal(allocationCoversDate(allocation, mission, '2026-09-04'), false);
  assert.equal(allocationCoversDate(allocation, mission, '2026-09-05'), true);
  assert.equal(allocationCoversDate(allocation, mission, '2026-09-20'), true);
  assert.equal(allocationCoversDate(allocation, mission, '2026-09-21'), false);
});

test('ciclos repetidos preservam a pausa e o colaborador herda os ciclos do projeto', () => {
  const missionWithPause = {
    ...mission,
    cycles: [
      { id: 'mc1', mobilizationDate: '2026-09-01', demobilizationDate: '2026-09-10' },
      { id: 'mc2', mobilizationDate: '2026-09-20', demobilizationDate: '2026-09-30' }
    ]
  };
  assert.deepEqual(allocationPeriods({}, missionWithPause).map(({ startDate, endDate }) => ({ startDate, endDate })), [
    { startDate: '2026-09-01', endDate: '2026-09-10' },
    { startDate: '2026-09-20', endDate: '2026-09-30' }
  ]);
  assert.equal(allocationCoversDate({}, missionWithPause, '2026-09-15'), false);
  assert.equal(allocationCoversDate({}, missionWithPause, '2026-09-20'), true);
});

test('ciclos individuais substituem a herança geral sem preencher as pausas', () => {
  const allocation = {
    cycles: [
      { id: 'ac1', mobilizationDate: '2026-09-03', demobilizationDate: '2026-09-07' },
      { id: 'ac2', mobilizationDate: '2026-09-22', demobilizationDate: null }
    ]
  };
  assert.equal(allocationCoversDate(allocation, mission, '2026-09-08'), false);
  assert.equal(allocationCoversDate(allocation, mission, '2026-09-29'), true);
});

test('período individual precisa ficar dentro das datas da missão', () => {
  assert.equal(allocationPeriodWithinMission({ startDate: '2026-09-05', endDate: '2026-09-20' }, mission), true);
  assert.equal(allocationPeriodWithinMission({ startDate: '2026-08-31', endDate: '2026-09-20' }, mission), false);
  assert.equal(allocationPeriodWithinMission({ startDate: '2026-09-05', endDate: '2026-10-01' }, mission), false);
});

test('substituições sem sobreposição ocupam uma única vaga da demanda', () => {
  assert.equal(maximumConcurrentAllocationCount([
    { startDate: '2026-09-01', endDate: '2026-09-10' },
    { startDate: '2026-09-11', endDate: '2026-09-30' }
  ]), 1);
  assert.equal(maximumConcurrentAllocationCount([
    { startDate: '2026-09-01', endDate: '2026-09-10' },
    { startDate: '2026-09-10', endDate: '2026-09-30' }
  ]), 2);
});

test('datas iguais às da missão ficam herdadas e somente diferenças são persistidas', async () => {
  const saved = [];
  const tx = {
    $queryRawUnsafe: async () => undefined,
    collaborator: { findUnique: async () => ({ id: 'c1', name: 'Ana', jobRoleId: 'r1', admissionDate: '2020-01-01', isActive: true }) },
    collaboratorAbsence: { findMany: async () => [] },
    efetivoMissionAllocation: {
      findMany: async () => [],
      upsert: async input => {
        saved.push(input.create);
        return { id: `a${saved.length}`, ...input.create };
      }
    }
  };
  const missionInput = () => ({
    ...mission,
    id: 'm1',
    planId: 'p1',
    demands: [{ jobRoleId: 'r1', requiredCount: 1, jobRole: { name: 'Operador' } }],
    allocations: []
  });

  await allocateCollaboratorInTransaction(tx, missionInput(), {
    collaboratorId: 'c1', jobRoleId: 'r1', mobilizationDate: '2026-09-01', demobilizationDate: '2026-09-30'
  });
  await allocateCollaboratorInTransaction(tx, missionInput(), {
    collaboratorId: 'c1', jobRoleId: 'r1', mobilizationDate: '2026-09-05', demobilizationDate: '2026-09-20'
  });

  assert.equal(saved[0].mobilizationDate, null);
  assert.equal(saved[0].demobilizationDate, null);
  assert.equal(saved[1].mobilizationDate.toISOString().slice(0, 10), '2026-09-05');
  assert.equal(saved[1].demobilizationDate.toISOString().slice(0, 10), '2026-09-20');
});

test('substituto entra na data informada sem apagar a mobilização anterior', async () => {
  const saved = [];
  const createdCycles = [];
  const tx = {
    $queryRawUnsafe: async () => undefined,
    collaborator: { findUnique: async () => ({ id: 'c2', name: 'Bruno', jobRoleId: 'r1', admissionDate: '2026-09-01', isActive: true }) },
    collaboratorAbsence: { findMany: async () => [] },
    efetivoMissionAllocation: {
      findMany: async () => [],
      upsert: async input => {
        saved.push(input.create);
        return { id: 'a2', ...input.create };
      }
    },
    efetivoAllocationCycle: {
      findFirst: async () => null,
      create: async input => { createdCycles.push(input.data); }
    }
  };
  const priorAllocation = {
    id: 'a1', collaboratorId: 'c1', jobRoleId: 'r1', deletedAt: null,
    cycles: [{ id: 'cycle-1', mobilizationDate: '2026-09-01', demobilizationDate: '2026-09-10' }]
  };
  const missionInput = () => ({
    ...mission, id: 'm1', planId: 'p1',
    demands: [{ jobRoleId: 'r1', requiredCount: 1, jobRole: { name: 'Operador' } }],
    allocations: [priorAllocation]
  });

  const updatedMission = missionInput();
  await allocateCollaboratorInTransaction(tx, updatedMission, {
    collaboratorId: 'c2', jobRoleId: 'r1', mobilizationDate: '2026-09-11'
  });

  assert.equal(saved[0].mobilizationDate.toISOString().slice(0, 10), '2026-09-11');
  assert.equal(saved[0].demobilizationDate, null);
  assert.equal(createdCycles[0].mobilizationDate.toISOString().slice(0, 10), '2026-09-11');
  assert.equal(createdCycles[0].demobilizationDate.toISOString().slice(0, 10), '2026-09-30');
  assert.equal(updatedMission.allocations[0], priorAllocation);
  assert.equal(updatedMission.allocations.length, 2);
  await assert.doesNotReject(allocateCollaboratorInTransaction(tx, missionInput(), {
    collaboratorId: 'c2', jobRoleId: 'r1', mobilizationDate: '2026-09-10'
  }), 'a inclusão manual pode exceder a quantidade inicialmente prevista');
  await assert.rejects(allocateCollaboratorInTransaction(tx, missionInput(), {
    collaboratorId: 'c2', jobRoleId: 'r1', mobilizationDate: '2026-09-10'
  }, {}, 'AUTOMATIC'), error => error.code === 'DEMAND_FULL');
});

test('inclusão manual aceita cargo fora do planejamento e registra sua função', async () => {
  const saved = [];
  const tx = {
    $queryRawUnsafe: async () => undefined,
    jobRole: { findUnique: async () => ({ name: 'Técnico de segurança', isActive: true, isOperational: true }) },
    collaborator: { findUnique: async () => ({ id: 'c3', name: 'Carla', jobRoleId: 'r2', admissionDate: '2026-09-01', isActive: true }) },
    collaboratorAbsence: { findMany: async () => [] },
    efetivoMissionAllocation: {
      findMany: async () => [],
      upsert: async input => { saved.push(input.create); return { id: 'a3', ...input.create }; }
    }
  };
  const missionInput = {
    ...mission, id: 'm1', planId: 'p1',
    demands: [{ jobRoleId: 'r1', requiredCount: 1, jobRole: { name: 'Operador' } }],
    allocations: []
  };

  await allocateCollaboratorInTransaction(tx, missionInput, {
    collaboratorId: 'c3', jobRoleId: 'r2', mobilizationDate: '2026-09-15'
  });

  assert.equal(saved[0].jobRoleId, 'r2');
  assert.equal(saved[0].jobRoleNameSnapshot, 'Técnico de segurança');
  assert.equal(missionInput.demands.length, 1, 'o cargo excepcional não altera a previsão original');
  await assert.rejects(allocateCollaboratorInTransaction({
    ...tx,
    jobRole: { findUnique: async () => ({ name: 'Cargo administrativo', isActive: true, isOperational: false }) }
  }, { ...missionInput, allocations: [] }, {
    collaboratorId: 'c3', jobRoleId: 'r2', mobilizationDate: '2026-09-15'
  }), error => error.code === 'INVALID_COLLABORATOR_JOB_ROLE');
});
