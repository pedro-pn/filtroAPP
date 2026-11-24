import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import express from 'express';
import pg from 'pg';
import YAML from 'yaml';
import Ajv from 'ajv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { API_SCOPES, getApiOperation, publicApiOperations } from '../src/lib/api-credentials/catalog.js';
import { ALLOCATION_REVIEW_OPERATION as operationId, ALLOCATION_REVIEW_SCOPE as scope, listReviewAllocations, validateAllocationReviewQuery } from '../src/lib/api-credentials/allocation-review.js';
import { executePlaygroundOperation, validatePlaygroundRequest } from '../src/lib/api-credentials/playground.js';
import { createApiToken } from '../src/lib/api-credentials/token.js';
import { projectAccessExtension } from '../src/lib/projects/access-scope.js';
import { createApiTokenAuthenticator } from '../src/middleware/api-token-auth.js';
import { apiRequestContext, integrationApiBoundary, integrationApiErrorHandler } from '../src/middleware/api-request-context.js';
import { createOperationalRouter } from '../src/routes/integrations/v1/operational.js';
import { apiSimulationDatabase } from './helpers/api-simulation-db.js';

const query = { from: '2026-10-01', to: '2026-10-10' };
const key = 'synthetic-conecta-test-hmac-key-at-least-32';
const envConfig = { apiTokenGlobalMaxPageSize: 500, apiTokenHashKeys: { 1: key }, apiTokenActiveKeyVersion: 1 };
const context = { scopes: new Set([scope]), projectAccessMode: 'ALL', maxPageSize: 500, cursorKey: key, credentialId: 'synthetic' };
const dateOf = value => new Date(`${value}T00:00:00Z`);

test('confirmed allocation query requires a real bounded period, scope and full-calendar authorization', async () => {
  assert.equal(validateAllocationReviewQuery(query, context).limit, 100);
  assert.equal(validateAllocationReviewQuery({ from: '2026-01-01', to: '2026-04-03' }, context).to, '2026-04-03');
  assert.equal(validateAllocationReviewQuery({ ...query, to: query.from }, context).to, query.from);
  for (const input of [
    {}, { from: query.from }, { ...query, from: '2026-02-30' }, { ...query, to: '2026-09-30' },
    { from: '2026-01-01', to: '2026-04-04' }, { ...query, from: `${query.from}T00:00:00Z` },
    { ...query, from: [query.from] }, { ...query, limit: ['1'] }, { ...query, limit: true },
    { ...query, limit: 0 }, { ...query, limit: 501 }, { ...query, collaboratorId: ' ' },
    { ...query, updatedSince: '2026-10-01T00:00:00Z' }, { ...query, projectId: 'p1' },
    { ...query, snapshotAt: '2026-10-10T00:00:00Z' }, { ...query, fields: '*' }
  ]) {
    assert.throws(() => validateAllocationReviewQuery(input, context), error => error.name === 'ZodError');
    assert.throws(() => validatePlaygroundRequest({ operationId, query: input }));
  }
  assert.throws(() => validateAllocationReviewQuery({ ...query, limit: 11 }, { ...context, maxPageSize: 10 }), error => error.code === 'INVALID_LIMIT');
  await assert.rejects(() => listReviewAllocations({}, query, { ...context, scopes: new Set(['efetivo.alocacoes.read']) }), error => error.code === 'INSUFFICIENT_SCOPE');
  await assert.rejects(() => listReviewAllocations({}, query, { ...context, projectAccessMode: 'SELECTED', projectIds: new Set(['p1']) }), error => error.code === 'PROJECT_NOT_ALLOWED');
});

test('Conecta is discoverable with a dedicated grant, required period and a documented response', async () => {
  assert.equal(API_SCOPES.find(item => item.code === scope).status, 'AVAILABLE');
  const operation = publicApiOperations().find(item => item.operationId === operationId);
  assert.deepEqual(operation.requiredScopes, [scope]);
  assert.deepEqual(operation.parameters.filter(item => item.required).map(item => item.name), ['from', 'to']);
  assert.equal(validatePlaygroundRequest({ operationId, query }).query.limit, undefined);
  const contract = YAML.parse(await readFile(new URL('../../specs/015-api-token-playground/contracts/openapi.yaml', import.meta.url), 'utf8'));
  const documented = contract.paths['/integracoes/v1/efetivo/conferencia/alocacoes'].get;
  assert.equal(documented.operationId, getApiOperation(operationId).openApiOperationId);
  assert.deepEqual(documented['x-required-scopes'], [scope]);
  assert.ok(documented.responses['409']);
});

