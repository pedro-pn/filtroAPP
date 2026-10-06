import assert from 'node:assert/strict';
import test from 'node:test';

import { initializeAllocationCycles, updateAllocationCycle, updateMissionCycle } from '../src/lib/efetivo/planning/cycles.js';
import { allocationCoversDate } from '../src/lib/efetivo/planning/allocation-period.js';

function fixture({ stage = 'EXECUTION', inherited = false, closed = false } = {}) {
  const person = { id: 'c1', name: 'Ana', jobRoleId: 'role', isActive: true };
  const general = { id: 'general', isDefault: true, mobilizationDate: '2026-10-10', demobilizationDate: closed ? '2026-10-20' : null };
  const allocation = { id: 'a1', collaboratorId: person.id, collaborator: person, jobRoleId: person.jobRoleId,
    cycles: inherited ? [] : [{ ...general, id: 'own', isDefault: false }] };
  const peer = { id: 'a2', collaboratorId: 'c2', jobRoleId: 'role', cycles: [] };
  const mission = { id: 'mission', planId: 'plan', stage, project: { code: 'P1' },
    plan: { id: 'plan', kind: 'OFFICIAL', status: 'ACTIVE', revision: 1 },
    mobilizationDate: '2026-10-10', executionEndDate: '2026-10-20', cycles: [general], allocations: [allocation, peer] };
  const audits = [];
  const writes = [];
  const absences = [];
  const otherAllocations = [];
  const database = {
    efetivoMissionPlan: { findUnique: async () => mission },
    efetivoPlan: { findUnique: async () => mission.plan, update: async () => mission.plan },
    collaborator: { findUnique: async () => person },
    collaboratorAbsence: { findMany: async () => absences },
    efetivoMissionAllocation: { findMany: async () => otherAllocations },
    efetivoAllocationCycle: {
      create: async ({ data }) => { const cycle = { id: 'own', ...data }; allocation.cycles.push(cycle); writes.push(cycle); return cycle; },
      update: async ({ where, data }) => { const cycle = { ...allocation.cycles.find(cycle => cycle.id === where.id), ...data }; writes.push(cycle); return cycle; }
    },
    efetivoMissionCycle: { update: async ({ data }) => ({ ...general, ...data }) },
    efetivoAuditEvent: { create: async ({ data }) => audits.push(data) }
  };
  return { mission, allocation, person, peer, database, audits, writes, absences, otherAllocations };
}

for (const stage of ['MOBILIZATION', 'EXECUTION']) {
  for (const closed of [false, true]) {
    test(`ciclo 1 individual ${closed ? 'encerrado' : 'aberto'} pode começar antes ou depois do geral em ${stage}`, async () => {
      for (const date of ['2026-10-09', '2026-10-11']) {
        const { mission, allocation, peer, database, audits, writes } = fixture({ stage, closed });
        const original = structuredClone(mission);
        const updated = await updateAllocationCycle('mission', 'a1', 'own', {
          mobilizationDate: date, demobilizationDate: closed ? '2026-10-21' : null
        }, { actorUserId: 'manager' }, { database });
        assert.equal(updated.id, 'own');
        assert.equal(updated.mobilizationDate.toISOString().slice(0, 10), date);
        assert.equal(updated.demobilizationDate?.toISOString().slice(0, 10) || null, closed ? '2026-10-21' : null);
        assert.equal(writes.length, 1);
        assert.equal(audits[0].action, 'ALLOCATION_CYCLE_UPDATE');
        assert.deepEqual(mission, original, 'o ciclo geral e os demais colaboradores devem permanecer intactos');
        assert.equal(allocationCoversDate({ ...allocation, cycles: [updated] }, mission, date), true);
        assert.equal(allocationCoversDate(peer, mission, '2026-10-09'), false);
      }
    });
  }
}

test('personalizar na mobilização copia o ciclo existente sem encerrar ou criar remobilização', async () => {
  const { mission, allocation, database } = fixture({ stage: 'MOBILIZATION', inherited: true });
  const general = structuredClone(mission.cycles);
  const cycles = await initializeAllocationCycles('mission', 'a1', {}, { database });
  assert.equal(cycles.length, 1);
  assert.equal(cycles[0].demobilizationDate, null);
  assert.deepEqual(mission.cycles, general);
  assert.equal(allocation.cycles.length, 1);
});

test('alterar a saída geral preserva datas individuais fora do ciclo geral', async () => {
  const { mission, allocation, database } = fixture({ closed: true });
  allocation.cycles[0].mobilizationDate = '2026-10-09';
  const before = structuredClone(allocation.cycles);
  await updateMissionCycle('mission', 'general', { mobilizationDate: '2026-10-10', demobilizationDate: '2026-10-19' }, {}, { database });
  assert.deepEqual(allocation.cycles, before);
  assert.equal(mission.cycles.length, 1);
});

for (const reason of ['ordem', 'sobreposição de ciclos', 'ausência', 'admissão', 'outra missão', 'cenário']) {
  test(`edição individual mantém a validação de ${reason}`, async () => {
    const { mission, allocation, person, database, writes, absences, otherAllocations } = fixture();
    const payload = { mobilizationDate: '2026-10-09', demobilizationDate: null };
    if (reason === 'ordem') payload.demobilizationDate = '2026-10-08';
    if (reason === 'sobreposição de ciclos') allocation.cycles.push({ id: 'second', mobilizationDate: '2026-10-15', demobilizationDate: null });
    if (reason === 'ausência') absences.push({ id: 'absence', type: 'FERIAS', startDate: '2026-10-09', endDate: '2026-10-09' });
    if (reason === 'admissão') person.admissionDate = '2026-10-10';
    if (reason === 'outra missão') otherAllocations.push({ id: 'other-allocation', mission: { id: 'other', scheduleStatus: 'CONFIRMED', mobilizationDate: '2026-10-09', executionEndDate: '2026-10-09' } });
    if (reason === 'cenário') mission.plan = { ...mission.plan, kind: 'SCENARIO', status: 'DRAFT' };
    const expected = { ordem: 'CYCLE_OUTSIDE_MISSION_PERIOD', 'sobreposição de ciclos': 'OPEN_MOBILIZATION_CYCLE', ausência: 'ABSENCE_FERIAS', admissão: 'OUTSIDE_EMPLOYMENT', 'outra missão': 'MISSION_OVERLAP', cenário: 'CYCLE_OUTSIDE_MISSION_PERIOD' }[reason];
    await assert.rejects(updateAllocationCycle('mission', 'a1', 'own', payload, {}, { database }),
      error => error.code === expected || error.conflicts?.some(conflict => conflict.code === expected));
    assert.equal(writes.length, 0);
  });
}
