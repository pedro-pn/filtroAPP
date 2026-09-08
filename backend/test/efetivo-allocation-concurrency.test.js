import assert from 'node:assert/strict';
import test from 'node:test';

import { lockCollaborator } from '../src/lib/efetivo/planning/conflicts.js';

test('lock de colaborador usa parâmetro e FOR UPDATE antes da revalidação', async () => {
  const calls = [];
  await lockCollaborator({ $queryRawUnsafe: async (...args) => calls.push(args) }, 'c1');
  assert.match(calls[0][0], /FOR UPDATE/);
  assert.equal(calls[0][1], 'c1');
});

// Teste transacional real: exige PostgreSQL migrado e descartável.
// Rode com: EFETIVO_DB_TESTS=1 DATABASE_URL=postgres://… node --test test/efetivo-allocation-concurrency.test.js
const databaseTestsEnabled = process.env.EFETIVO_DB_TESTS === '1' && Boolean(process.env.DATABASE_URL);
const suffix = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const utcDate = value => new Date(`${value}T00:00:00.000Z`);

async function seed(prisma) {
  const jobRole = await prisma.jobRole.create({
    data: { name: `Operador ${suffix}`, normalizedKey: `operador ${suffix}`, isActive: true, isOperational: true }
  });
  const collaborator = await prisma.collaborator.create({
    data: {
      code: `COL-${suffix}`,
      name: `Colaborador ${suffix}`,
      jobRoleId: jobRole.id,
      isActive: true,
      admissionDate: utcDate('2020-01-01')
    }
  });
  const projects = await Promise.all([1, 2].map(index => prisma.project.create({
    data: {
      code: `PRJ-${suffix}-${index}`,
      name: `Projeto ${index} ${suffix}`,
      clientName: 'Cliente de teste',
      clientCnpj: '00000000000000',
      contractCode: `CT-${suffix}-${index}`,
      location: 'Laboratório'
    }
  })));
  const responsibleUser = await prisma.user.create({
    data: {
      username: `responsavel-${suffix}`,
      name: `Responsável ${suffix}`,
      passwordHash: 'test-only-not-a-real-hash',
      role: 'MANAGER'
    }
  });
  // Plano de cenário: mantém o teste fora do planejamento oficial e ainda assim editável.
  const plan = await prisma.efetivoPlan.create({
    data: { kind: 'SCENARIO', status: 'DRAFT', name: `Concorrência ${suffix}` }
  });
  const missions = await Promise.all(projects.map(project => prisma.efetivoMissionPlan.create({
    data: {
      planId: plan.id,
      projectId: project.id,
      scheduleStatus: 'CONFIRMED',
      stage: 'STANDBY',
      headquartersResponsibleName: 'Coordenação de teste',
      headquartersResponsibleRole: 'Coordenador',
      headquartersResponsibleUserId: responsibleUser.id,
      mobilizationDate: utcDate('2026-09-01'),
      executionStartDate: utcDate('2026-09-02'),
      executionEndDate: utcDate('2026-09-09'),
      returnDate: utcDate('2026-09-10'),
      demands: { create: [{ jobRoleId: jobRole.id, requiredCount: 1 }] }
    }
  })));
  return { jobRole, collaborator, responsibleUser, projects, plan, missions };
}

async function cleanup(prisma, data) {
  if (!data) return;
  const missionIds = data.missions.map(mission => mission.id);
  await prisma.efetivoAuditEvent.deleteMany({ where: { planId: data.plan.id } });
  await prisma.efetivoMissionAllocation.deleteMany({ where: { missionId: { in: missionIds } } });
  await prisma.efetivoMissionDemand.deleteMany({ where: { missionId: { in: missionIds } } });
  await prisma.efetivoMissionPlan.deleteMany({ where: { id: { in: missionIds } } });
  await prisma.efetivoPlan.delete({ where: { id: data.plan.id } });
  await prisma.project.deleteMany({ where: { id: { in: data.projects.map(project => project.id) } } });
  await prisma.collaborator.delete({ where: { id: data.collaborator.id } });
  await prisma.user.delete({ where: { id: data.responsibleUser.id } });
  await prisma.jobRole.delete({ where: { id: data.jobRole.id } });
}

test('duas transações concorrentes só permitem uma alocação conflitante', { skip: databaseTestsEnabled ? false : 'defina EFETIVO_DB_TESTS=1 e DATABASE_URL de um banco descartável' }, async () => {
  const { default: prisma } = await import('../src/lib/prisma.js');
  const { addMissionAllocation } = await import('../src/lib/efetivo/planning/allocations.js');
  let data = null;
  try {
    data = await seed(prisma);
    const payload = { collaboratorId: data.collaborator.id, jobRoleId: data.jobRole.id };
    const results = await Promise.allSettled(data.missions.map(mission => addMissionAllocation(mission.id, payload)));

    const fulfilled = results.filter(item => item.status === 'fulfilled');
    const rejected = results.filter(item => item.status === 'rejected');
    assert.equal(fulfilled.length, 1, 'apenas uma das transações pode vencer');
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason.statusCode, 409);
    assert.match(rejected[0].reason.message, /conflito/i);
    assert.equal(rejected[0].reason.conflicts[0].code, 'MISSION_OVERLAP');

    const stored = await prisma.efetivoMissionAllocation.findMany({
      where: { collaboratorId: data.collaborator.id, deletedAt: null, mission: { planId: data.plan.id } }
    });
    assert.equal(stored.length, 1, 'a base não pode guardar as duas alocações');
    assert.equal(stored[0].missionId, fulfilled[0].value.missionId);
  } finally {
    await cleanup(prisma, data);
    await prisma.$disconnect();
  }
});
