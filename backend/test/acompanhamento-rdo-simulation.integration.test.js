import assert from 'node:assert/strict';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import test from 'node:test';

test('exclusão manual persistida por HTTP retira e restaura a estimativa nos detalhes reais do projeto', {
  skip: !process.env.RDO_SIMULATION_TEST_DATABASE_URL
}, async t => {
  const url = new URL(process.env.RDO_SIMULATION_TEST_DATABASE_URL);
  assert.match(url.pathname, /_test$/);
  process.env.DATABASE_URL = url.toString();
  const { default: prisma } = await import('../src/lib/prisma.js');
  const { default: app } = await import('../src/app.js');
  const { getProjectDetail } = await import('../src/lib/acompanhamento/project-detail.js');
  const suffix = randomUUID();
  const proposalCode = randomInt(1_000_000, 2_000_000_000);
  let user, role, collaborator, profile, proposal, project, server;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (project) {
      await prisma.report.deleteMany({ where: { projectId: project.id } });
      await prisma.project.delete({ where: { id: project.id } });
    }
    if (collaborator) await prisma.collaborator.delete({ where: { id: collaborator.id } });
    if (proposal) await prisma.commercialProposal.delete({ where: { id: proposal.id } });
    if (profile) await prisma.costProfile.delete({ where: { id: profile.id } });
    if (role) await prisma.jobRole.delete({ where: { id: role.id } });
    if (user) await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  });
  user = await prisma.user.create({ data: {
    username: `simulation-${suffix}`, name: 'Teste de simulação', passwordHash: 'test-only',
    role: 'MANAGER', accountType: 'ADMIN'
  } });
  const token = randomUUID();
  await prisma.userSession.create({ data: {
    userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(Date.now() + 600_000)
  } });
  role = await prisma.jobRole.create({ data: { name: `Coordenador ${suffix}`, normalizedKey: `coordenador-${suffix}` } });
  profile = await prisma.costProfile.create({ data: {
    key: `role:${role.id}`, label: role.name, jobRoleId: role.id,
    parameterSets: { create: { version: 1, effectiveDate: new Date('2026-01-01'), params: { salarioBase: 3960, cargaHoraria: 220 } } }
  } });
  collaborator = await prisma.collaborator.create({ data: {
    code: suffix, name: 'Coordenador sem ponto', jobRoleId: role.id
  } });
  assert.equal(collaborator.rdoCostSimulationExcluded, false, 'novo cadastro participa por padrão');
  proposal = await prisma.commercialProposal.create({ data: { codBd: proposalCode, codProp: proposalCode, rawRow: {} } });
  project = await prisma.project.create({ data: {
    code: String(proposalCode), name: 'Obra teste', clientName: 'Cliente', clientCnpj: '', contractCode: '', location: ''
  } });
  await prisma.report.create({ data: {
    projectId: project.id, reportDate: new Date('2026-09-17'), sequenceNumber: 1,
    arrivalTime: '08:00', departureTime: '17:00', lunchBreak: '01:00', daytimeCount: 1, daytimeWorkedMinutes: 480,
    collaborators: { create: { collaboratorId: collaborator.id } }
  } });
  const detail = async () => (await getProjectDetail(project.id, { includeCollaboratorCosts: true })).colaboradores[0];
  const before = await detail();
  assert.equal(before.horas, 8);
  assert.ok(before.custoEstimadoRdo > 0, 'sem ponto também simula enquanto não houver exclusão manual');
  server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const request = async body => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/acompanhamento/ponto/rdo-simulation-exclusions`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  await request({ collaboratorId: collaborator.id, excluded: true });
  const stored = await prisma.collaborator.findUniqueOrThrow({ where: { id: collaborator.id } });
  assert.equal(stored.rdoCostSimulationExcluded, true);
  assert.equal(stored.isActive, true);
  assert.equal((await request()).find(item => item.id === collaborator.id).rdoCostSimulationExcluded, true);
  const excluded = await detail();
  assert.equal(excluded.horas, 8);
  assert.equal(excluded.custoEstimadoRdo, null);
  assert.equal(excluded.custoHoraEstimadoRdo, null);
  assert.ok(excluded.horasRelatoriosPorData.every(day => day.custoEstimado === null));
  await request({ collaboratorId: collaborator.id, excluded: false });
  const restored = await detail();
  assert.equal(restored.custoEstimadoRdo, before.custoEstimadoRdo);
  assert.equal(restored.horas, before.horas);
  assert.equal(await prisma.pontoPeriodSummary.count({ where: { collaboratorId: collaborator.id } }), 0);
});
