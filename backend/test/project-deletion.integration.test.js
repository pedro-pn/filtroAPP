import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

// Banco descartável com as migrations aplicadas; nunca executa contra o banco do app.
test('exclusão HTTP + PostgreSQL preserva vínculos e oculta o projeto entre módulos', {
  skip: !process.env.PROJECT_DELETION_TEST_DATABASE_URL
}, async t => {
  const url = new URL(process.env.PROJECT_DELETION_TEST_DATABASE_URL);
  assert.match(url.pathname, /_test$/);
  process.env.DATABASE_URL = url.toString();
  const { default: prisma } = await import('../src/lib/prisma.js');
  const { default: app } = await import('../src/app.js');
  const { listMissions, getMission } = await import('../src/lib/efetivo/planning/mission-planning.js');
  const { listPendingMissionProjects } = await import('../src/lib/efetivo/planning/read-model.js');
  const { getPlanningCalendar } = await import('../src/lib/efetivo/planning/calendar.js');
  const suffix = randomUUID();
  const projectIds = [];
  const planIds = [];
  let user, group, server;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (group) await prisma.acompanhamentoMissionGroup.delete({ where: { id: group.id } });
    await prisma.pontoProjectTagAlias.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.projectWorkflow.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.efetivoPlan.deleteMany({ where: { id: { in: planIds } } });
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    if (user) await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  });
  user = await prisma.user.create({ data: {
    username: `deletion-${suffix}`, name: 'Teste de exclusão', passwordHash: 'test-only',
    role: 'MANAGER', accountType: 'ADMIN',
    moduleRoles: { create: ['RDO', 'ROMANEIO', 'ACOMPANHAMENTO', 'EFETIVO', 'QUALIDADE'].map(module => ({
      module, role: `${module}_MANAGER`
    })) }
  } });
  const token = randomUUID();
  await prisma.userSession.create({ data: {
    userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(Date.now() + 600_000)
  } });
  const projects = [];
  for (const name of ['missao-removida-5817', 'missao-ativa', 'workflow-ponto', 'sem-vinculo', 'arquivado']) {
    const project = await prisma.project.create({ data: {
      code: `${name}-${suffix}`, name, clientName: 'Cliente teste', clientCnpj: '',
      contractCode: '', location: '', isActive: name !== 'arquivado'
    } });
    projects.push(project);
    projectIds.push(project.id);
  }
  const plan = await prisma.efetivoPlan.create({ data: { kind: 'OFFICIAL', status: 'ACTIVE', name: `Exclusão ${suffix}` } });
  planIds.push(plan.id);
  const date = new Date('2026-09-17T00:00:00Z');
  const removedAt = new Date('2026-09-10T12:23:37Z');
  const missions = [];
  for (const [index, project] of projects.slice(0, 2).entries()) {
    missions.push(await prisma.efetivoMissionPlan.create({ data: {
      planId: plan.id, projectId: project.id, headquartersResponsibleUserId: user.id,
      headquartersResponsibleName: user.name, headquartersResponsibleRole: 'Gestor',
      mobilizationDate: date, executionStartDate: date, executionEndDate: date, returnDate: date,
      scheduleStatus: index === 0 ? 'CANCELLED' : 'CONFIRMED', deletedAt: index === 0 ? removedAt : null
    } }));
  }
  await prisma.projectBudget.create({ data: { projectId: projects[0].id } });
  await prisma.projectWorkflow.create({ data: {
    projectId: projects[2].id, leaderUserId: user.id, plannedMobilizationDate: date
  } });
  await prisma.pontoProjectTagAlias.create({ data: {
    projectId: projects[2].id, normalizedTag: `deletion-${suffix}`, rawTag: `deletion-${suffix}`
  } });
  group = await prisma.acompanhamentoMissionGroup.create({ data: {
    name: 'Grupo teste', primaryLaborProjectId: projects[2].id,
    members: { create: [{ projectId: projects[2].id, activeProjectId: projects[2].id }] }
  } });

  // Reproduz o bloqueio real que motivou a correção, inclusive com missão já removida.
  await assert.rejects(prisma.project.delete({ where: { id: projects[0].id } }), error => error.code === 'P2003');
  server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const request = async (path, method = 'GET') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { Authorization: `Bearer ${token}` }
    });
    const text = await response.text();
    return { status: response.status, data: text ? JSON.parse(text) : null };
  };
  const before = await request('/projects');
  assert.equal(before.status, 200, JSON.stringify(before.data));
  assert.ok(before.data.some(project => project.id === projects[0].id));
  assert.ok((await listMissions({ planId: plan.id })).some(mission => mission.id === missions[1].id));
  assert.ok((await listPendingMissionProjects({ planId: plan.id })).some(project => project.id === projects[0].id));

  for (const project of projects.slice(0, 4)) {
    const response = await request(`/projects/${project.id}`, 'DELETE');
    assert.equal(response.status, 204, JSON.stringify(response.data));
    const stored = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    assert.equal(stored.isActive, false);
    assert.ok(stored.deletedAt instanceof Date);
    assert.equal((await request(`/projects/${project.id}`, 'DELETE')).status, 204);
  }
  for (const path of [
    '/projects', '/projects?active=false', '/bootstrap/gestor',
    '/romaneio/projects', '/qualidade/projetos', '/acompanhamento/ponto/reconciliation-projects',
    '/acompanhamento/comercial/dashboard', '/acompanhamento/comercial/projetos-cards',
    '/efetivo/project-workflow'
  ]) {
    const response = await request(path);
    assert.equal(response.status, 200, `${path}: ${JSON.stringify(response.data)}`);
    for (const project of projects.slice(0, 4)) {
      assert.ok(!JSON.stringify(response.data).includes(project.id), `${path} ainda mostra ${project.name}`);
    }
  }
  assert.deepEqual(await listMissions({ planId: plan.id }), []);
  const pending = await listPendingMissionProjects({ planId: plan.id });
  assert.ok(pending.every(project => !projectIds.includes(project.id)));
  await assert.rejects(getMission(missions[1].id), /não encontrada/);
  const calendar = await getPlanningCalendar({ startDate: '2026-09-17', endDate: '2026-09-17' });
  assert.ok(!JSON.stringify(calendar).includes(projects[1].id));
  assert.ok((await request('/projects?active=false')).data.some(project => project.id === projects[4].id));

  // O histórico continua íntegro e o código permanece reservado contra recriação.
  assert.deepEqual(await prisma.efetivoMissionPlan.findUnique({ where: { id: missions[0].id } }), missions[0]);
  assert.deepEqual(await prisma.efetivoMissionPlan.findUnique({ where: { id: missions[1].id } }), missions[1]);
  assert.equal(await prisma.projectBudget.count({ where: { projectId: projects[0].id } }), 1);
  assert.equal(await prisma.projectWorkflow.count({ where: { projectId: projects[2].id } }), 1);
  assert.equal(await prisma.pontoProjectTagAlias.count({ where: { projectId: projects[2].id } }), 1);
  await assert.rejects(prisma.project.create({ data: {
    code: projects[0].code, name: 'Reimportação', clientName: '', clientCnpj: '', contractCode: '', location: ''
  } }), error => error.code === 'P2002');
});
