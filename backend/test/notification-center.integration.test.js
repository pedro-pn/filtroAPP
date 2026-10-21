import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import prisma from '../src/lib/prisma.js';
import { createSession } from '../src/lib/auth.js';
import { listNotifications, markAllNotificationsRead, markNotificationRead } from '../src/lib/notifications/center.js';
import app from '../src/app.js';

test('central aplica escopo real no PostgreSQL, inclusive leitura, paginação e revogação', {
  skip: !process.env.TEST_NOTIFICATION_DATABASE_URL
}, async t => {
  assert.equal(process.env.DATABASE_URL, process.env.TEST_NOTIFICATION_DATABASE_URL);
  assert.equal(new URL(process.env.DATABASE_URL).pathname, '/filtroapp_notifications_test');
  const suffix = randomUUID();
  const projects = [];
  const users = [];
  const newUser = async (role, accountType, moduleRoles) => {
    const user = await prisma.user.create({ data: {
      username: `${role}-${users.length}-${suffix}`, name: role, passwordHash: 'synthetic', role, accountType
    } });
    users.push(user);
    return { user: { ...user, moduleRoles } };
  };
  const newProject = async (code, extra = {}) => {
    const project = await prisma.project.create({ data: {
      code: `${code}-${suffix}`, name: code, clientName: 'Cliente QA', clientCnpj: '12345678000190',
      contractCode: '100', location: 'Sede', ...extra
    } });
    projects.push(project);
    return project;
  };
  const newReport = (project, user, extra = {}) => prisma.report.create({ data: {
    projectId: project.id, createdByUserId: user.user.id, reportDate: new Date(),
    arrivalTime: '08:00', departureTime: '17:00', lunchBreak: '01:00', daytimeCount: 1, ...extra
  } });
  t.after(async () => {
    await prisma.report.deleteMany({ where: { projectId: { in: projects.map(p => p.id) } } });
    await prisma.project.deleteMany({ where: { id: { in: projects.map(p => p.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map(u => u.id) } } });
    await prisma.$disconnect();
  });
  const manager = await newUser('MANAGER', 'ADMIN', ['rdo:manager']);
  const coordinator = await newUser('COORDINATOR', 'INTERNAL', ['rdo:coordinator']);
  const collaborator = await newUser('COLLABORATOR', 'INTERNAL', ['rdo:collaborator']);
  const tracking = await newUser('COLLABORATOR', 'INTERNAL', ['acompanhamento:viewer']);
  const equipment = await newUser('COLLABORATOR', 'INTERNAL', ['equipamentos:viewer']);
  const effective = await newUser('COLLABORATOR', 'INTERNAL', ['efetivo:viewer']);
  const client = await newUser('CLIENT', 'CLIENT', ['rdo:client']);
  client.user.username = '12345678000190';
  const visible = await newProject('visible');
  const secret = await newProject('secret', { managerOnly: true });
  const pending = await newProject('pending', { managerOnly: true, registrationPending: true });
  const deleted = await newProject('deleted', { deletedAt: new Date() });
  const otherClient = await newProject('other', { clientCnpj: '98765432000100' });
  await prisma.projectAuthorizedUser.create({ data: { projectId: visible.id, userId: collaborator.user.id } });
  const report = await newReport(visible, collaborator);
  await newReport(secret, collaborator);
  await prisma.commercialAppProposal.create({ data: {
    externalId: suffix, projectId: visible.id, proposalCode: suffix, revisionNumber: 0, proposalKind: 'ADDITIONAL',
    parentProposalCode: '100', additionalProposalId: `additional-${suffix}`,
    clientName: 'QA', clientCnpj: '12345678000190', title: 'Extra', site: 'Sede', salePrice: 100,
    snapshot: {}, snapshotHash: suffix
  } });
  const list = (auth, options) => listNotifications(auth, { limit: 50, ...options });
  await t.test('lista e contador obedecem a módulos, managerOnly, clientes e vínculos', async () => {
    const m = await list(manager);
    assert.ok(m.items.some(e => e.title === 'Novo projeto recebido'));
    assert.equal(m.items.filter(e => e.kind === 'REPORT_PENDING').length, 2);
    assert.ok(!m.items.some(e => e.description.includes(deleted.code)));
    const c = await list(coordinator);
    assert.equal(c.items.filter(e => e.kind === 'REPORT_PENDING').length, 1);
    assert.ok(!c.items.some(e => e.description.includes(secret.code) || e.description.includes(pending.code)));
    const employee = await list(collaborator);
    assert.equal(employee.items.length, 1);
    assert.ok(employee.items[0].description.includes(visible.code));
    const external = await list(client);
    assert.equal(external.items.length, 1);
    assert.ok(!external.items.some(e => e.description.includes(otherClient.code)));
    const ac = await list(tracking);
    assert.ok(ac.items.some(e => e.kind === 'PROPOSAL_RECEIVED'));
    assert.ok(!ac.items.some(e => e.kind === 'REPORT_PENDING' || e.description.includes(pending.code)));
    const ef = await list(effective);
    assert.ok(ef.items.some(e => e.description.includes(visible.code)));
    assert.ok(!ef.items.some(e => e.description.includes(secret.code) || e.kind === 'PROPOSAL_RECEIVED'));
    assert.equal((await list(equipment)).unreadCount, 0);
    assert.deepEqual((await list(equipment)).items, []);
    for (const auth of [manager, coordinator, collaborator, tracking, effective, client]) {
      const data = await list(auth);
      assert.equal(data.unreadCount, data.items.length);
    }
  });
  await t.test('leitura é persistida por usuário, idempotente e não autoriza IDs ocultos', async () => {
    const id = (await list(coordinator)).items[0].id;
    assert.equal(await markNotificationRead(coordinator, id), true);
    assert.equal(await markNotificationRead(coordinator, id), true);
    assert.ok((await list(coordinator)).items.find(e => e.id === id).readAt);
    assert.equal((await list(manager)).items.find(e => e.id === id).readAt, null);
    assert.ok(!(await list(coordinator, { filter: 'unread' })).items.some(e => e.id === id));
    const secretId = (await list(manager)).items.find(e => e.description.includes(secret.code)).id;
    assert.equal(await markNotificationRead(coordinator, secretId), false);
    assert.equal(await markNotificationRead(equipment, id), false);
  });
  await t.test('paginação por data e ID não pula nem repete eventos com a mesma data', async () => {
    await prisma.notificationEvent.updateMany({ where: { projectId: { in: projects.map(p => p.id) } }, data: { createdAt: new Date('2026-01-01') } });
    const ids = [];
    let cursor;
    do {
      const page = await list(manager, { limit: 2, cursor });
      ids.push(...page.items.map(e => e.id));
      cursor = page.nextCursor ? JSON.parse(Buffer.from(page.nextCursor, 'base64url').toString()) : undefined;
    } while (cursor);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids.length, (await list(manager)).items.length);
  });
  await t.test('marcar todas afeta apenas o usuário, o escopo e o instante consultado', async () => {
    const snapshot = await list(tracking);
    const latest = await newProject('after-snapshot');
    await prisma.notificationEvent.updateMany({ where: { projectId: latest.id }, data: { createdAt: new Date(new Date(snapshot.snapshotAt).getTime() + 1) } });
    await markAllNotificationsRead(tracking, new Date(snapshot.snapshotAt));
    const data = await list(tracking);
    assert.equal(data.items.filter(e => !e.readAt).length, 1);
    assert.equal(data.unreadCount, 1);
    assert.ok(data.items.find(e => !e.readAt).description.includes(latest.code));
    assert.ok((await list(manager)).unreadCount > 1);
  });
  await t.test('permissões e vínculos revogados removem imediatamente os avisos e o contador', async () => {
    assert.ok((await list(collaborator)).items.length);
    await prisma.projectAuthorizedUser.deleteMany({ where: { userId: collaborator.user.id } });
    assert.equal((await list(collaborator)).unreadCount, 0);
    assert.deepEqual((await list(collaborator)).items, []);
    assert.deepEqual((await list({ user: { ...tracking.user, moduleRoles: [] } })).items, []);
    await prisma.projectAuthorizedUser.create({ data: { projectId: visible.id, userId: collaborator.user.id } });
  });
  await t.test('devolução é visível ao autor; reenvio substitui a pendência anterior', async () => {
    await prisma.report.update({ where: { id: report.id }, data: { status: 'RETURNED' } });
    const returned = (await list(collaborator)).items.find(e => e.kind === 'REPORT_RETURNED');
    assert.ok(returned);
    assert.equal(returned.href, `/rdo/relatorios/${report.id}`);
    assert.ok(!(await list(client)).items.some(e => e.kind.startsWith('REPORT_')));
    const other = await newUser('COLLABORATOR', 'INTERNAL', ['rdo:collaborator']);
    assert.ok(!(await list(other)).items.some(e => e.kind === 'REPORT_RETURNED'));
    await prisma.report.update({ where: { id: report.id }, data: { status: 'PENDING' } });
    assert.ok(!(await list(collaborator)).items.some(e => e.kind === 'REPORT_RETURNED'));
    assert.equal(await prisma.notificationEvent.count({ where: { reportId: report.id, kind: 'REPORT_PENDING' } }), 1);
  });
  await t.test('transferir um relatório para projeto restrito transfere também o escopo do aviso', async () => {
    await prisma.report.update({ where: { id: report.id }, data: { projectId: secret.id } });
    const event = await prisma.notificationEvent.findFirst({ where: { reportId: report.id, kind: 'REPORT_PENDING' } });
    assert.equal(event.projectId, secret.id);
    assert.ok(!(await list(coordinator)).items.some(e => e.id === event.id));
    assert.equal(await markNotificationRead(coordinator, event.id), false);
    assert.ok((await list(manager)).items.find(e => e.id === event.id).description.includes(secret.code));
    await prisma.report.update({ where: { id: report.id }, data: { projectId: visible.id } });
  });
  await t.test('HTTP exige sessão, valida entradas e retorna 404 uniforme para avisos inacessíveis', async () => {
    await prisma.moduleRole.create({ data: { userId: coordinator.user.id, module: 'RDO', role: 'RDO_COORDINATOR' } });
    const { token } = await createSession(coordinator.user.id);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
      const url = `http://127.0.0.1:${server.address().port}/api/notifications`;
      assert.equal((await fetch(url)).status, 401);
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      for (const query of ['?limit=0', '?limit=51', '?filter=bad', '?cursor=broken']) {
        assert.equal((await fetch(url + query, { headers })).status, 400);
      }
      const response = await fetch(url, { headers });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const data = await response.json();
      assert.ok(!data.items.some(e => e.description.includes(secret.code)));
      const hidden = (await list(manager)).items.find(e => e.description.includes(secret.code)).id;
      assert.equal((await fetch(`${url}/${hidden}/read`, { method: 'POST', headers })).status, 404);
      assert.equal((await fetch(`${url}/missing/read`, { method: 'POST', headers })).status, 404);
      assert.equal((await fetch(`${url}/read-all`, { method: 'POST', headers, body: JSON.stringify({ before: '2100-01-01T00:00:00.000Z' }) })).status, 400);
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
  await t.test('manutenção e produção usam suas permissões específicas sem acesso implícito pelo RDO', async () => {
    const maintenance = await newUser('COLLABORATOR', 'INTERNAL', []);
    maintenance.user.reportEmissionPermissions = ['MAINTENANCE'];
    const production = await newUser('COLLABORATOR', 'INTERNAL', []);
    production.user.reportEmissionPermissions = ['PRODUCTION'];
    const maintenanceReport = await newReport(visible, maintenance, { reportType: 'RDO_MAINTENANCE' });
    const productionReport = await newReport(visible, production, { reportType: 'RDO_PRODUCTION' });
    const m = await list(maintenance);
    assert.equal(m.items.length, 1);
    assert.ok(m.items[0].href.includes(`tipo=manutencao&editar=${maintenanceReport.id}`));
    const p = await list(production);
    assert.equal(p.items.length, 1);
    assert.ok(p.items[0].href.includes(`tipo=producao&editar=${productionReport.id}`));
    assert.ok(!(await list(coordinator)).items.some(e => e.href.includes('/manutencao-producao/')));
    await prisma.report.update({ where: { id: maintenanceReport.id }, data: { status: 'RETURNED' } });
    assert.ok((await list(maintenance)).items.some(e => e.kind === 'REPORT_RETURNED'));
    assert.deepEqual((await list({ user: { ...maintenance.user, reportEmissionPermissions: [] } })).items, []);
  });
});
