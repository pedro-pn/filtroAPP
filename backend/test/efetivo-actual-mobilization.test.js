import assert from 'node:assert/strict';
import test from 'node:test';

import { confirmOfficialMissionMobilization, updateMissionCycle, validateNewCycle } from '../src/lib/efetivo/planning/cycles.js';
import { missionPeriod } from '../src/lib/efetivo/planning/mission-period.js';

function fixture() {
  const mission = {
    id: 'mission', planId: 'plan', projectId: 'project', stage: 'MOBILIZATION',
    mobilizationDate: '2026-10-10', executionEndDate: '2026-10-20', returnDate: null,
    plan: { id: 'plan', kind: 'OFFICIAL', status: 'ACTIVE' }, project: { code: 'P-1' },
    cycles: [{ id: 'default', isDefault: true, mobilizationDate: '2026-10-10', demobilizationDate: null }], allocations: []
  };
  const audits = [];
  const database = {
    efetivoMissionPlan: { findFirst: async () => mission, findUnique: async () => mission },
    efetivoMissionCycle: {
      update: async ({ where, data }) => Object.assign(mission.cycles.find(cycle => cycle.id === where.id), data),
      create: async ({ data }) => { const cycle = { id: 'created', ...data }; mission.cycles.push(cycle); return cycle; }
    },
    efetivoPlan: { findUnique: async () => mission.plan, update: async () => mission.plan },
    efetivoAuditEvent: { create: async ({ data }) => audits.push(data) }
  };
  return { mission, database, audits };
}

test('confirmação usa a data efetiva no ciclo padrão, mantém a previsão e deixa a saída em aberto', async () => {
  const { mission, database, audits } = fixture();
  const cycle = await confirmOfficialMissionMobilization(database, 'project', '2026-10-08', { actorUserId: 'leader' });
  assert.equal(cycle.mobilizationDate.toISOString().slice(0, 10), '2026-10-08');
  assert.equal(cycle.demobilizationDate, null);
  assert.equal(mission.mobilizationDate, '2026-10-10');
  assert.equal(mission.executionEndDate, '2026-10-20');
  assert.deepEqual(missionPeriod(mission), { startDate: '2026-10-08', endDate: '2026-10-20' });
  assert.equal(audits.at(-1).action, 'MISSION_MOBILIZATION_CONFIRM');
});

test('corrigir a mobilização atualiza somente o ciclo padrão, preservando ciclos encerrados de remobilização', async () => {
  const { mission, database } = fixture();
  mission.cycles[0].demobilizationDate = '2026-10-12';
  const remobilization = { id: 'second', mobilizationDate: '2026-10-15', demobilizationDate: '2026-10-18' };
  mission.cycles.push(remobilization);
  await confirmOfficialMissionMobilization(database, 'project', '2026-10-09');
  assert.equal(mission.cycles[0].demobilizationDate.toISOString().slice(0, 10), '2026-10-12');
  assert.deepEqual(mission.cycles[1], remobilization);
  await assert.rejects(confirmOfficialMissionMobilization(database, 'project', '2026-10-16'), /datas gerais da missão/);
  assert.equal(mission.cycles[0].mobilizationDate.toISOString().slice(0, 10), '2026-10-09');
});

test('correção geral mantém o histórico individual mesmo quando as datas diferem', async () => {
  const { mission, database } = fixture();
  mission.allocations.push({ id: 'allocation', collaborator: { name: 'Pessoa' }, cycles: [{ id: 'own', mobilizationDate: '2026-10-10', demobilizationDate: '2026-10-12' }] });
  const before = structuredClone(mission.allocations);
  await confirmOfficialMissionMobilization(database, 'project', '2026-10-11');
  assert.equal(mission.cycles[0].mobilizationDate.toISOString().slice(0, 10), '2026-10-11');
  assert.deepEqual(mission.allocations, before);
});

test('edição de ciclo exige que a data padrão seja corrigida pela confirmação do projeto', async () => {
  const { mission, database } = fixture();
  await assert.rejects(updateMissionCycle(mission.id, 'default', { mobilizationDate: '2026-10-09', demobilizationDate: null }, {}, { database }), error => error.code === 'DEFAULT_CYCLE_MOBILIZATION_REQUIRES_CONFIRMATION');
  assert.equal(mission.cycles[0].mobilizationDate, '2026-10-10');
});

test('desmobilização efetiva pode ocorrer depois da previsão; novos ciclos ainda exigem saída registrada', () => {
  const { mission } = fixture();
  mission.stage = 'EXECUTION';
  assert.deepEqual(validateNewCycle([], { mobilizationDate: '2026-10-15', demobilizationDate: '2026-10-25' }, mission, 'Projeto'), { startDate: '2026-10-15', endDate: '2026-10-25' });
  assert.deepEqual(validateNewCycle([], { mobilizationDate: '2026-10-25', demobilizationDate: null }, mission, 'Projeto'), { startDate: '2026-10-25', endDate: '2026-10-25' });
  assert.throws(() => validateNewCycle(mission.cycles, { mobilizationDate: '2026-10-18', demobilizationDate: null }, mission, 'Projeto'), error => error.code === 'OPEN_MOBILIZATION_CYCLE');
});
