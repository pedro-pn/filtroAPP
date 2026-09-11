import assert from 'node:assert/strict';
import test from 'node:test';

import { listCommercialDashboard, listCommercialPendencias } from '../src/lib/acompanhamento/access-import.js';
import { getPlanningCalendar } from '../src/lib/efetivo/planning/calendar.js';
import { createMission, getMission, listMissions } from '../src/lib/efetivo/planning/mission-planning.js';
import { listPendingMissionProjects, listPlanningProjects, loadPlanningProjection } from '../src/lib/efetivo/planning/read-model.js';
import prisma from '../src/lib/prisma.js';

function assertEfetivoVisibility(where) {
  assert.equal(where.managerOnly, false, 'Somente gestor deve ficar fora do Efetivo');
  assert.deepEqual([...where.code.notIn].sort(), ['5000', '5002', '5003', '5004']);
}

function planningDatabase() {
  const projectQueries = [];
  const missionQueries = [];
  const plan = { id: 'official', kind: 'OFFICIAL', status: 'ACTIVE' };
  return {
    projectQueries,
    missionQueries,
    efetivoPlan: { findFirst: async () => plan, findUnique: async () => plan },
    project: {
      findMany: async ({ where }) => { projectQueries.push(where); return []; },
      findFirst: async ({ where }) => { projectQueries.push(where); return null; }
    },
    efetivoMissionPlan: {
      findMany: async ({ where }) => { missionQueries.push(where); return []; },
      findUnique: async ({ where }) => { missionQueries.push(where); return null; }
    },
    collaborator: { findMany: async () => [] },
    jobRole: { findMany: async () => [] },
    collaboratorAbsence: { findMany: async () => [] },
    workforceHoliday: { findMany: async () => [] },
    workforceCalendarState: { findUnique: async () => ({ revision: 1 }) },
    efetivoSetting: { findUnique: async () => null },
    efetivoPlannedHire: { findMany: async () => [] }
  };
}

test('seletor e pendências do Efetivo excluem Somente gestor e todos os códigos da Sede', async () => {
  const database = planningDatabase();
  await listPlanningProjects({ search: '500' }, { database });
  await listPendingMissionProjects({}, { database });
  await listPendingMissionProjects({ planId: 'scenario' }, { database });
  assert.equal(database.projectQueries.length, 3);
  database.projectQueries.forEach(where => {
    assertEfetivoVisibility(where);
    assert.equal(where.isActive, true);
    assert.equal(where.deletedAt, null);
  });
  assert.equal(database.projectQueries[0].OR[0].code.contains, '500');
});

test('missões oficiais, cenários, projeção e calendário usam a mesma visibilidade', async () => {
  const database = planningDatabase();
  await listMissions({ status: 'CONFIRMED', stage: 'FUTURE' }, { database });
  await listMissions({ planId: 'scenario' }, { database });
  await loadPlanningProjection({ date: '2026-09-08' }, { database });
  await loadPlanningProjection({ date: '2026-09-08', planId: 'scenario' }, { database });
  await getPlanningCalendar({ startDate: '2026-09-08', endDate: '2026-09-30' }, { database });
  assert.equal(database.missionQueries.length, 5);
  database.missionQueries.forEach(where => assertEfetivoVisibility(where.project));
  assert.equal(database.missionQueries[0].scheduleStatus, 'CONFIRMED');
  assert.equal(database.missionQueries[0].stage, 'FUTURE');
});

test('missão oculta não é aberta por id nem criada por uma seleção antiga', async () => {
  const database = planningDatabase();
  await assert.rejects(getMission('hidden-mission', { database }), /não encontrada/);
  assertEfetivoVisibility(database.missionQueries[0].project);

  await assert.rejects(createMission({
    projectId: 'hidden-project',
    scheduleStatus: 'DRAFT',
    mobilizationDate: '2026-09-08',
    executionStartDate: '2026-09-09',
    executionEndDate: '2026-09-10',
    demands: []
  }, {}, { database }), /Projeto não encontrado/);
  assertEfetivoVisibility(database.projectQueries[0]);
});

test('dashboard e pendências do Acompanhamento ocultam Somente gestor sem excluir códigos da Sede', async t => {
  const projectQueries = [];
  function stub(model, method, implementation = async () => []) {
    const original = prisma[model][method];
    prisma[model][method] = implementation;
    t.after(() => { prisma[model][method] = original; });
  }
  stub('project', 'findMany', async ({ where }) => {
    projectQueries.push(where);
    return [];
  });
  for (const [model, method] of [
    ['commercialProposal', 'findMany'], ['commercialProposal', 'groupBy'],
    ['projectBudget', 'findMany'], ['projectAdditionalProposal', 'findMany'],
    ['report', 'groupBy'], ['omiePurchase', 'groupBy'],
    ['omieReceivable', 'findMany'], ['omieCategory', 'findMany']
  ]) stub(model, method);

  assert.deepEqual(await listCommercialDashboard(), []);
  assert.deepEqual(await listCommercialPendencias(), []);
  assert.equal(projectQueries.length, 2);
  projectQueries.forEach(where => {
    assert.equal(where.managerOnly, false);
    assert.equal(where.deletedAt, null);
    assert.equal(where.code, undefined);
  });
});
