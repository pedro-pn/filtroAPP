import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import express from 'express';
import { apiSimulationDatabase } from './helpers/api-simulation-db.js';
import prisma from '../src/lib/prisma.js';
import { requireAuth } from '../src/middleware/auth.js';
import { createReviewParticipationRouter } from '../src/routes/resources/efetivo-review-participation.js';
import { listReviewParticipants, participationInputSchema, updateReviewParticipation } from '../src/lib/efetivo/allocation-review/participation.js';
import { listCollaboratorsWithCurrentJobRole } from '../src/lib/collaborators/job-role-service.js';
import { getReviewMonth, getReviewWeek, loadReviewWeekContext, weekDateKeys } from '../src/lib/efetivo/allocation-review/read-model.js';
import { closeReviewWeek, confirmReviewRows, discardReviewDays, saveReviewDays, unconfirmReviewRows } from '../src/lib/efetivo/allocation-review/service.js';
import { loadConfirmedReviewDays } from '../src/lib/efetivo/allocation-review/confirmed-days.js';
import { ALLOCATION_REVIEW_SCOPE, listReviewAllocations } from '../src/lib/api-credentials/allocation-review.js';

const WEEK = '2026-11-02';
const NOW = new Date('2026-11-24T15:00:00.000Z');
const date = key => new Date(`${key}T00:00:00.000Z`);

