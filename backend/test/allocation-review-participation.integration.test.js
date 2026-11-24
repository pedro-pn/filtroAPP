import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import express from 'express';
import { apiSimulationDatabase } from './helpers/api-simulation-db.js';
import prisma from '../src/lib/prisma.js';
import { createWorkforceClassificationRouter } from '../src/routes/resources/workforce-classification.js';
import { listWorkforce, updateWorkforceBatch, workforceBatchInput } from '../src/lib/collaborators/workforce-classification.js';
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
    code: name, name, jobRoleId: role.id, workforceSector: 'Campo', admissionDate: date('2026-01-01')
  } })));
  const admin = await db.user.create({ data: { username: 'participation-admin', name: 'Administrador', passwordHash: 'test', role: 'MANAGER', accountType: 'ADMIN' } });
  const deps = { database: db, getTrails: async () => new Map([[excluded.id, new Map([['2026-11-03', {
    date: '2026-11-03', normalHours: 8, he70Hours: 0, he100Hours: 0, tags: [], tagProjectIds: []
  }]])]]), loadEffectiveIndex: async () => new Map(), loadCalendar: async () => ({ holidays: [], holidayDates: new Set() }) };
  const current = id => db.collaborator.findUniqueOrThrow({ where: { id } });
  const change = async (enabled, people = [excluded]) => updateWorkforceBatch(db, {
    items: await Promise.all(people.map(async person => ({ id: person.id, version: (await current(person.id)).classificationVersion }))),
    allocationReviewEnabled: enabled, reason: 'Revisão da participação na conferência.'
  }, admin.id);

  await t.test('migração habilita existentes e novos sem alterar classificação', async () => {
    await database.db.exec('ALTER TABLE "Collaborator" DROP COLUMN "allocationReviewEnabled";');
    await database.db.exec(await readFile(new URL('../prisma/migrations/20261124150000_allocation_review_participation/migration.sql', import.meta.url), 'utf8'));
    assert.equal((await current(included.id)).allocationReviewEnabled, true);
    const newcomer = await db.collaborator.create({ data: { code: 'new', name: 'Novo', jobRoleId: role.id, isActive: false, terminationDate: date('2025-01-01') } });
    assert.equal(newcomer.allocationReviewEnabled, true);
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

  await t.test('dispensa preserva classificação e equipe, registra motivo e não sinaliza missões para revisão', async () => {
    const plan = await db.efetivoPlan.create({ data: { name: 'Oficial', kind: 'OFFICIAL', status: 'ACTIVE' } });
    const project = await db.project.create({ data: { code: 'participation', name: 'Projeto', clientName: 'Cliente', clientCnpj: '00000000000000', contractCode: 'test', location: 'Sede' } });
    const mission = await db.efetivoMissionPlan.create({ data: { planId: plan.id, projectId: project.id,
      headquartersResponsibleUserId: admin.id, headquartersResponsibleName: admin.name, headquartersResponsibleRole: 'Gestor',
      mobilizationDate: date('2030-01-01'), executionStartDate: date('2030-01-01'), executionEndDate: date('2030-01-02'), returnDate: date('2030-01-02'),
      allocations: { create: { collaboratorId: excluded.id, jobRoleId: role.id, jobRoleNameSnapshot: role.name } }
    } });
    const result = await change(false);
    assert.deepEqual(result.affectedMissionIds, []);
    const person = await current(excluded.id);
    assert.equal(person.allocationReviewEnabled, false);
    assert.equal(person.workforceClassificationOverride, null);
    assert.equal(person.workforceSector, 'Campo');
    assert.equal((await listWorkforce(db, {})).items.find(item => item.id === excluded.id).allocationReviewEnabled, false);
    assert.ok((await listCollaboratorsWithCurrentJobRole(db)).some(item => item.id === excluded.id));
    assert.equal((await db.efetivoMissionPlan.findUniqueOrThrow({ where: { id: mission.id } })).needsReplanning, false);
    assert.equal(await db.efetivoMissionAllocation.count({ where: { missionId: mission.id } }), 1);
    const event = await db.workforceClassificationEvent.findFirstOrThrow({ where: { entityId: excluded.id } });
    assert.equal(event.actorUserId, admin.id);
    assert.equal(event.reason, 'Revisão da participação na conferência.');
    assert.equal(event.before.allocationReviewEnabled, true);
    assert.equal(event.after.allocationReviewEnabled, false);
    assert.equal(event.after.classification, event.before.classification);
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

  await t.test('lote exige alteração, booleano, motivo e versão; conflito reverte tudo; reinclusão recupera o rascunho', async () => {
    const base = { items: [{ id: excluded.id, version: 2 }], reason: 'Revisão.' };
    for (const input of [base, { ...base, allocationReviewEnabled: 'false' }, { ...base, allocationReviewEnabled: false, reason: '' }]) {
      assert.equal(workforceBatchInput.safeParse(input).success, false);
    }
    await assert.rejects(() => updateWorkforceBatch(db, { items: [{ id: included.id, version: 1 }, { id: excluded.id, version: 999 }],
      allocationReviewEnabled: false, reason: 'Lote com conflito.' }, admin.id), error => error.code === 'CLASSIFICATION_VERSION_CONFLICT');
    assert.equal((await current(included.id)).allocationReviewEnabled, true);
    await change(true, [included, excluded]);
    const result = await getReviewWeek({ weekStart: WEEK, now: NOW }, deps);
    const restored = result.rows.find(row => row.collaborator.id === excluded.id);
    assert.equal(restored.days[0].saved, true);
    assert.equal(restored.days[0].value.kind, 'SEDE');
    assert.equal((await current(excluded.id)).workforceClassificationOverride, null);
  });

  await t.test('HTTP permite alterar participação só para administrador e aplica a auditoria', async () => {
    const original = prisma.userSession.findUnique;
    prisma.userSession.findUnique = args => db.userSession.findUnique(args);
    t.after(() => { prisma.userSession.findUnique = original; });
    const viewer = await db.user.create({ data: { username: 'participation-viewer', name: 'Leitor', passwordHash: 'test', role: 'COLLABORATOR', accountType: 'INTERNAL' } });
    for (const [user, token] of [[admin, 'admin-token'], [viewer, 'viewer-token']]) {
      await db.userSession.create({ data: { userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 3600000) } });
    }
    const app = express(); app.use(express.json());
    app.use('/admin', createWorkforceClassificationRouter({ database: db }));
    app.use((error, _req, res, _next) => res.status(error.name === 'ZodError' ? 400 : error.statusCode || error.status || 500).json({ code: error.code }));
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const url = `http://127.0.0.1:${server.address().port}/admin/collaborators`;
    const body = { items: [{ id: excluded.id, version: (await current(excluded.id)).classificationVersion }], allocationReviewEnabled: false, reason: 'Dispensa pelo administrador.' };
    const patch = token => fetch(url, { method: 'PATCH', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await patch('')).status, 401);
    assert.equal((await patch('viewer-token')).status, 403);
    assert.equal((await current(excluded.id)).allocationReviewEnabled, true);
    assert.equal((await patch('admin-token')).status, 200);
    assert.equal((await current(excluded.id)).allocationReviewEnabled, false);
    assert.equal((await patch('admin-token')).status, 409);
  });
});
