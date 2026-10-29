import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import express from 'express';
import { apiSimulationDatabase } from './helpers/api-simulation-db.js';
import { API_WRITE_SIMULATION_CASES } from './fixtures/api-write-simulation-cases.js';
import { API_OPERATIONS, API_SCOPES, getApiOperation } from '../src/lib/api-credentials/catalog.js';
import { createApiToken } from '../src/lib/api-credentials/token.js';
import { createApiTokenAuthenticator, createApiSimulationPreferenceResolver } from '../src/middleware/api-token-auth.js';
import { apiRequestContext, integrationApiBoundary, integrationApiErrorHandler } from '../src/middleware/api-request-context.js';
import { createIntegrationQualityRouter } from '../src/routes/integrations/v1/qualidade.js';
import { createOperationalRouter } from '../src/routes/integrations/v1/operational.js';
import { executePlaygroundOperation } from '../src/lib/api-credentials/playground.js';
import { updateCredentialWriteMode, rotateCredential, createCredential } from '../src/lib/api-credentials/service.js';
import { projectCardsCache } from '../src/lib/resource-list-cache.js';
import { executeApiWrite } from '../src/lib/api-credentials/write-simulation.js';
import { createIntegrationQualityRecord } from '../src/lib/qualidade/integration-create.js';
import { integrationWriteSimulationFailures } from '../../scripts/check-integration-write-simulation.mjs';
import fs from 'node:fs/promises';

const key = 'synthetic-api-simulation-hmac-key-at-least-32';
const envConfig = { apiTokenGlobalMaxPageSize: 500, apiTokenHashKeys: { 1: key }, apiTokenActiveKeyVersion: 1,
  crmPlanningEnvironment: 'sandbox', crmPlanningTenantId: 'filtrovali' };

