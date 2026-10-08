import assert from 'node:assert/strict';
import test from 'node:test';

import { updateMission } from '../src/lib/efetivo/planning/mission-planning.js';
import { missionInputSchema, missionUpdateInputSchema } from '../src/lib/efetivo/planning/schemas.js';

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
    cycles: missionCycles || [{ id: 'legacy-cycle', isDefault: true, mobilizationDate: '2026-07-06', demobilizationDate: null }],
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
      updateMany: async ({ where }) => {
        mission.allocations = mission.allocations.filter(allocation => where.collaboratorId?.notIn.includes(allocation.collaboratorId));
      },
      upsert: async ({ where, update }) => Object.assign(mission.allocations.find(allocation =>
        allocation.collaboratorId === where.missionId_collaboratorId.collaboratorId), update)
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
  assert.equal(result.cycles[0].demobilizationDate, null);
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

test('reprogramar Standby sincroniza também o ciclo padrão com desmobilização prevista preenchida', async () => {
  const { mission, database, payload } = fixture({ missionCycles: [{
    id: 'default', isDefault: true, mobilizationDate: '2026-07-06', demobilizationDate: '2026-08-20'
  }] });
  mission.stage = 'STANDBY';
  const result = await updateMission(mission.id, {
    ...payload, mobilizationDate: '2026-07-22', executionStartDate: '2026-07-22', returnDate: '2026-08-20',
    allocationPeriods: [{ collaboratorId: 'person', mobilizationDate: '2026-07-22', demobilizationDate: '2026-08-20' }]
  }, {}, { database });
  assert.equal(result.cycles[0].mobilizationDate.toISOString().slice(0, 10), '2026-07-22');
  assert.equal(result.cycles[0].demobilizationDate.toISOString().slice(0, 10), '2026-08-20');
  assert.equal(result.allocations[0].mobilizationDate, null);
  assert.equal(result.allocations[0].demobilizationDate, null);
});

test('remover pessoa da equipe em Standby recupera o ciclo padrão desatualizado do projeto 5841', async () => {
  const { mission, database, payload } = fixture({ missionCycles: [{
    id: 'default', isDefault: true, mobilizationDate: '2026-09-25', demobilizationDate: '2026-12-01'
  }] });
  const dates = {
    mobilizationDate: '2026-10-22', executionStartDate: '2026-10-22', executionEndDate: '2026-11-30', returnDate: '2026-12-01'
  };
  Object.assign(mission, dates, { stage: 'STANDBY' });
  mission.allocations.push({ ...mission.allocations[0], id: 'removed-allocation', collaboratorId: 'removed-person' });
  const input = missionInputSchema.parse({
    ...payload, ...dates,
    allocationPeriods: [{ collaboratorId: 'person', mobilizationDate: dates.mobilizationDate, demobilizationDate: dates.returnDate }]
  });
  const result = await updateMission(mission.id, input, {}, { database });
  assert.deepEqual(result.allocations.map(allocation => allocation.collaboratorId), ['person']);
  assert.equal(result.cycles[0].mobilizationDate.toISOString().slice(0, 10), dates.mobilizationDate);
  assert.equal(result.cycles[0].demobilizationDate.toISOString().slice(0, 10), dates.returnDate);
  assert.equal(result.allocations[0].mobilizationDate, null);
});

test('reprogramação em Standby continua rejeitando ciclos individuais fora das novas datas', async () => {
  const { mission, database, payload, writes } = fixture({
    missionCycles: [{ id: 'default', isDefault: true, mobilizationDate: '2026-07-06', demobilizationDate: '2026-08-20' }],
    individualCycles: [{ id: 'individual', mobilizationDate: '2026-07-06', demobilizationDate: '2026-07-20' }]
  });
  mission.stage = 'STANDBY';
  await assert.rejects(updateMission(mission.id, {
    ...payload, mobilizationDate: '2026-07-22', executionStartDate: '2026-07-22'
  }, {}, { database }), error => error.code === 'ALLOCATION_OUTSIDE_MISSION_PERIOD');
  assert.equal(writes.length, 0);
  assert.equal(mission.cycles[0].mobilizationDate, '2026-07-06');
});

