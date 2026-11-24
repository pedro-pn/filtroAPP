import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import express from 'express';
import { corporateToday } from '../../shared/modules/mission-weekly-progress.js';
import { apiSimulationDatabase } from './helpers/api-simulation-db.js';
import prisma from '../src/lib/prisma.js';
import { requireAuth } from '../src/middleware/auth.js';
import { createWorkforceClassificationRouter } from '../src/routes/resources/workforce-classification.js';
import { listWorkforce, updateWorkforceBatch, updateWorkforceRole } from '../src/lib/collaborators/workforce-classification.js';
import { operationalCollaboratorWhere, isOperationalCollaborator } from '../src/lib/collaborators/workforce-policy.js';
import { requireOperationalRequestParticipants } from '../src/lib/collaborators/request-workforce-policy.js';
import { receiveConectaEvent } from '../src/lib/conecta-rh/service.js';
import { listCollaboratorsWithCurrentJobRole } from '../src/lib/collaborators/job-role-service.js';
import { deriveSelectedMissionTeam } from '../src/lib/efetivo/planning/mission-team.js';
import { loadConfirmedReviewDays } from '../src/lib/efetivo/allocation-review/confirmed-days.js';
import { listReviewAllocations, ALLOCATION_REVIEW_SCOPE } from '../src/lib/api-credentials/allocation-review.js';
import { reportCollaboratorCreateManyData } from '../src/lib/report-collaborators.js';
import { updateReviewParticipation } from '../src/lib/efetivo/allocation-review/participation.js';