test('simulação das escritas: HTTP, Prisma e rollback de todas as tabelas PostgreSQL', { timeout: 120_000 }, async t => {
  const database = await apiSimulationDatabase();
  const { client: prisma, db } = database;
  let server;
  t.after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await database.close(); });
  const user = await prisma.user.create({ data: { username: 'synthetic-api-simulation', name: 'Responsável fictício',
    email: 'quality@example.test', passwordHash: 'synthetic', role: 'MANAGER', accountType: 'ADMIN' } });
  const project = await prisma.project.create({ data: { code: '05776', name: 'Projeto fictício', clientName: 'Cliente',
    clientCnpj: '12345678000195', contractCode: '1234', location: 'Itajaí', workflow: { create: { leaderUserId: user.id } } } });
  const romaneio = await prisma.romaneio.create({ data: { projectId: project.id, romaneioDate: new Date(), driverName: 'Fictício', vehiclePlate: 'ABC1D23' } });
  await prisma.commercialProposal.create({ data: { codBd: 1234, codProp: 1234, nRev: 0, rawRow: {} } });
  async function issue(writeMode = 'LIVE', extra = {}) {
    const issued = createApiToken({ key });
    const credential = await prisma.apiCredential.create({ data: {
      selector: issued.selector, secretVerifier: issued.verifier, hashKeyVersion: 1, secretLastFour: issued.secretLastFour,
      name: 'Omni – desenvolvimento', purpose: 'Teste sintético isolado', recipientName: 'Omni', startsAt: new Date(0),
      writeMode, projectAccessMode: 'ALL', createdByUserId: user.id, issuanceRequestId: randomUUID(), requestsPerMinute: 600,
      scopes: { create: API_SCOPES.map(scope => ({ scopeCode: scope.code, grantedByUserId: user.id })) }, ...extra
    } });
    return { token: issued.token, credential };
  }
  const live = await issue(), simulated = await issue('SIMULATE');
  const app = express();
  app.use(apiRequestContext(), createApiSimulationPreferenceResolver({ prismaClient: prisma, envConfig }),
    integrationApiBoundary({ allowedOrigins: ['https://example.test'] }), express.json());
  app.use(createApiTokenAuthenticator({ prismaClient: prisma, envConfig }));
  app.use('/api/integracoes/v1/qualidade', createIntegrationQualityRouter({ prismaClient: prisma, envConfig }));
  app.use('/api/integracoes/v1', createOperationalRouter({ prismaClient: prisma, envConfig }));
  const errors = [];
  app.use((error, req, res, next) => { errors.push(error); next(error); });
  app.use(integrationApiErrorHandler);
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/integracoes/v1`;
  const fileEffects = ['writeFile', 'rename', 'copyFile', 'mkdir', 'unlink', 'rm', 'appendFile'].map(method =>
    t.mock.method(fs, method, () => { throw new Error(`Efeito de filesystem inesperado: ${method}`); }));
  let externalCalls = 0;
  const fetchRequest = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (url, options) => {
    if (!String(url).startsWith(base)) externalCalls++;
    assert.ok(String(url).startsWith(base), `Chamada externa inesperada: ${url}`);
    return fetchRequest(url, options);
  });
  async function request(path, body, { auth = live, prefer, idempotencyKey = randomUUID(), headers = {} } = {}) {
    const response = await fetch(base + path, { method: 'POST', headers: { authorization: `Bearer ${auth.token}`,
      'content-type': 'application/json', 'Idempotency-Key': idempotencyKey, ...(prefer ? { Prefer: prefer } : {}), ...headers }, body: JSON.stringify(body) });
    return { status: response.status, header: response.headers.get('Preference-Applied'), body: await response.json() };
  }
  const operationPayload = id => {
    const body = structuredClone(getApiOperation(id).bodyExample);
    if (id === 'logistics.unloadings.create') { body.romaneioId = romaneio.id; body.confirmadaPorEmail = user.email; }
    if (id === 'quality.records.create') { body.projectCode = project.code; body.actionOwnerEmail = user.email; }
    if (id === 'efetivo.projects.create') { body.code = 'new-project'; body.clientSegment = 'Segmento fictício novo'; }
    if (id === 'acompanhamento.opportunities.post') {
      body.eventId = randomUUID(); body.opportunity.commercialStatus = 'WON';
      body.opportunity.client.taxId = '12345678000195'; body.opportunity.client.segment = 'Segmento CRM fictício';
      body.opportunity.proposal.acceptedAt = '2026-10-29T12:00:00Z';
      body.opportunity.project = { prismaMissionId: 'mission-test', number: 'crm-project', numberScope: 'filtrovali', filtroappProjectId: null };
    }
    if (id === 'efetivo.projects.document.post') body.requirementStage = 'MOBILIZATION';
    return body;
  };
  const tables = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(row => row.tablename);
  // Infraestrutura deliberadamente persistida, separada dos dados de domínio.
  const infrastructure = new Set(['ApiRequestLog', 'ApiUsageBucket', 'ApiCredential', 'ApiCredentialEvent']);
  async function snapshot() {
    const result = {};
    for (const table of tables.filter(name => !infrastructure.has(name))) {
      result[table] = (await db.query(`SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`)).rows;
    }
    return result;
  }
  async function assertSimulated(id, path, body, options) {
    const before = await snapshot();
    const cacheKey = randomUUID();
    await projectCardsCache.get(cacheKey, () => 'retained');
    const result = await request(path, body, options);
    assert.equal(result.status, 200, JSON.stringify({ result, errors: errors.map(error => error.stack) }));
    assert.equal(result.header, 'validate-only'); assert.equal(result.body.simulated, true);
    assert.equal(result.body.operation, id); assert.deepEqual(result.body.warnings, []);
    assert.deepEqual(await snapshot(), before, `${id}: nenhuma tabela de domínio muda, inclusive conteúdo e contadores`);
    assert.ok(fileEffects.every(effect => effect.mock.callCount() === 0)); assert.equal(externalCalls, 0);
    assert.equal(await projectCardsCache.get(cacheKey, () => 'invalidated'), 'retained');
    assert.equal((await prisma.apiRequestLog.findUnique({ where: { requestId: result.body.requestId } })).simulated, true);
    for (const field of ['id', 'documentId', 'versionId', 'projectId', 'accompanimentId', 'number']) assert.equal(field in result.body.would, false, field);
    return result;
  }
  assert.deepEqual(API_OPERATIONS.filter(op => op.method !== 'GET').map(op => op.operationId).sort(), [...API_WRITE_SIMULATION_CASES].sort());
  for (const id of API_WRITE_SIMULATION_CASES) await t.test(id, async () => {
    const operation = getApiOperation(id), path = operation.path.replace(':id', project.id);
    const body = operationPayload(id), idempotencyKey = body.eventId || randomUUID();
    const options = { idempotencyKey };
    const result = await assertSimulated(id, path, body, { ...options, prefer: 'return=representation, Validate-Only' });
    if (id === 'quality.records.create') {
      assert.equal(result.body.would.actionOwnerUserId, user.id); assert.equal(result.body.would.status, 'EM_TRIAGEM');
      assert.equal(result.body.would.projectCode, '05776'); assert.match(result.body.would.previewNumber, /^D-\d+\/\d{2}$/);
    }
    await assertSimulated(id, path, body, { ...options, auth: simulated });
    const before = await snapshot();
    const real = await request(path, body, options);
    assert.equal(real.status, 201, JSON.stringify(real)); assert.equal(real.header, null); assert.equal('simulated' in real.body, false);
    assert.notDeepEqual(await snapshot(), before, `${id}: LIVE persiste`);
    if (id === 'quality.records.create') assert.equal(real.body.number, result.body.would.previewNumber, 'simulação não consome número');
    await assertSimulated(id, path, body, { ...options, prefer: 'validate-only' });
  });

  await t.test('erros preservam o contrato, header e dados: responsável, chave real, corpo, escopo, recorte e cota', async () => {
    const id = 'quality.records.create', body = operationPayload(id), path = getApiOperation(id).path;
    const denied = await issue('SIMULATE', { scopes: undefined });
    const restricted = await issue('SIMULATE', { projectAccessMode: 'SELECTED' });
    const limited = await issue('SIMULATE', { rowsPerDay: 0 });
    const before = await snapshot();
    const missing = await request(path, { ...body, actionOwnerEmail: 'missing@example.test' }, { auth: simulated });
    assert.equal(missing.status, 422); assert.equal(missing.body.code, 'ACTION_OWNER_NOT_FOUND'); assert.equal(missing.header, 'validate-only');
    const receipt = await prisma.integrationQualityReceipt.findFirst({ where: { credentialId: live.credential.id } });
    const conflict = await request(path, { ...body, description: 'Outro conteúdo' }, { prefer: 'validate-only', idempotencyKey: receipt.key });
    assert.equal(conflict.status, 409); assert.equal(conflict.body.code, 'IDEMPOTENCY_CONFLICT'); assert.equal(conflict.header, 'validate-only');
    const invalid = await request(path, { ...body, type: 'invalid' }, { prefer: 'validate-only' });
    assert.equal(invalid.status, 400); assert.equal(invalid.header, 'validate-only');
    const scope = await request(path, body, { auth: denied }); assert.equal(scope.status, 403); assert.equal(scope.header, 'validate-only');
    assert.equal((await request(path, body, { auth: restricted })).status, 403);
    const quota = await request(path, body, { auth: limited }); assert.equal(quota.status, 429); assert.equal(quota.header, 'validate-only');
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('Playground simula por padrão e credencial SIMULATE prevalece sobre LIVE', async () => {
    const id = 'quality.records.create', body = operationPayload(id), before = await snapshot();
    const input = { operationId: id, body, headers: { 'Idempotency-Key': randomUUID() } };
    for (const [auth, writeMode] of [[live, undefined], [simulated, 'LIVE']]) {
      const result = await executePlaygroundOperation(prisma, auth.credential.id, { ...input, ...(writeMode ? { writeMode } : {}) }, { cursorKey: key });
      assert.equal(result.response.status, 200); assert.equal(result.response.body.simulated, true);
      assert.equal(result.response.headers['Preference-Applied'], 'validate-only'); assert.match(result.request.curl, /Prefer: validate-only/);
      assert.deepEqual(await snapshot(), before);
    }
    const real = await executePlaygroundOperation(prisma, live.credential.id, { ...input, writeMode: 'LIVE' }, { cursorKey: key });
    assert.equal(real.response.status, 201); assert.equal(real.response.headers, undefined);
  });

  await t.test('JSON inválido e Content-Type inválido confirmam SIMULATE antes do parser', async () => {
    for (const [contentType, body, status] of [['application/json', '{invalid', 400], ['text/plain', '{}', 415]]) {
      const response = await fetch(base + '/qualidade/registros', { method: 'POST',
        headers: { authorization: `Bearer ${simulated.token}`, 'content-type': contentType }, body });
      assert.equal(response.status, status); assert.equal(response.headers.get('Preference-Applied'), 'validate-only');
    }
  });

  await t.test('falha depois da escrita desfaz registro, número, auditoria e feed', async () => {
    const before = await snapshot();
    await assert.rejects(() => executeApiWrite(prisma, { operation: getApiOperation('quality.records.create'), simulated: true,
      requestId: randomUUID(), execute: async tx => {
        await createIntegrationQualityRecord(tx, operationPayload('quality.records.create'), randomUUID(), {
          credentialId: simulated.credential.id, scopes: new Set(['qualidade.registros.create']), projectAccessMode: 'ALL'
        });
        throw Object.assign(new Error('Falha posterior fictícia'), { statusCode: 422 });
      } }), error => error.statusCode === 422);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('edição auditada, versão concorrente e rotação preservam modo e permitem escopo Omni', async () => {
    const changed = await updateCredentialWriteMode(prisma, live.credential.id, { expectedVersion: 1, reason: 'Teste de simulação autorizado', writeMode: 'SIMULATE' }, { actorUserId: user.id });
    assert.equal(changed.writeMode, 'SIMULATE'); assert.ok(changed.scopeCodes.includes('qualidade.registros.create'));
    const event = await prisma.apiCredentialEvent.findFirst({ where: { credentialId: live.credential.id, type: 'METADATA_UPDATED' } });
    assert.deepEqual(event.summary, { previousWriteMode: 'LIVE', writeMode: 'SIMULATE' });
    await assert.rejects(() => updateCredentialWriteMode(prisma, live.credential.id, { expectedVersion: 1, reason: 'Versão antiga deve falhar', writeMode: 'LIVE' }), error => error.code === 'VERSION_CONFLICT');
    await assert.rejects(() => updateCredentialWriteMode(prisma, live.credential.id, { expectedVersion: 2, reason: 'Sem ampliação de escopos', writeMode: 'LIVE', scopeCodes: ['eventos.read'] }), error => error.name === 'ZodError');
    const now = new Date(), replacement = { name: 'Omni – desenvolvimento', purpose: 'Validação fictícia do Omni', recipientName: 'Omni', startsAt: now.toISOString(),
      expiresAt: new Date(+now + 3600000).toISOString(), scopeCodes: ['qualidade.registros.create'], projectAccess: { mode: 'ALL', projectIds: [] }, allowedIpCidrs: [], allowedFormats: ['JSON'],
      limits: { requestsPerMinute: 60, requestsPerDay: 1000, rowsPerDay: 1000, maxPageSize: 100 } };
    const rotated = await rotateCredential(prisma, live.credential.id, { expectedVersion: 2, reason: 'Rotação fictícia autorizada', revokePreviousAt: now.toISOString(), replacement },
      { actorUserId: user.id, idempotencyKey: randomUUID(), hashKeys: { 1: key }, activeKeyVersion: 1 });
    assert.equal(rotated.credential.writeMode, 'SIMULATE');
    const issued = await createCredential(prisma, { ...replacement, writeMode: 'SIMULATE' }, { actorUserId: user.id, idempotencyKey: randomUUID(), hashKeys: { 1: key }, activeKeyVersion: 1 });
    assert.equal(issued.credential.writeMode, 'SIMULATE');
  });
});

test('escrita sem suporte recusa simulação antes de executar', async () => {
  let executed = false;
  await assert.rejects(() => executeApiWrite({ $transaction() { throw Error('não deve abrir'); } }, {
    operation: { operationId: 'future.write' }, simulated: true, execute() { executed = true; }
  }), error => error.statusCode === 501 && error.code === 'SIMULATION_NOT_SUPPORTED');
  assert.equal(executed, false);
});

test('conflito transacional reinicia a simulação inteira em vez de repetir a transação abortada', async () => {
  for (const code of ['P2034', 'P2002']) {
    let transactions = 0;
    const database = { async $transaction(callback) {
      transactions++;
      return callback({ projectWorkflowCommercialFact: { async findUniqueOrThrow() { return { key: 'CONTRACT_SIGNED', status: 'CONFIRMED' }; } } });
    } };
    const result = await executeApiWrite(database, { operation: getApiOperation('efetivo.projects.commercialFact.post'), simulated: true,
      requestId: 'synthetic-retry', execute: async tx => {
        await tx.$transaction(async () => { if (transactions === 1) throw Object.assign(new Error('conflito fictício'), { code }); });
        return { body: { projectId: 'existing', key: 'CONTRACT_SIGNED', outcome: 'CREATED' }, rows: 1 };
      } });
    assert.equal(transactions, 2); assert.equal(result.body.simulated, true);
  }
});

test('gate de arquitetura rejeita escrita sem declaração, sem caso ou fora do executor', () => {
  const operation = getApiOperation('quality.records.create');
  const source = { path: 'backend/src/routes/integrations/v1/qualidade.js', source: "router.post('/registros', requireApiOperation('quality.records.create'), () => { runMeteredApiOperation(req, {execute: async database => {}}); });" };
  const testSource = 'for (const id of API_WRITE_SIMULATION_CASES) await snapshot()';
  assert.deepEqual(integrationWriteSimulationFailures([operation], [source], API_WRITE_SIMULATION_CASES, testSource), []);
  assert.ok(integrationWriteSimulationFailures([{ ...operation, simulation: undefined }], [source], API_WRITE_SIMULATION_CASES, testSource).length);
  assert.ok(integrationWriteSimulationFailures([operation], [source], [], testSource).length);
  assert.ok(integrationWriteSimulationFailures([operation], [{ ...source, source: "router.post('/new', () => {});" }], API_WRITE_SIMULATION_CASES, testSource).length);
  assert.ok(integrationWriteSimulationFailures([operation], [{ ...source, source: source.source.replace('async database', 'async ()') }], API_WRITE_SIMULATION_CASES, testSource).length);
});
