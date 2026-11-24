import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import express from 'express';
import { corporateToday } from '../../shared/modules/mission-weekly-progress.js';
import { apiSimulationDatabase } from './helpers/api-simulation-db.js';
import { defaultWorkforceVisibilityRules } from '../../shared/modules/workforce-visibility.js';
import { getWorkforceVisibility, updateWorkforceVisibility, refreshWorkforceVisibility, WORKFORCE_VISIBILITY_SETTING_KEY } from '../src/lib/collaborators/workforce-visibility.js';
import { withWorkforceVisibility, workforceVisibilityClasses, workforceVisibilityRequestTarget } from '../src/lib/collaborators/workforce-visibility-context.js';
import { collaboratorVisibilityWhere, requireVisibleCollaborators, workforceClassification } from '../src/lib/collaborators/workforce-policy.js';
import { listCollaboratorsWithCurrentJobRole } from '../src/lib/collaborators/job-role-service.js';
import { listPlanningJobRoles } from '../src/lib/efetivo/planning/read-model.js';
import { deriveSelectedMissionTeam } from '../src/lib/efetivo/planning/mission-team.js';
import { listPlanningAbsences } from '../src/lib/efetivo/planning/collaborators.js';
import { collaboratorsCache } from '../src/lib/resource-list-cache.js';
import { createWorkforceClassificationRouter } from '../src/routes/resources/workforce-classification.js';
import epiRouter from '../src/routes/resources/epis.js';
import romaneioRouter from '../src/routes/resources/romaneios.js';
import projectsRouter from '../src/routes/resources/projects.js';
import prisma from '../src/lib/prisma.js';
import { createApiToken } from '../src/lib/api-credentials/token.js';
import { createApiTokenAuthenticator } from '../src/middleware/api-token-auth.js';
import { apiRequestContext, integrationApiBoundary, integrationApiErrorHandler } from '../src/middleware/api-request-context.js';
import { createOperationalRouter } from '../src/routes/integrations/v1/operational.js';
import { ALLOCATION_REVIEW_SCOPE } from '../src/lib/api-credentials/allocation-review.js';
import { executePlaygroundOperation } from '../src/lib/api-credentials/playground.js';