test('salvar equipe preserva o ciclo padrão quando a mobilização efetiva já foi confirmada', async () => {
  const { mission, database, payload } = fixture({ missionCycles: [{
    id: 'default', isDefault: true, mobilizationDate: '2026-07-06', demobilizationDate: '2026-08-20'
  }] });
  mission.stage = 'STANDBY';
  mission.project.workflow = { actualMobilizationDate: '2026-07-06' };
  await updateMission(mission.id, payload, {}, { database });
  assert.equal(mission.cycles[0].mobilizationDate, '2026-07-06');
  assert.equal(mission.cycles[0].demobilizationDate, '2026-08-20');
});

test('salvar equipe em Standby preserva encerramento manual diferente do fim previsto', async () => {
  const { mission, database, payload } = fixture({ missionCycles: [{
    id: 'default', isDefault: true, mobilizationDate: '2026-07-06', demobilizationDate: '2026-07-20'
  }] });
  mission.stage = 'STANDBY';
  await updateMission(mission.id, payload, {}, { database });
  assert.equal(mission.cycles[0].mobilizationDate, '2026-07-06');
  assert.equal(mission.cycles[0].demobilizationDate, '2026-07-20');
});

for (const confirmedMobilization of [false, true]) {
  test(`remover integrante da equipe inicial preserva ciclo anterior à previsão (${confirmedMobilization ? 'mobilização confirmada' : 'encerramento manual'})`, async () => {
    const cycle = {
      id: 'default', isDefault: true, mobilizationDate: '2026-09-25',
      demobilizationDate: confirmedMobilization ? '2026-12-01' : '2026-11-15'
    };
    const { mission, database, payload } = fixture({ missionCycles: [cycle] });
    const dates = {
      mobilizationDate: '2026-10-22', executionStartDate: '2026-10-22',
      executionEndDate: '2026-11-30', returnDate: '2026-12-01'
    };
    Object.assign(mission, dates, { stage: 'STANDBY' });
    if (confirmedMobilization) mission.project.workflow = { actualMobilizationDate: cycle.mobilizationDate };
    mission.allocations.push({ ...mission.allocations[0], id: 'messias-allocation', collaboratorId: 'messias' });

    const input = missionUpdateInputSchema.parse({
      ...payload, ...dates,
      allocationPeriods: [{
        collaboratorId: 'person', mobilizationDate: cycle.mobilizationDate,
        demobilizationDate: cycle.demobilizationDate
      }]
    });
    const result = await updateMission(mission.id, input, {}, { database });
    assert.deepEqual(result.allocations.map(allocation => allocation.collaboratorId), ['person']);
    assert.equal(result.cycles[0].mobilizationDate, '2026-09-25');
    assert.equal(result.cycles[0].demobilizationDate, cycle.demobilizationDate);
    assert.equal(result.allocations[0].mobilizationDate, null);
    assert.equal(result.allocations[0].demobilizationDate, null);
  });
}

test('remover Messias do projeto 5841 preserva os períodos registrados dos quatro integrantes restantes', async () => {
  const { mission, database, payload } = fixture({ missionCycles: [{
    id: 'default', isDefault: true, mobilizationDate: '2026-09-25', demobilizationDate: '2026-12-01'
  }] });
  const dates = {
    mobilizationDate: '2026-10-22', executionStartDate: '2026-10-22',
    executionEndDate: '2026-11-30', returnDate: '2026-12-01'
  };
  Object.assign(mission, dates, { stage: 'STANDBY' });
  const people = [
    'Almir José da Silva', 'Carlos Magno Calandrini da Silva',
    'Daniel Hoch Alves', 'Luan Vitor Silva Santos'
  ].map((name, index) => ({ ...mission.allocations[0].collaborator, id: `person-${index}`, name }));
  const allocations = people.map(person => ({
    ...mission.allocations[0], id: `allocation-${person.id}`, collaboratorId: person.id, collaborator: person,
    cycles: [{ id: `cycle-${person.id}`, mobilizationDate: '2026-09-25', demobilizationDate: '2026-12-01' }]
  }));
  const priorAllocations = structuredClone(allocations);
  mission.allocations = [...allocations, { ...mission.allocations[0], id: 'messias-allocation', collaboratorId: 'messias' }];
  database.collaborator.findMany = async () => people;

  const input = missionUpdateInputSchema.parse({
    ...payload, ...dates, collaboratorIds: people.map(person => person.id),
    allocationPeriods: people.map(person => ({
      collaboratorId: person.id, mobilizationDate: '2026-09-25', demobilizationDate: '2026-12-01'
    }))
  });
  const result = await updateMission(mission.id, input, {}, { database });
  assert.deepEqual(result.allocations.map(allocation => allocation.collaborator.name), people.map(person => person.name));
  result.allocations.forEach((allocation, index) => {
    assert.deepEqual(allocation.cycles, priorAllocations[index].cycles);
    assert.equal(allocation.mobilizationDate, null);
    assert.equal(allocation.demobilizationDate, null);
  });
});