test('participação individual na conferência: persistência, HTTP, fechamento e histórico', { timeout: 180000 }, async t => {
  const database = await apiSimulationDatabase();
  t.after(() => database.close());
  const db = database.client;
  const role = await db.jobRole.create({ data: { name: 'Técnico', normalizedKey: 'tecnico', workforceClassification: 'OPERATIONAL' } });
  const [included, excluded] = await Promise.all(['Ana', 'Bruno'].map(name => db.collaborator.create({ data: {
    code: name, name, jobRoleId: role.id, workforceSector: 'Campo', admissionDate: date('2026-01-01'), allocationReviewEnabled: true
  } })));
  const admin = await db.user.create({ data: { username: 'participation-admin', name: 'Administrador', passwordHash: 'test', role: 'MANAGER', accountType: 'ADMIN' } });
  const deps = { database: db, getTrails: async () => new Map([[excluded.id, new Map([['2026-11-03', {
    date: '2026-11-03', normalHours: 8, he70Hours: 0, he100Hours: 0, tags: [], tagProjectIds: []
  }]])]]), loadEffectiveIndex: async () => new Map(), loadCalendar: async () => ({ holidays: [], holidayDates: new Set() }) };
  const current = id => db.collaborator.findUniqueOrThrow({ where: { id } });
  const change = async (enabled, people = [excluded]) => {
    for (const person of people) await updateReviewParticipation(db, person.id, {
      allocationReviewEnabled: enabled, version: (await current(person.id)).classificationVersion
    }, { actorUserId: admin.id });
  };

  await t.test('novos operacionais começam dispensados sem alterar classificação', async () => {
    const newcomer = await db.collaborator.create({ data: { code: 'new', name: 'Novo', jobRoleId: role.id, isActive: false, terminationDate: date('2025-01-01') } });
    assert.equal(newcomer.allocationReviewEnabled, false);
    assert.equal((await listReviewParticipants(db)).find(item => item.id === newcomer.id).allocationReviewEnabled, false);
    assert.equal((await current(included.id)).workforceClassificationOverride, null);
  });

  const week = await db.allocationReviewWeek.create({ data: { weekStart: date(WEEK), rows: { create: [
    { collaboratorId: included.id, confirmedAt: NOW, days: { create: weekDateKeys(WEEK).map(workDate => ({
      collaboratorId: included.id, workDate: date(workDate), kind: 'SEDE'
    })) } },
    { collaboratorId: excluded.id, days: { create: { collaboratorId: excluded.id, workDate: date(WEEK), kind: 'SEDE' } } }
  ] } } });
  await db.allocationReviewWeek.create({ data: { weekStart: date('2026-10-26'), status: 'CLOSED', rows: { create: {
    collaboratorId: excluded.id, confirmedAt: NOW, days: { create: { collaboratorId: excluded.id, workDate: date('2026-10-26'), kind: 'SEDE' } }
  } } } });
  const confirmedBefore = await loadConfirmedReviewDays({ from: '2026-10-01', to: '2026-12-01' }, db);
  const rowsBefore = await db.allocationReviewRow.findMany({ orderBy: { id: 'asc' } });
  const daysBefore = await db.allocationReviewDay.findMany({ orderBy: { id: 'asc' } });

  await t.test('toggle dispensa sem justificativa, preserva classificação e equipe e registra atividade no Efetivo', async () => {
    const plan = await db.efetivoPlan.create({ data: { name: 'Oficial', kind: 'OFFICIAL', status: 'ACTIVE' } });
    const project = await db.project.create({ data: { code: 'participation', name: 'Projeto', clientName: 'Cliente', clientCnpj: '00000000000000', contractCode: 'test', location: 'Sede' } });
    const mission = await db.efetivoMissionPlan.create({ data: { planId: plan.id, projectId: project.id,
      headquartersResponsibleUserId: admin.id, headquartersResponsibleName: admin.name, headquartersResponsibleRole: 'Gestor',
      mobilizationDate: date('2030-01-01'), executionStartDate: date('2030-01-01'), executionEndDate: date('2030-01-02'), returnDate: date('2030-01-02'),
      allocations: { create: { collaboratorId: excluded.id, jobRoleId: role.id, jobRoleNameSnapshot: role.name } }
    } });
    await change(false);
    const person = await current(excluded.id);
    assert.equal(person.allocationReviewEnabled, false);
    assert.equal(person.workforceClassificationOverride, null);
    assert.equal(person.workforceSector, 'Campo');
    assert.equal((await listReviewParticipants(db)).find(item => item.id === excluded.id).allocationReviewEnabled, false);
    assert.ok((await listCollaboratorsWithCurrentJobRole(db)).some(item => item.id === excluded.id));
    assert.equal((await db.efetivoMissionPlan.findUniqueOrThrow({ where: { id: mission.id } })).needsReplanning, false);
    assert.equal(await db.efetivoMissionAllocation.count({ where: { missionId: mission.id } }), 1);
    const event = await db.efetivoAuditEvent.findFirstOrThrow({ where: { entityId: excluded.id } });
    assert.equal(event.actorUserId, admin.id);
    assert.ok(event.summary.includes(excluded.name));
    assert.equal(event.beforeData.allocationReviewEnabled, true);
    assert.equal(event.afterData.allocationReviewEnabled, false);
    const version = person.classificationVersion;
    const auditCount = await db.efetivoAuditEvent.count();
    await change(false);
    assert.equal((await current(excluded.id)).classificationVersion, version);
    assert.equal(await db.efetivoAuditEvent.count(), auditCount);
  });

  await t.test('semanas e mês excluem dispensados mesmo com ponto e rascunho; fechamento considera só participantes', async () => {
    const result = await getReviewWeek({ weekStart: WEEK, now: NOW }, deps);
    assert.deepEqual(result.rows.map(row => row.collaborator.id), [included.id]);
    assert.equal(result.summary.totalRows, 1);
    assert.equal(result.week.canClose, true);
    const month = await getReviewMonth({ yearMonth: '2026-11', now: NOW }, deps);
    assert.deepEqual(month.rows.map(row => row.collaborator.id), [included.id]);
    const explicit = await loadReviewWeekContext({ weekStart: WEEK, collaboratorIds: [excluded.id] }, deps);
    assert.deepEqual(explicit.collaborators, []);
    assert.deepEqual(await db.allocationReviewRow.findMany({ orderBy: { id: 'asc' } }), rowsBefore);
    assert.deepEqual(await db.allocationReviewDay.findMany({ orderBy: { id: 'asc' } }), daysBefore);
    assert.deepEqual(await loadConfirmedReviewDays({ from: '2026-10-01', to: '2026-12-01' }, db), confirmedBefore);
  });

  await t.test('requisições de telas antigas não editam nem confirmam dispensados', async () => {
    const args = { weekStart: WEEK, expectedVersion: week.version, now: NOW, user: admin };
    const items = [{ collaboratorId: excluded.id, date: WEEK, kind: 'SEDE', projectIds: [] }];
    for (const write of [
      () => saveReviewDays({ ...args, items }, deps),
      () => discardReviewDays({ ...args, items }, deps),
      () => confirmReviewRows({ ...args, collaboratorIds: [excluded.id] }, deps),
      () => unconfirmReviewRows({ ...args, collaboratorIds: [excluded.id] }, deps)
    ]) await assert.rejects(write, error => error.code === 'COLLABORATOR_NOT_ACTIVE');
    assert.equal((await db.allocationReviewWeek.findUniqueOrThrow({ where: { id: week.id } })).version, week.version);
    await closeReviewWeek(args, deps);
    assert.equal((await db.allocationReviewWeek.findUniqueOrThrow({ where: { id: week.id } })).status, 'CLOSED');
  });

  await t.test('exportação ao RH mantém dias salvos e sugestões de pessoas dispensadas', async () => {
    const output = await listReviewAllocations(db, { from: WEEK, to: '2026-11-08', collaboratorId: excluded.id }, {
      scopes: new Set([ALLOCATION_REVIEW_SCOPE]), projectAccessMode: 'ALL', maxPageSize: 100,
      cursorKey: 'participation-test-key-at-least-32-characters', credentialId: 'test', snapshotAt: NOW
    }, deps);
    assert.ok(output.items.some(day => day.date === WEEK && day.collaborator.id === excluded.id));
    assert.ok(output.items.some(day => day.date === '2026-11-03' && day.id.startsWith('automatic:') && day.collaborator.id === excluded.id));
  });

  await t.test('toggle exige booleano e versão, aceita corpo sem motivo e reinclusão recupera o rascunho', async () => {
    const base = { version: 2 };
    for (const input of [base, { ...base, allocationReviewEnabled: 'false' }, { allocationReviewEnabled: false }]) {
      assert.equal(participationInputSchema.safeParse(input).success, false);
    }
    assert.equal(participationInputSchema.safeParse({ ...base, allocationReviewEnabled: false }).success, true);
    await assert.rejects(() => updateReviewParticipation(db, excluded.id, { version: 999, allocationReviewEnabled: true }), error => error.code === 'PARTICIPATION_VERSION_CONFLICT');
    assert.equal((await current(included.id)).allocationReviewEnabled, true);
    await change(true, [included, excluded]);
    const result = await getReviewWeek({ weekStart: WEEK, now: NOW }, deps);
    const restored = result.rows.find(row => row.collaborator.id === excluded.id);
    assert.equal(restored.days[0].saved, true);
    assert.equal(restored.days[0].value.kind, 'SEDE');
    assert.equal((await current(excluded.id)).workforceClassificationOverride, null);
  });

  await t.test('HTTP do Efetivo exige gestão para alterar participação sem justificativa', async () => {
    const original = prisma.userSession.findUnique;
    prisma.userSession.findUnique = args => db.userSession.findUnique(args);
    t.after(() => { prisma.userSession.findUnique = original; });
    const users = await Promise.all([
      ['viewer', 'EFETIVO_VIEWER'], ['manager', 'EFETIVO_MANAGER'], ['reviewer', 'EFETIVO_ALLOCATION_REVIEW']
    ].map(([name, role]) => db.user.create({ data: { username: `participation-${name}`, name, passwordHash: 'test', role: 'COLLABORATOR', accountType: 'INTERNAL', moduleRoles: { create: { module: 'EFETIVO', role } } } })));
    for (const [user, token] of [[admin, 'admin-token'], ...users.map(user => [user, `${user.name}-token`])]) {
      await db.userSession.create({ data: { userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 3600000) } });
    }
    const app = express(); app.use(express.json());
    app.use('/efetivo/administracao/conferencia/colaboradores', requireAuth, createReviewParticipationRouter({ database: db }));
    app.use((error, _req, res, _next) => res.status(error.name === 'ZodError' ? 400 : error.statusCode || error.status || 500).json({ code: error.code }));
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const url = `http://127.0.0.1:${server.address().port}/efetivo/administracao/conferencia/colaboradores/${excluded.id}`;
    const body = { version: (await current(excluded.id)).classificationVersion, allocationReviewEnabled: false };
    const patch = token => fetch(url, { method: 'PATCH', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await patch('')).status, 401);
    assert.equal((await patch('viewer-token')).status, 403);
    assert.equal((await patch('reviewer-token')).status, 403);
    assert.equal((await fetch(url.replace(`/${excluded.id}`, ''), { headers: { Authorization: 'Bearer viewer-token' } })).status, 200);
    assert.equal((await current(excluded.id)).allocationReviewEnabled, true);
    assert.equal((await patch('manager-token')).status, 200);
    assert.equal((await current(excluded.id)).allocationReviewEnabled, false);
    assert.equal((await patch('admin-token')).status, 409);
    body.version = (await current(excluded.id)).classificationVersion;
    body.allocationReviewEnabled = true;
    assert.equal((await patch('admin-token')).status, 200);
  });
});