test('visibilidade configurável: persistência, seleção, API, cache, autorização e histórico', { timeout: 180000 }, async t => {
  const database = await apiSimulationDatabase();
  const db = database.client;
  t.after(() => database.close());
  const migration = await readFile(new URL('../prisma/migrations/20261118160000_workforce_visibility/migration.sql', import.meta.url), 'utf8');
  await database.db.exec(migration);
  const people = [];
  for (const value of ['OPERATIONAL', 'NON_OPERATIONAL', 'PENDING']) {
    const role = await db.jobRole.create({ data: { name: value, normalizedKey: value, workforceClassification: value, isOperational: value === 'OPERATIONAL' } });
    people.push(await db.collaborator.create({ data: { code: value, name: value, jobRoleId: role.id }, include: { jobRole: true } }));
  }
  const admin = await db.user.create({ data: { username: 'visibility-admin', name: 'Administrador de visibilidade', passwordHash: 'synthetic', role: 'MANAGER', accountType: 'ADMIN', moduleRoles: { create: [{ module: 'ROMANEIO', role: 'ROMANEIO_MANAGER' }, { module: 'RDO', role: 'RDO_MANAGER' }] } } });
  let configuration = await getWorkforceVisibility(db);
  async function save(rules, reason = 'Regras revisadas pelo administrador.') {
    configuration = await updateWorkforceVisibility(db, { version: configuration.version, rules, reason }, admin.id);
    return configuration;
  }
  const codesFor = target => withWorkforceVisibility(target, async () => (await listCollaboratorsWithCurrentJobRole(db)).map(item => item.code).sort());

  await t.test('migração preserva os padrões atuais e é idempotente sobre a configuração existente', async () => {
    assert.deepEqual(configuration.rules, defaultWorkforceVisibilityRules());
    assert.equal(configuration.version, 1);
    assert.deepEqual(await codesFor('RDO'), ['OPERATIONAL']);
    assert.deepEqual(await codesFor('EPI'), ['NON_OPERATIONAL', 'OPERATIONAL', 'PENDING']);
    for (const [path, target] of [
      ['/api/epi/collaborators', 'EPI'], ['/epi/collaborators', 'EPI'], ['/api/efetivo/planning/collaborators', 'EFETIVO'],
      ['/api/efetivo/conferencia-alocacao/month', 'ALLOCATION_REVIEW'], ['/api/efetivo/produtividade', 'PRODUCTIVITY'],
      ['/api/integracoes/v1/colaboradores', 'API'], ['/api/acompanhamento/ponto', 'ACOMPANHAMENTO']
    ]) assert.equal(workforceVisibilityRequestTarget({ originalUrl: path }), target);
  });

  await t.test('cada listagem aplica sua própria seleção, inclusive nenhuma classificação, sem reclassificar pessoas', async () => {
    const rules = { ...configuration.rules, RDO: ['OPERATIONAL', 'NON_OPERATIONAL'], EFETIVO: ['NON_OPERATIONAL'], ALLOCATION_REVIEW: ['PENDING'], EPI: ['OPERATIONAL'] };
    await save(rules);
    assert.deepEqual(await codesFor('RDO'), ['NON_OPERATIONAL', 'OPERATIONAL']);
    assert.deepEqual(await codesFor('EFETIVO'), ['NON_OPERATIONAL']);
    assert.deepEqual(await codesFor('ALLOCATION_REVIEW'), ['OPERATIONAL']);
    assert.deepEqual(await codesFor('EPI'), ['OPERATIONAL']);
    await withWorkforceVisibility('RDO', () => requireVisibleCollaborators(db, [people[1].id]));
    assert.equal(withWorkforceVisibility('EFETIVO', () => deriveSelectedMissionTeam([people[1]], 'CONFIRMED')).allocations[0].collaboratorId, people[1].id);
    await assert.rejects(() => withWorkforceVisibility('EFETIVO', () => requireVisibleCollaborators(db, [people[0].id])), error => error.code === 'COLLABORATOR_NOT_VISIBLE');
    const roles = await withWorkforceVisibility('EFETIVO', () => listPlanningJobRoles({ database: db }));
    assert.equal(roles.find(item => item.name === 'NON_OPERATIONAL').isDefaultVisibleInWorkforce, true);
    assert.equal(roles.find(item => item.name === 'OPERATIONAL').isAvailableInWorkforce, false);
    assert.deepEqual((await db.collaborator.findMany({ include: { jobRole: true }, orderBy: { code: 'asc' } })).map(workforceClassification), ['NON_OPERATIONAL', 'OPERATIONAL', 'PENDING']);
    await save({ ...configuration.rules, RDO: [] });
    assert.deepEqual(await codesFor('RDO'), []);
    await assert.rejects(() => withWorkforceVisibility('RDO', () => requireVisibleCollaborators(db, [people[0].id])), error => error.code === 'COLLABORATOR_NOT_VISIBLE');
  });

  await t.test('restrição da matriz sinaliza missões em andamento sem apagar equipes nem indisponibilidades', async () => {
    const plan = await db.efetivoPlan.create({ data: { name: 'Oficial', kind: 'OFFICIAL', status: 'ACTIVE' } });
    const project = await db.project.create({ data: { code: 'visibility-project', name: 'Visibilidade', clientName: 'Teste', clientCnpj: '00000000000000', contractCode: 'teste', location: 'Teste' } });
    const date = new Date(`${corporateToday()}T00:00:00.000Z`);
    const mission = await db.efetivoMissionPlan.create({ data: {
      planId: plan.id, projectId: project.id, headquartersResponsibleUserId: admin.id,
      headquartersResponsibleName: admin.name, headquartersResponsibleRole: 'Gestor',
      mobilizationDate: date, executionStartDate: date, executionEndDate: date, returnDate: date,
      allocations: { create: { collaboratorId: people[1].id, jobRoleId: people[1].jobRoleId, jobRoleNameSnapshot: people[1].jobRole.name } }
    } });
    await db.collaboratorAbsence.create({ data: { collaboratorId: people[1].id, type: 'FERIAS', startDate: date, endDate: date } });
    const absences = () => withWorkforceVisibility('EFETIVO', () => listPlanningAbsences({}, { database: db }));
    assert.equal((await absences()).length, 1);
    const result = await save({ ...configuration.rules, EFETIVO: [] });
    assert.deepEqual(result.affectedMissionIds, [mission.id]);
    assert.equal((await db.efetivoMissionPlan.findUniqueOrThrow({ where: { id: mission.id } })).needsReplanning, true);
    assert.equal(await db.efetivoMissionAllocation.count({ where: { missionId: mission.id } }), 1);
    assert.equal(await db.collaboratorAbsence.count(), 1);
    assert.deepEqual(await absences(), []);
  });

  await t.test('conflito de versão e entradas inválidas não alteram a matriz nem criam auditoria parcial', async () => {
    const count = await db.workforceClassificationEvent.count();
    const before = await getWorkforceVisibility(db);
    await assert.rejects(() => updateWorkforceVisibility(db, { version: 1, rules: defaultWorkforceVisibilityRules(), reason: 'Formulário desatualizado.' }, admin.id), error => error.code === 'VISIBILITY_VERSION_CONFLICT');
    for (const rules of [
      { ...before.rules, RDO: ['UNKNOWN'] }, { ...before.rules, RDO: ['OPERATIONAL', 'OPERATIONAL'] },
      { RDO: ['OPERATIONAL'] }, { ...before.rules, UNKNOWN: ['OPERATIONAL'] }
    ]) await assert.rejects(() => updateWorkforceVisibility(db, { version: before.version, rules, reason: 'Configuração inválida.' }, admin.id), error => error.name === 'ZodError');
    assert.deepEqual((await getWorkforceVisibility(db)).rules, before.rules);
    assert.equal(await db.workforceClassificationEvent.count(), count);
    await database.db.exec(migration);
    assert.deepEqual((await getWorkforceVisibility(db)).rules, before.rules);
    const concurrent = await Promise.allSettled(['Primeira revisão concorrente.', 'Segunda revisão concorrente.'].map(reason =>
      updateWorkforceVisibility(db, { version: before.version, rules: before.rules, reason }, admin.id)));
    assert.equal(concurrent.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(concurrent.find(item => item.status === 'rejected').reason.code, 'VISIBILITY_VERSION_CONFLICT');
    configuration = await getWorkforceVisibility(db);
    assert.equal(configuration.version, before.version + 1);
    assert.equal(await db.workforceClassificationEvent.count(), count + 1);
  });

  await t.test('caches são separados por módulo e versão; requisição iniciada preserva seu próprio snapshot', async () => {
    await save({ ...configuration.rules, RDO: ['OPERATIONAL', 'NON_OPERATIONAL'], EPI: ['OPERATIONAL'] });
    const cachedCodes = target => withWorkforceVisibility(target, () => collaboratorsCache.get(async () => (await db.collaborator.findMany({ where: collaboratorVisibilityWhere() })).map(item => item.code).sort()));
    assert.deepEqual(await cachedCodes('RDO'), ['NON_OPERATIONAL', 'OPERATIONAL']);
    assert.deepEqual(await cachedCodes('EPI'), ['OPERATIONAL']);
    await withWorkforceVisibility('RDO', async () => {
      assert.deepEqual(workforceVisibilityClasses(), ['OPERATIONAL', 'NON_OPERATIONAL']);
      await save({ ...configuration.rules, RDO: ['PENDING'] });
      assert.deepEqual(workforceVisibilityClasses(), ['OPERATIONAL', 'NON_OPERATIONAL']);
    });
    assert.deepEqual(await cachedCodes('RDO'), ['PENDING']);
    // Simulates another process saving the next version, then the refresh poll.
    await db.efetivoSetting.update({ where: { key: WORKFORCE_VISIBILITY_SETTING_KEY }, data: {
      numberValue: configuration.version + 1, textValue: JSON.stringify({ ...configuration.rules, RDO: ['NON_OPERATIONAL'] })
    } });
    configuration = await refreshWorkforceVisibility(db);
    assert.deepEqual(await cachedCodes('RDO'), ['NON_OPERATIONAL']);
  });

  await t.test('API Bearer usa a regra de integrações e invalida o cursor se essa regra mudar', async () => {
    await save({ ...configuration.rules, API: ['OPERATIONAL', 'NON_OPERATIONAL'], RDO: [] });
    const key = 'synthetic-visibility-token-key-at-least-32';
    const token = createApiToken({ key });
    const credential = await db.apiCredential.create({ data: {
      selector: token.selector, secretVerifier: token.verifier, secretLastFour: token.secretLastFour, hashKeyVersion: 1,
      name: 'Visibilidade teste', purpose: 'Teste de regra de classificação', recipientName: 'Teste', startsAt: new Date(0),
      projectAccessMode: 'ALL', createdByUserId: admin.id, issuanceRequestId: randomUUID(), requestsPerMinute: 600,
      scopes: { create: ['colaboradores.operacional.read', ALLOCATION_REVIEW_SCOPE].map(scopeCode => ({ scopeCode, grantedByUserId: admin.id })) }
    } });
    const envConfig = { apiTokenGlobalMaxPageSize: 500, apiTokenHashKeys: { 1: key }, apiTokenActiveKeyVersion: 1 };
    const app = express();
    app.use(apiRequestContext(), integrationApiBoundary());
    app.use(createApiTokenAuthenticator({ prismaClient: db, envConfig }));
    app.use('/api/integracoes/v1', createOperationalRouter({ prismaClient: db, envConfig }));
    app.use(integrationApiErrorHandler);
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const url = `http://127.0.0.1:${server.address().port}/api/integracoes/v1/colaboradores`;
    const request = async query => {
      const response = await fetch(`${url}?${new URLSearchParams(query)}`, { headers: { Authorization: `Bearer ${token.token}` } });
      return { status: response.status, body: await response.json() };
    };
    const all = await request({ limit: '100' });
    assert.equal(all.status, 200, JSON.stringify(all.body));
    assert.deepEqual(all.body.items.map(item => item.code).sort(), ['NON_OPERATIONAL', 'OPERATIONAL']);
    const preview = await withWorkforceVisibility('RDO', () => executePlaygroundOperation(db, credential.id, {
      operationId: 'operational.Collaborator.list', pathParams: {}, query: { limit: 10 }
    }, { actorUserId: admin.id, envConfig, cursorKey: key }));
    assert.deepEqual(preview.response.body.items.map(item => item.code).sort(), ['NON_OPERATIONAL', 'OPERATIONAL']);
    await db.allocationReviewWeek.create({ data: { weekStart: new Date('2026-11-02T00:00:00Z'), rows: {
      create: people.map(person => ({ collaboratorId: person.id, confirmedAt: new Date(), days: {
        create: { collaboratorId: person.id, workDate: new Date('2026-11-03T00:00:00Z'), kind: 'SEDE' }
      } }))
    } } });
    const allocationUrl = url.replace('/colaboradores', '/efetivo/conferencia/alocacoes');
    const allocationRequest = async query => {
      const response = await fetch(`${allocationUrl}?${new URLSearchParams({ from: '2026-11-01', to: '2026-11-09', ...query })}`, {
        headers: { Authorization: `Bearer ${token.token}` }
      });
      return { status: response.status, body: await response.json() };
    };
    const allocations = await allocationRequest();
    assert.equal(allocations.status, 200, JSON.stringify(allocations.body));
    assert.equal(allocations.body.items.length, 18);
    assert.deepEqual([...new Set(allocations.body.items.map(item => item.collaborator.code))].sort(), ['NON_OPERATIONAL', 'OPERATIONAL']);
    assert.deepEqual(allocations.body.items.filter(item => item.confirmationStatus === 'CONFIRMED')
      .map(item => item.collaborator.code).sort(), ['NON_OPERATIONAL', 'OPERATIONAL']);
    assert.ok(allocations.body.items.filter(item => item.confirmationStatus === 'PENDING')
      .every(item => item.confirmedAt === null));
    const allocationFirst = await allocationRequest({ limit: '1' });
    assert.equal(allocationFirst.body.page.hasMore, true);
    const first = await request({ limit: '1' });
    assert.equal(first.body.page.hasMore, true);
    await save({ ...configuration.rules, API: ['OPERATIONAL'] });
    const staleAllocation = await allocationRequest({ cursor: allocationFirst.body.page.nextCursor });
    assert.equal(staleAllocation.status, 400);
    assert.equal(staleAllocation.body.code, 'INVALID_CURSOR');
    const restrictedAllocations = await allocationRequest();
    assert.equal(restrictedAllocations.body.items.length, 9);
    assert.ok(restrictedAllocations.body.items.every(item => item.collaborator.code === 'OPERATIONAL'));
    const stale = await request({ limit: '1', cursor: first.body.page.nextCursor });
    assert.equal(stale.status, 400);
    assert.equal(stale.body.code, 'INVALID_CURSOR');
    assert.deepEqual((await request({ limit: '100' })).body.items.map(item => item.code), ['OPERATIONAL']);
  });

  await t.test('somente ADM edita a matriz; EPI bloqueia nova entrega escondida e administração continua vendo todos', async () => {
    await save({ ...configuration.rules, EPI: ['OPERATIONAL'], RDO: [] });
    const originals = [];
    for (const [model, methods] of Object.entries({ userSession: ['findUnique'], collaborator: ['findMany', 'findFirst'], project: ['findMany'] })) {
      for (const method of methods) {
        originals.push([model, method, prisma[model][method]]);
        prisma[model][method] = (...args) => db[model][method](...args);
      }
    }
    const originalTransaction = prisma.$transaction;
    prisma.$transaction = (...args) => db.$transaction(...args);
    t.after(() => { originals.forEach(([model, method, fn]) => { prisma[model][method] = fn; }); prisma.$transaction = originalTransaction; });
    const technician = await db.user.create({ data: { username: 'visibility-technician', name: 'Técnico EPI', passwordHash: 'test', accountType: 'INTERNAL', role: 'COLLABORATOR', moduleRoles: { create: { module: 'EPI', role: 'EPI_TECHNICIAN' } } } });
    for (const [userId, token] of [[admin.id, 'admin-visibility'], [technician.id, 'technician-visibility']]) {
      await db.userSession.create({ data: { userId, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 3600000) } });
    }
    const app = express(); app.use(express.json());
    app.use('/api/admin/workforce-classification', createWorkforceClassificationRouter({ database: db }));
    app.use('/api/epi', epiRouter);
    app.use('/api/romaneio', romaneioRouter);
    app.use('/api/projects', projectsRouter);
    app.use((error, _req, res, _next) => res.status(error.statusCode || error.status || 400).json({ code: error.code, error: error.message }));
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const request = async (path, token = 'admin-visibility', method = 'GET', payload) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
      return { status: response.status, body: await response.json() };
    };
    const path = '/admin/workforce-classification/visibility';
    assert.equal((await request(path, '')).status, 401);
    assert.equal((await request(path, 'technician-visibility', 'PUT', { version: configuration.version, rules: defaultWorkforceVisibilityRules(), reason: 'Tentativa sem autorização.' })).status, 403);
    assert.equal((await request(path)).status, 200);
    assert.equal((await request('/admin/workforce-classification/collaborator-options')).body.length, 3);
    await db.project.update({ where: { code: 'visibility-project' }, data: { operatorId: people[1].id } });
    const romaneioList = await request('/romaneio/projects');
    assert.equal(romaneioList.status, 200, JSON.stringify(romaneioList.body));
    assert.equal(romaneioList.body.find(item => item.code === 'visibility-project').operator, null);
    await save({ ...configuration.rules, ROMANEIO: ['NON_OPERATIONAL'] });
    const allowedOperator = (await request('/romaneio/projects')).body.find(item => item.code === 'visibility-project').operator;
    assert.equal(allowedOperator.id, people[1].id);
    assert.equal(allowedOperator.workforceClassificationOverride, undefined);
    assert.equal((await db.project.findUniqueOrThrow({ where: { code: 'visibility-project' } })).operatorId, people[1].id);
    const projectData = { code: 'visibility-rental', name: 'Locação', clientName: 'Teste', clientCnpj: '12345678000190',
      contractCode: 'SEM PROPOSTA', location: 'Sede', operatorId: people[1].id };
    const blockedProject = await request('/projects', 'admin-visibility', 'POST', { ...projectData, serviceCategory: 'SERVICE' });
    assert.equal(blockedProject.status, 409, JSON.stringify(blockedProject.body));
    assert.equal(blockedProject.body.code, 'COLLABORATOR_NOT_VISIBLE');
    const rental = await request('/projects', 'admin-visibility', 'POST', { ...projectData, serviceCategory: 'RENTAL' });
    assert.equal(rental.status, 201, JSON.stringify(rental.body));
    assert.equal(rental.body.operatorId, null);
    const rentalUpdate = await request(`/projects/${rental.body.id}`, 'admin-visibility', 'PUT', { operatorId: people[1].id });
    assert.equal(rentalUpdate.status, 200, JSON.stringify(rentalUpdate.body));
    assert.equal(rentalUpdate.body.operatorId, null);
    const serviceUpdate = await request(`/projects/${rental.body.id}`, 'admin-visibility', 'PUT', { serviceCategory: 'SERVICE', operatorId: people[1].id });
    assert.equal(serviceUpdate.status, 409, JSON.stringify(serviceUpdate.body));
    assert.equal((await db.project.findUniqueOrThrow({ where: { id: rental.body.id } })).serviceCategory, 'RENTAL');
    const epiList = await request('/epi/collaborators', 'technician-visibility');
    assert.deepEqual(epiList.body.map(item => item.code), ['OPERATIONAL']);
    const recordsBefore = await db.epiRecord.count();
    const denied = await request(`/epi/collaborators/${people[1].id}/records`, 'technician-visibility', 'POST', { epiName: 'Capacete teste', ca: '12345', quantity: 1, lendDate: '18/11/2026' });
    assert.equal(denied.status, 409, JSON.stringify(denied.body));
    assert.equal(denied.body.code, 'COLLABORATOR_NOT_VISIBLE');
    assert.equal(await db.epiRecord.count(), recordsBefore);
    const saved = await request(path, 'admin-visibility', 'PUT', { version: configuration.version, rules: configuration.rules, reason: 'Revisão confirmada pelo ADM na interface.' });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.version, configuration.version + 1);
    assert.equal((await getWorkforceVisibility(db)).version, saved.body.version);
    const audit = await request('/admin/workforce-classification/history?entityType=VISIBILITY&entityId=global');
    assert.ok(audit.body.length);
    assert.equal(audit.body[0].actorName, admin.name);
  });
});