test('editar somente a equipe preserva datas individuais antigas', async () => {
  const { mission, database, payload } = fixture();
  mission.allocations[0].mobilizationDate = '2026-06-30';
  mission.allocations[0].demobilizationDate = '2026-08-20';
  const input = missionUpdateInputSchema.parse({
    ...payload,
    allocationPeriods: [{ collaboratorId: 'person', mobilizationDate: '2026-06-30', demobilizationDate: '2026-08-20' }]
  });
  const result = await updateMission(mission.id, input, {}, { database });
  assert.equal(result.allocations[0].mobilizationDate, '2026-06-30');
  assert.equal(result.allocations[0].demobilizationDate, '2026-08-20');
  assert.deepEqual(result.allocations[0].cycles, []);
});

test('edição não aceita alterar período individual antigo para outra data fora da missão', async () => {
  const { mission, database, payload, writes } = fixture();
  mission.allocations[0].mobilizationDate = '2026-06-30';
  const input = missionUpdateInputSchema.parse({
    ...payload,
    allocationPeriods: [{ collaboratorId: 'person', mobilizationDate: '2026-07-01', demobilizationDate: '2026-08-20' }]
  });
  await assert.rejects(updateMission(mission.id, input, {}, { database }), error => error.code === 'ALLOCATION_OUTSIDE_MISSION_PERIOD');
  assert.equal(writes.length, 0);
  assert.equal(mission.allocations[0].mobilizationDate, '2026-06-30');
});

test('alterar as datas da missão continua revalidando os períodos individuais já registrados', async () => {
  const { mission, database, payload, writes } = fixture();
  mission.allocations[0].mobilizationDate = '2026-06-30';
  const input = missionUpdateInputSchema.parse({
    ...payload, executionEndDate: '2026-08-21',
    allocationPeriods: [{ collaboratorId: 'person', mobilizationDate: '2026-06-30', demobilizationDate: '2026-08-21' }]
  });
  await assert.rejects(updateMission(mission.id, input, {}, { database }), error => error.code === 'ALLOCATION_OUTSIDE_MISSION_PERIOD');
  assert.equal(writes.length, 0);
});

test('atualização continua rejeitando novo integrante com período fora da missão', async () => {
  const { mission, database, payload, writes } = fixture();
  mission.allocations = [];
  const input = missionUpdateInputSchema.parse({
    ...payload,
    allocationPeriods: [{ collaboratorId: 'person', mobilizationDate: '2026-06-30', demobilizationDate: '2026-08-20' }]
  });
  await assert.rejects(updateMission(mission.id, input, {}, { database }), error => error.code === 'ALLOCATION_OUTSIDE_MISSION_PERIOD');
  assert.equal(writes.length, 0);
});

test('ciclo histórico não permite atribuir novo período anterior à previsão para outro integrante', async () => {
  const { mission, database, payload, writes } = fixture();
  mission.project.workflow = { actualMobilizationDate: '2026-07-06' };
  Object.assign(mission, { mobilizationDate: '2026-07-10', executionStartDate: '2026-07-10', allocations: [] });
  const input = missionUpdateInputSchema.parse({
    ...payload, mobilizationDate: '2026-07-10', executionStartDate: '2026-07-10',
    allocationPeriods: [{ collaboratorId: 'person', mobilizationDate: '2026-07-06', demobilizationDate: '2026-08-20' }]
  });
  await assert.rejects(updateMission(mission.id, input, {}, { database }), error => error.code === 'ALLOCATION_OUTSIDE_MISSION_PERIOD');
  assert.equal(writes.length, 0);
});