test('classificação central: herança, exceções, RH, HTTP, migração e histórico em PostgreSQL real', { timeout: 180000 }, async t => {
  const database = await apiSimulationDatabase();
  t.after(() => database.close());
  const db = database.client;
  const opRole = await db.jobRole.create({ data: { name: 'Operador', normalizedKey: 'operador', workforceClassification: 'OPERATIONAL' } });
  const adminRole = await db.jobRole.create({ data: { name: 'Administrativo', normalizedKey: 'administrativo', isOperational: false, workforceClassification: 'NON_OPERATIONAL' } });
  const person = (code, jobRoleId, extra = {}) => db.collaborator.create({ data: { code, name: code, jobRoleId, ...extra } });
  const [operator, administrative, exception, blocked, pending] = await Promise.all([
    person('operator', opRole.id), person('administrative', adminRole.id, { sourceIsOperational: false }),
    person('exception', adminRole.id, { workforceClassificationOverride: 'OPERATIONAL' }),
    person('blocked', opRole.id, { workforceClassificationOverride: 'NON_OPERATIONAL' }),
    person('pending', opRole.id, { workforceClassificationOverride: 'PENDING' })
  ]);
  const adminUser = await db.user.create({ data: { username: 'workforce-admin', name: 'Admin da classificação', passwordHash: 'synthetic', role: 'MANAGER', accountType: 'ADMIN' } });

  await t.test('seletores compartilham a política: exceção individual tem precedência, vínculo continua independente', async () => {
    const visible = await listCollaboratorsWithCurrentJobRole(db);
    assert.deepEqual(visible.map(item => item.code).sort(), ['exception', 'operator']);
    const all = await listWorkforce(db, {});
    assert.equal(all.total, 5);
    assert.equal(all.items.find(item => item.id === pending.id).isActive, true);
    assert.equal(all.items.find(item => item.id === exception.id).classificationSource, 'COLLABORATOR');
    assert.equal((await listWorkforce(db, { classification: 'NON_OPERATIONAL' })).total, 2);
    assert.equal((await listWorkforce(db, { classification: 'PENDING' })).total, 1);
    const teamPerson = await db.collaborator.findUnique({ where: { id: exception.id }, include: { jobRole: true } });
    assert.equal(deriveSelectedMissionTeam([teamPerson], 'CONFIRMED').allocations[0].collaboratorId, exception.id);
    assert.throws(() => deriveSelectedMissionTeam([{ ...teamPerson, workforceClassificationOverride: 'PENDING' }]), error => error.code === 'COLLABORATOR_NOT_VISIBLE');
    assert.equal(isOperationalCollaborator({ ...teamPerson, workforceClassificationOverride: null }), false);
    await assert.rejects(() => reportCollaboratorCreateManyData(db, [administrative.id]), error => error.code === 'COLLABORATOR_NOT_VISIBLE');
  });

  const companyId = randomUUID(), externalRoleId = randomUUID(), personId = randomUUID(), employmentId = randomUUID();
  const envelope = (aggregateType, data, revision = 1) => ({ schemaVersion: '1.0', companyId, eventId: randomUUID(),
    eventType: `${aggregateType}.upserted`, aggregateType, aggregateId: aggregateType === 'employment' ? data.employmentId : data.id,
    revision, occurredAt: new Date().toISOString(), data });
  const receive = input => receiveConectaEvent(db, input, { companyId, idempotencyKey: input.eventId });
  const roleData = { id: externalRoleId, name: 'Cargo recebido do RH', isActive: true, isOperational: false, cbo: null };
  const employment = { employmentId, personId, name: 'Pessoa recebida do RH', cpf: null, registrationNumber: null,
    email: null, isOperational: false, status: 'ACTIVE', admissionDate: '2026-01-01', terminationDate: null, currentJobRoleId: externalRoleId };
  let rhPerson, rhRole;
  await t.test('cargo novo aguarda revisão; vínculo e revisões nunca promovem o cargo nem desfazem decisão local', async () => {
    await receive(envelope('job_role', roleData));
    await receive(envelope('employment', employment));
    rhPerson = await db.collaborator.findFirstOrThrow({ where: { rhEmploymentId: employmentId } });
    rhRole = await db.jobRole.findUniqueOrThrow({ where: { id: rhPerson.jobRoleId } });
    assert.equal(rhPerson.sourceIsOperational, false);
    assert.equal(rhPerson.isActive, true);
    assert.equal(rhRole.isOperational, false);
    assert.equal(rhRole.workforceClassification, 'PENDING');
    await updateWorkforceRole(db, rhRole.id, { classification: 'NON_OPERATIONAL', version: 1, reason: 'Cargo administrativo confirmado.' }, adminUser.id);
    await receive(envelope('job_role', { ...roleData, isOperational: true }, 2));
    await receive(envelope('employment', { ...employment, isOperational: true }, 2));
    rhRole = await db.jobRole.findUniqueOrThrow({ where: { id: rhRole.id } });
    assert.equal(rhRole.workforceClassification, 'NON_OPERATIONAL');
    assert.equal(rhRole.isOperational, false);
    assert.equal(rhRole.sourceIsOperational, true);
    assert.ok((await listWorkforce(db, { divergence: 'true' })).items.some(item => item.id === rhPerson.id));
  });

  await t.test('lote é atômico, exige versão e motivo, registra auditoria e permite voltar a herdar o cargo', async () => {
    await assert.rejects(() => updateWorkforceBatch(db, { items: [{ id: administrative.id, version: 1 }, { id: blocked.id, version: 999 }],
      classification: 'OPERATIONAL', reason: 'Revisão em lote.' }, adminUser.id), error => error.code === 'CLASSIFICATION_VERSION_CONFLICT');
    assert.equal((await db.collaborator.findUniqueOrThrow({ where: { id: administrative.id } })).classificationVersion, 1);
    assert.equal(await db.workforceClassificationEvent.count({ where: { entityType: 'COLLABORATOR' } }), 0);
    await updateWorkforceBatch(db, { items: [{ id: administrative.id, version: 1 }], classification: 'OPERATIONAL', sector: 'Engenharia', reason: 'Pessoa liberada para campo.' }, adminUser.id);
    assert.ok((await db.collaborator.findMany({ where: operationalCollaboratorWhere() })).some(item => item.id === administrative.id));
    assert.equal((await listWorkforce(db, { sector: 'engenharia' })).total, 1);
    await updateWorkforceBatch(db, { items: [{ id: administrative.id, version: 2 }], classification: null, reason: 'Retorno ao padrão administrativo.' }, adminUser.id);
    assert.equal((await db.collaborator.findUniqueOrThrow({ where: { id: administrative.id } })).workforceClassificationOverride, null);
    const events = await db.workforceClassificationEvent.findMany({ where: { entityId: administrative.id } });
    assert.equal(events.length, 2);
    assert.ok(events.every(item => item.actorUserId === adminUser.id));
    await assert.rejects(() => updateWorkforceBatch(db, { items: [{ id: operator.id, version: 1 }], classification: 'NON_OPERATIONAL', reason: '' }, adminUser.id), error => error.name === 'ZodError');
  });

  await t.test('vínculo novo não operacional em cargo operacional aguarda revisão; decisão individual também sobrevive a revisões', async () => {
    const mappedRoleId = randomUUID();
    await receive(envelope('job_role', { ...roleData, id: mappedRoleId, name: opRole.name }));
    const mixedEmployment = { ...employment, personId: randomUUID(), employmentId: randomUUID(), currentJobRoleId: mappedRoleId };
    await receive(envelope('employment', mixedEmployment));
    const mixed = await db.collaborator.findFirstOrThrow({ where: { rhEmploymentId: mixedEmployment.employmentId }, include: { jobRole: true } });
    assert.equal(mixed.jobRole.workforceClassification, 'OPERATIONAL');
    assert.equal(mixed.workforceClassificationOverride, 'PENDING');
    assert.equal(isOperationalCollaborator(mixed), false);
    const currentPerson = await db.collaborator.findUniqueOrThrow({ where: { id: rhPerson.id } });
    await updateWorkforceBatch(db, { items: [{ id: rhPerson.id, version: currentPerson.classificationVersion }], classification: 'OPERATIONAL', reason: 'Liberação individual revisada.' }, adminUser.id);
    await updateReviewParticipation(db, rhPerson.id, { allocationReviewEnabled: true, version: currentPerson.classificationVersion + 1 }, { actorUserId: adminUser.id });
    await updateReviewParticipation(db, rhPerson.id, { allocationReviewEnabled: false, version: currentPerson.classificationVersion + 2 }, { actorUserId: adminUser.id });
    await receive(envelope('employment', employment, 3));
    assert.equal((await db.collaborator.findUniqueOrThrow({ where: { id: rhPerson.id } })).workforceClassificationOverride, 'OPERATIONAL');
    assert.equal((await db.collaborator.findUniqueOrThrow({ where: { id: rhPerson.id } })).allocationReviewEnabled, false);
  });

  await t.test('reclassificação inclui missão terminando hoje sem excluir equipe nem dias conferidos; exportação operacional respeita a restrição', async () => {
    const plan = await db.efetivoPlan.create({ data: { name: 'Oficial', kind: 'OFFICIAL', status: 'ACTIVE' } });
    const project = await db.project.create({ data: { code: 'workforce-project', name: 'Projeto de teste', clientName: 'Teste', clientCnpj: '00000000000000', contractCode: 'teste', location: 'Teste' } });
    const future = new Date(`${corporateToday()}T00:00:00.000Z`);
    const mission = await db.efetivoMissionPlan.create({ data: { planId: plan.id, projectId: project.id,
      headquartersResponsibleUserId: adminUser.id, headquartersResponsibleName: 'Admin', headquartersResponsibleRole: 'Gestor',
      mobilizationDate: future, executionStartDate: future, executionEndDate: future, returnDate: future,
      allocations: { create: { collaboratorId: operator.id, jobRoleId: opRole.id, jobRoleNameSnapshot: opRole.name } }
    } });
    const week = await db.allocationReviewWeek.create({ data: { weekStart: new Date('2026-11-02T00:00:00Z'), rows: {
      create: { collaboratorId: operator.id, confirmedAt: new Date(), days: { create: {
        collaboratorId: operator.id, workDate: new Date('2026-11-03T00:00:00Z'), kind: 'SEDE'
      } } }
    } } });
    const changed = await updateWorkforceRole(db, opRole.id, { classification: 'NON_OPERATIONAL', version: 1, reason: 'Revisão do cargo.' }, adminUser.id);
    assert.deepEqual(changed.affectedMissionIds, [mission.id]);
    await assert.rejects(() => updateWorkforceBatch(db, { items: [{ id: operator.id, version: operator.classificationVersion }], classification: 'OPERATIONAL', reason: 'Formulário anterior à mudança do cargo.' }, adminUser.id), error => error.code === 'CLASSIFICATION_VERSION_CONFLICT');
    assert.equal((await db.efetivoMissionPlan.findUniqueOrThrow({ where: { id: mission.id } })).needsReplanning, true);
    assert.equal(await db.efetivoMissionAllocation.count({ where: { missionId: mission.id } }), 1);
    assert.equal((await loadConfirmedReviewDays({ from: '2026-11-01', to: '2026-11-09' }, db)).length, 1);
    const exported = await listReviewAllocations(db, { from: '2026-11-01', to: '2026-11-09' }, {
      scopes: new Set([ALLOCATION_REVIEW_SCOPE]), projectAccessMode: 'ALL', maxPageSize: 100, cursorKey: 'test-classification-key-at-least-32', credentialId: 'test'
    });
    assert.ok(exported.items.length > 0);
    assert.equal(exported.items.some(item => item.collaborator.id === operator.id), false);
    assert.ok(exported.items.every(item => item.confirmationStatus === 'PENDING' && item.confirmedAt === null));
    assert.equal(await db.allocationReviewWeek.count({ where: { id: week.id } }), 1);
  });

  await t.test('HTTP: administração exige admin; inclusão direta e aninhada é bloqueada; EPI e recepção RH continuam permitidos', async () => {
    const previousSession = prisma.userSession.findUnique;
    const previousFindMany = prisma.collaborator.findMany;
    prisma.userSession.findUnique = (...args) => db.userSession.findUnique(...args);
    prisma.collaborator.findMany = (...args) => db.collaborator.findMany(...args);
    t.after(() => { prisma.userSession.findUnique = previousSession; prisma.collaborator.findMany = previousFindMany; });
    const token = 'workforce-admin-token';
    await db.userSession.create({ data: { userId: adminUser.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 3600000) } });
    const viewer = await db.user.create({ data: { username: 'workforce-viewer', name: 'Leitor', passwordHash: 'test', accountType: 'INTERNAL', role: 'COLLABORATOR' } });
    await db.userSession.create({ data: { userId: viewer.id, tokenHash: createHash('sha256').update('viewer-token').digest('hex'), expiresAt: new Date(Date.now() + 3600000) } });
    const app = express(); app.use(express.json());
    app.use('/api/admin/workforce-classification', createWorkforceClassificationRouter({ database: db }));
    app.post('/api/rdo/test', requireAuth, (_req, res) => res.json({ ok: true }));
    app.use((error, _req, res, _next) => res.status(error.statusCode || error.status || 500).json({ code: error.code, error: error.message }));
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = (path, auth = token, body) => fetch(base + path, { method: body ? 'POST' : 'GET', headers: {
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}), 'Content-Type': 'application/json'
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal((await request('/api/admin/workforce-classification/collaborators', '')).status, 401);
    assert.equal((await request('/api/admin/workforce-classification/collaborators', 'viewer-token')).status, 403);
    assert.equal((await request('/api/admin/workforce-classification/collaborators')).status, 200);
    const denied = await request('/api/rdo/test', token, { noturno: { collaboratorIds: [administrative.id] } });
    assert.equal(denied.status, 409);
    assert.equal((await denied.json()).code, 'COLLABORATOR_NOT_VISIBLE');
    for (const path of ['/api/epi/records', '/api/integracoes/v1/rh/conecta/eventos']) {
      await requireOperationalRequestParticipants(db, { method: 'POST', originalUrl: path, body: { collaboratorId: administrative.id } });
    }
    await assert.rejects(() => requireOperationalRequestParticipants(db, { method: 'POST', originalUrl: '/api/integracoes/v1/projetos', body: { operatorId: administrative.id } }), error => error.code === 'COLLABORATOR_NOT_VISIBLE');
  });

  await t.test('migração recupera a classificação original de cargos promovidos e preserva registros existentes', async () => {
    // Reconstruct the pre-migration schema in this disposable database only.
    await db.jobRole.update({ where: { id: rhRole.id }, data: { isOperational: true } });
    await receive(envelope('job_role', { ...roleData, isOperational: false }, 3));
    await receive(envelope('employment', employment, 4));
    const allocationsBefore = await db.efetivoMissionAllocation.count();
    const daysBefore = await db.allocationReviewDay.count();
    await database.db.exec(`DROP TABLE "WorkforceClassificationEvent";
      ALTER TABLE "JobRole" DROP COLUMN "workforceClassification", DROP COLUMN "classificationManagedLocally", DROP COLUMN "sourceIsOperational", DROP COLUMN "classificationVersion";
      ALTER TABLE "Collaborator" DROP COLUMN "workforceClassificationOverride", DROP COLUMN "workforceSector", DROP COLUMN "sourceIsOperational", DROP COLUMN "classificationVersion";
      DROP TYPE "WorkforceClassification";`);
    await database.db.exec(await readFile(new URL('../prisma/migrations/20261118150000_workforce_classification/migration.sql', import.meta.url), 'utf8'));
    const fixedRole = await db.jobRole.findUniqueOrThrow({ where: { id: rhRole.id } });
    const fixedPerson = await db.collaborator.findUniqueOrThrow({ where: { id: rhPerson.id } });
    assert.equal(fixedRole.isOperational, false);
    assert.equal(fixedRole.workforceClassification, 'NON_OPERATIONAL');
    assert.equal(fixedPerson.workforceClassificationOverride, 'NON_OPERATIONAL');
    assert.equal(await db.efetivoMissionAllocation.count(), allocationsBefore);
    assert.equal(await db.allocationReviewDay.count(), daysBefore);
    assert.ok(await db.workforceClassificationEvent.count());
  });
});