// PostgreSQL WASM descartável por padrão; nunca usa DATABASE_URL da aplicação.
test('PostgreSQL: Conecta export, Bearer, quotas, pagination, corrections and playground', async t => {
  const url = process.env.TEST_CONECTA_DATABASE_URL;
  if (url) assert.match(new URL(url).pathname, /^\/conecta_allocation_test(?:_|$)/);
  const local = url ? null : await apiSimulationDatabase();
  const pool = url ? new pg.Pool({ connectionString: url, max: 6 }) : null;
  const prisma = (local?.client || new PrismaClient({ adapter: new PrismaPg(pool, { disposeExternalPool: true }) })).$extends(projectAccessExtension);
  let server;
  const weekIds = [];
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (weekIds.length) await prisma.allocationReviewWeek.deleteMany({ where: { id: { in: weekIds } } });
    if (local) await local.close();
    else await prisma.$disconnect();
  });
  const suffix = randomUUID();
  const user = await prisma.user.create({ data: { username: suffix, name: 'Admin fictício', email: `${suffix}@example.test`, passwordHash: 'synthetic', role: 'MANAGER', accountType: 'ADMIN' } });
  const role = await prisma.jobRole.create({ data: { name: suffix, normalizedKey: suffix } });
  const person = async (id, isActive = true) => prisma.collaborator.create({ data: {
    id: `${suffix}-${id}`, code: `${suffix}-${id}`, name: `Pessoa ${id}`, jobRoleId: role.id, isActive,
    admissionDate: dateOf('2026-09-01'), registrationNumber: id === 'a' ? '000123' : null, cpf: 'NEVER_EXPOSE', efetivoNote: 'NEVER_EXPOSE'
  } });
  const [alice, bob, draft] = await Promise.all([person('a'), person('b', false), person('draft')]);
  const project = (number, extra = {}) => prisma.project.create({ data: {
    code: `${number}-${suffix}`, name: 'Projeto fictício', clientName: 'Cliente fictício', clientCnpj: '04.988.669/0001-94',
    contractCode: 'synthetic', location: 'Itajaí', clientEmailPrimary: 'NEVER_EXPOSE', ...extra
  } });
  const [p1, archived, hidden, deleted, invalidCnpj] = await Promise.all([
    project('005747'), project('005748', { isActive: false }), project('005749', { distributionSettings: { api: false } }),
    project('005750', { deletedAt: new Date() }), project('005751', { clientCnpj: '123456789012345' })
  ]);
  const week = await prisma.allocationReviewWeek.create({ data: { weekStart: dateOf('2026-09-28'), version: 3 } });
  weekIds.push(week.id);
  const nextWeek = await prisma.allocationReviewWeek.create({ data: { weekStart: dateOf('2026-10-05'), version: 2 } });
  weekIds.push(nextWeek.id);
  const row = (collaboratorId, weekId, confirmedAt = new Date()) => prisma.allocationReviewRow.create({ data: { collaboratorId, weekId, confirmedAt, confirmedByUserId: 'NEVER_EXPOSE' } });
  const [arow, brow, drow, nextRow] = await Promise.all([
    row(alice.id, week.id), row(bob.id, week.id), row(draft.id, week.id, null), row(alice.id, nextWeek.id)
  ]);
  const day = (owner, date, kind, projectIds = []) => prisma.allocationReviewDay.create({ data: {
    collaboratorId: owner.collaboratorId, rowId: owner.id, workDate: dateOf(date), kind,
    note: 'NEVER_EXPOSE', suggestionSnapshot: { private: 'NEVER_EXPOSE' },
    projects: { create: projectIds.map(projectId => ({ projectId })) }
  } });
  await Promise.all([
    day(arow, '2026-09-30', 'SEDE'), day(arow, '2026-10-01', 'PROJECT', [p1.id, archived.id]),
    day(brow, '2026-10-01', 'PROJECT', [archived.id]), day(arow, '2026-10-02', 'TRAVEL', [p1.id]),
    day(arow, '2026-10-03', 'FALTA'), day(arow, '2026-10-04', 'FOLGA'), day(drow, '2026-10-02', 'SEDE'),
    day(nextRow, '2026-10-05', 'FERIAS'), day(nextRow, '2026-10-06', 'AFASTAMENTO'), day(nextRow, '2026-10-07', 'TREINAMENTO'),
    day(nextRow, '2026-10-08', 'PROJECT', [p1.id, hidden.id]), day(nextRow, '2026-10-09', 'TRAVEL', [deleted.id]),
    day(nextRow, '2026-10-10', 'PROJECT', [invalidCnpj.id])
  ]);
  const issue = async ({ scopeCodes = [scope], mode = 'ALL', maxPageSize = 100, rowsPerDay = 500000 } = {}) => {
    const token = createApiToken({ key });
    const credential = await prisma.apiCredential.create({ data: {
      selector: token.selector, secretVerifier: token.verifier, secretLastFour: token.secretLastFour, hashKeyVersion: 1,
      name: 'Conecta teste', purpose: 'Exportação de alocação fictícia', recipientName: 'Conecta', startsAt: new Date(0),
      projectAccessMode: mode, createdByUserId: user.id, issuanceRequestId: randomUUID(), maxPageSize, rowsPerDay,
      requestsPerMinute: 600,
      scopes: { create: scopeCodes.map(scopeCode => ({ scopeCode, grantedByUserId: user.id })) },
      ...(mode === 'SELECTED' ? { projects: { create: { projectId: p1.id, grantedByUserId: user.id } } } : {})
    } });
    return { token: token.token, credential };
  };
  const auth = await issue();
  const app = express();
  app.use(apiRequestContext(), integrationApiBoundary());
  app.use(createApiTokenAuthenticator({ prismaClient: prisma, envConfig }));
  app.use('/api/integracoes/v1', createOperationalRouter({ prismaClient: prisma, envConfig }));
  const errors = [];
  app.use((error, req, res, next) => { errors.push(error); next(error); });
  app.use(integrationApiErrorHandler);
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/integracoes/v1/efetivo/conferencia/alocacoes`;
  const request = async (params = query, token = auth.token) => {
    const response = await fetch(`${base}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${token}` } });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };

  await t.test('confirmed, draft and automatic days, all kinds and exact public fields', async () => {
    const response = await request();
    assert.equal(response.status, 200, JSON.stringify(errors.map(error => error.message)));
    assert.equal(response.body.items.length, 19);
    assert.equal(response.body.schemaVersion, '2.0');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-request-id'), response.body.requestId);
    const items = response.body.items;
    assert.doesNotMatch(JSON.stringify(items), /NEVER_EXPOSE/);
    assert.ok(items.some(item => item.collaborator.id === draft.id));
    const pending = items.filter(item => item.collaborator.id === draft.id);
    assert.ok(pending.every(item => item.confirmationStatus === 'PENDING' && item.confirmedAt === null));
    const automatic = pending.find(item => item.date === '2026-10-01');
    assert.equal(automatic.kind, 'NONE');
    assert.equal(automatic.updatedAt, null);
    assert.match(automatic.id, /^automatic:/);
    assert.equal(pending.find(item => item.date === '2026-10-02').kind, 'SEDE');
    assert.ok(items.some(item => item.collaborator.id === bob.id));
    const first = items.find(item => item.date === query.from && item.collaborator.id === alice.id);
    assert.equal(first.projects.length, 2);
    assert.equal(first.confirmationStatus, 'CONFIRMED');
    assert.ok(first.confirmedAt);
    assert.equal(first.projects.find(item => item.id === p1.id).code, p1.code);
    assert.equal(first.projects[0].clientCnpj, '04988669000194');
    assert.equal(first.collaborator.registrationNumber, '000123');
    assert.deepEqual(items.find(item => item.kind === 'TRAVEL').projects.map(item => item.id), [p1.id]);
    for (const kind of ['SEDE', 'FOLGA', 'FERIAS', 'AFASTAMENTO', 'TREINAMENTO', 'FALTA']) {
      assert.deepEqual(items.find(item => item.kind === kind).projects, []);
    }
    assert.equal(items.at(-1).date, query.to);
    assert.equal(items.find(item => item.date === query.to && item.collaborator.id === alice.id).projects[0].clientCnpj, null);
    assert.equal(items.some(item => item.collaborator.id === alice.id && ['2026-10-08', '2026-10-09'].includes(item.date)), false);
    const contract = YAML.parse(await readFile(new URL('../../specs/015-api-token-playground/contracts/openapi.yaml', import.meta.url), 'utf8'));
    const schemas = contract.components.schemas;
    const schema = structuredClone(schemas.ConfirmedAllocationPage);
    schema.properties.items.items = schemas.ConfirmedAllocationDay;
    const validate = new Ajv({ strict: false, validateFormats: false }).compile(schema);
    assert.equal(validate(response.body), true, JSON.stringify(validate.errors));
  });

  await t.test('signed keyset pagination has no omissions on a shared date and keeps all projects together', async () => {
    const imported = [];
    let cursor;
    do {
      const response = await request({ ...query, limit: '1', ...(cursor ? { cursor } : {}) });
      assert.equal(response.status, 200);
      imported.push(...response.body.items);
      cursor = response.body.page.nextCursor;
      assert.equal(response.body.page.hasMore, Boolean(cursor));
    } while (cursor);
    const all = (await request()).body.items;
    assert.deepEqual(imported, all);
    const first = await request({ ...query, limit: '1' });
    for (const [params, token] of [
      [{ ...query, from: '2026-10-02', cursor: first.body.page.nextCursor }, auth.token],
      [{ ...query, collaboratorId: alice.id, cursor: first.body.page.nextCursor }, auth.token],
      [{ ...query, cursor: first.body.page.nextCursor }, (await issue()).token],
      [{ ...query, cursor: first.body.page.nextCursor + 'x' }, auth.token]
    ]) {
      const denied = await request(params, token);
      assert.equal(denied.status, 400);
      assert.equal(denied.body.code, 'INVALID_CURSOR');
    }
    const filtered = await request({ ...query, collaboratorId: bob.id });
    assert.equal(filtered.body.items.length, 1);
    assert.equal(filtered.body.items[0].collaborator.id, bob.id);
    assert.deepEqual((await request({ from: '2020-01-01', to: '2020-01-31' })).body.items, []);
  });

  await t.test('invalid token, missing grant, selected projects, invalid period and credential page limit fail', async () => {
    assert.equal((await request(query, 'invalid')).status, 401);
    for (const opts of [{ scopeCodes: ['colaboradores.operacional.read'] }, { mode: 'SELECTED' }]) {
      assert.equal((await request(query, (await issue(opts)).token)).status, 403);
    }
    const small = await issue({ maxPageSize: 1 });
    assert.equal((await request({ ...query, limit: '2' }, small.token)).body.code, 'INVALID_LIMIT');
    for (const input of [{}, { ...query, to: '2026-02-30' }, { ...query, updatedSince: new Date().toISOString() }]) {
      const response = await request(input);
      assert.equal(response.status, 400);
      assert.equal(response.body.code, 'VALIDATION_ERROR');
    }
  });

  await t.test('row unconfirmation invalidates cursors and keeps allocations as pending on a full reread', async () => {
    const first = await request({ ...query, limit: '1' });
    await prisma.$transaction([
      prisma.allocationReviewRow.update({ where: { id: brow.id }, data: { confirmedAt: null } }),
      prisma.allocationReviewWeek.update({ where: { id: week.id }, data: { version: { increment: 1 } } })
    ]);
    const response = await request({ ...query, cursor: first.body.page.nextCursor });
    assert.equal(response.status, 409);
    assert.equal(response.body.code, 'ALLOCATION_REVIEW_CHANGED');
    const reread = (await request({ ...query, collaboratorId: bob.id })).body.items;
    assert.equal(reread.length, 1);
    assert.equal(reread[0].confirmationStatus, 'PENDING');
    assert.equal(reread[0].confirmedAt, null);
  });

  await t.test('client CNPJ and collaborator metadata corrections invalidate cursors and appear on reread', async () => {
    for (const update of [
      () => prisma.project.update({ where: { id: p1.id }, data: { clientCnpj: '00.000.000/0001-91' } }),
      () => prisma.collaborator.update({ where: { id: alice.id }, data: { registrationNumber: '000124' } })
    ]) {
      const first = await request({ ...query, limit: '1' });
      await update();
      const changed = await request({ ...query, cursor: first.body.page.nextCursor });
      assert.equal(changed.status, 409);
    }
    const all = (await request()).body.items;
    assert.equal(all[0].projects.find(item => item.id === p1.id).clientCnpj, '00000000000191');
    assert.equal(all[0].collaborator.registrationNumber, '000124');
  });

  await t.test('playground uses the same projection and meters actual rows; API audit and quotas work', async () => {
    const result = await executePlaygroundOperation(prisma, auth.credential.id, { operationId, query: { ...query, limit: 2 } }, { envConfig, cursorKey: key });
    assert.equal(result.response.status, 200);
    assert.equal(result.response.body.items.length, 2);
    assert.doesNotMatch(JSON.stringify(result.response.body), /NEVER_EXPOSE/);
    const log = await prisma.apiRequestLog.findFirst({ where: { credentialId: auth.credential.id, operationId, statusCode: 200, responseRows: 19 } });
    assert.ok(log);
    assert.equal(log.scopeCode, scope);
    const restricted = await issue({ rowsPerDay: 1, maxPageSize: 1 });
    assert.equal((await request({ ...query, limit: '1' }, restricted.token)).status, 200);
    const exceeded = await request({ ...query, limit: '1' }, restricted.token);
    assert.equal(exceeded.status, 429);
    assert.equal(exceeded.body.code, 'QUOTA_EXCEEDED');
    assert.ok(exceeded.headers.get('retry-after'));
  });

  await t.test('automatic allocations without a saved week use real sources and invalidate cursors on source changes', async () => {
    const auto = await person('automatic');
    const from = '2026-11-16';
    const to = '2026-11-22';
    const params = { from, to, collaboratorId: auto.id };
    const report = (date, projectId) => prisma.report.create({ data: {
      projectId, reportDate: dateOf(date), arrivalTime: '08:00', departureTime: '17:00', lunchBreak: '01:00', daytimeCount: 1,
      collaborators: { create: { collaboratorId: auto.id } }
    } });
    await Promise.all([report(from, p1.id), report(from, archived.id),
      report('2026-11-18', p1.id), report('2026-11-18', hidden.id), report('2026-11-19', hidden.id)]);
    const absence = await prisma.collaboratorAbsence.create({ data: {
      collaboratorId: auto.id, type: 'FERIAS', startDate: dateOf('2026-11-20'), endDate: dateOf('2026-11-20')
    } });
    const plan = await prisma.efetivoPlan.create({ data: { kind: 'OFFICIAL', status: 'ACTIVE', name: suffix } });
    const mission = await prisma.efetivoMissionPlan.create({ data: {
      planId: plan.id, projectId: p1.id, scheduleStatus: 'CONFIRMED',
      headquartersResponsibleUserId: user.id, headquartersResponsibleName: 'Admin fictício', headquartersResponsibleRole: 'Admin',
      mobilizationDate: dateOf('2026-11-17'), executionStartDate: dateOf('2026-11-17'), executionEndDate: dateOf('2026-11-17'),
      allocations: { create: { collaboratorId: auto.id, jobRoleId: role.id, jobRoleNameSnapshot: role.name } }
    } });
    const response = await request(params);
    assert.equal(response.status, 200);
    const items = response.body.items;
    assert.deepEqual(items.map(item => item.date), [from, '2026-11-17', '2026-11-20', '2026-11-21', to]);
    assert.ok(items.every(item => item.confirmationStatus === 'PENDING' && item.confirmedAt === null
      && item.weekVersion === 0 && item.updatedAt === null));
    assert.deepEqual(items[0].projects.map(item => item.id).sort(), [p1.id, archived.id].sort());
    assert.deepEqual(items[1].projects.map(item => item.id), [p1.id]);
    assert.equal(items[2].kind, 'FERIAS');
    assert.equal(items[3].kind, 'FOLGA');
    assert.equal(await prisma.allocationReviewWeek.count({ where: { weekStart: dateOf(from) } }), 0);

    // Mudanças automáticas não dependem de uma versão persistida da conferência.
    for (const update of [
      () => prisma.collaboratorAbsence.update({ where: { id: absence.id }, data: { type: 'TREINAMENTO' } }),
      () => prisma.efetivoMissionPlan.update({ where: { id: mission.id }, data: { scheduleStatus: 'DRAFT' } }),
      () => report(from, invalidCnpj.id)
    ]) {
      const first = await request({ ...params, limit: '1' });
      assert.equal(first.status, 200);
      await update();
      const changed = await request({ ...params, cursor: first.body.page.nextCursor });
      assert.equal(changed.status, 409);
      assert.equal(changed.body.code, 'ALLOCATION_REVIEW_CHANGED');
    }
    assert.equal((await request(params)).body.items.find(item => item.date === '2026-11-20').kind, 'TREINAMENTO');

    // Um import real de ponto percorre o cálculo transacional, sem usar o banco
    // global nem reutilizar uma sugestão anterior em cache.
    const beforePoint = await request({ ...params, limit: '1' });
    const ponto = await prisma.pontoImport.create({ data: {
      fileName: 'synthetic', contentHash: suffix, periodStart: dateOf(from), periodEnd: dateOf(to),
      periods: { create: {
        collaboratorId: auto.id, rawName: auto.name, normalizedName: auto.name.toLowerCase(),
        periodStart: dateOf(from), periodEnd: dateOf(to), workedMinutes: 480, workedDates: ['2026-11-17'],
        monthly: { '2026-11': { normalMinutes: 480, extrasMinutes: 0, workedDates: ['2026-11-17'],
          days: [{ date: '2026-11-17', workedMinutes: 480, extrasMinutes: 0, tags: [] }] } }
      } }
    } });
    assert.equal((await request({ ...params, cursor: beforePoint.body.page.nextCursor })).status, 409);
    const pointItems = (await request(params)).body.items;
    assert.equal(pointItems.find(item => item.date === '2026-11-17').kind, 'SEDE');
    assert.equal(pointItems.find(item => item.date === '2026-11-17').confirmationStatus, 'PENDING');
    await prisma.pontoImport.delete({ where: { id: ponto.id } });

    // Confirmar o ajuste substitui a sugestão na mesma chave lógica, sem duplicar.
    const savedWeek = await prisma.allocationReviewWeek.create({ data: { weekStart: dateOf(from), version: 1 } });
    weekIds.push(savedWeek.id);
    const savedRow = await row(auto.id, savedWeek.id, null);
    const savedDay = await day(savedRow, from, 'SEDE');
    const pending = (await request(params)).body.items.find(item => item.date === from);
    assert.equal(pending.id, savedDay.id);
    assert.equal(pending.kind, 'SEDE');
    assert.equal(pending.confirmationStatus, 'PENDING');
    const first = await request({ ...params, limit: '1' });
    await prisma.$transaction([
      prisma.allocationReviewRow.update({ where: { id: savedRow.id }, data: { confirmedAt: new Date() } }),
      prisma.allocationReviewWeek.update({ where: { id: savedWeek.id }, data: { version: { increment: 1 } } })
    ]);
    assert.equal((await request({ ...params, cursor: first.body.page.nextCursor })).status, 409);
    const confirmed = (await request(params)).body.items.filter(item => item.date === from);
    assert.equal(confirmed.length, 1);
    assert.equal(confirmed[0].id, savedDay.id);
    assert.equal(confirmed[0].confirmationStatus, 'CONFIRMED');
    assert.ok(confirmed[0].confirmedAt);
    // Um dia sem valor salvo não herda indevidamente a confirmação da linha.
    assert.equal((await request(params)).body.items.find(item => item.date === to).confirmationStatus, 'PENDING');
    await prisma.collaborator.update({ where: { id: auto.id }, data: {
      isActive: false, admissionDate: dateOf('2026-11-17'), terminationDate: dateOf('2026-11-20')
    } });
    const historical = (await request(params)).body.items;
    assert.deepEqual(historical.map(item => item.date), [from, '2026-11-17', '2026-11-20']);
    assert.equal(historical[0].confirmationStatus, 'CONFIRMED');
    assert.equal(historical[1].kind, 'NONE');
  });
});
