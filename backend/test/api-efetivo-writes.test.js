import assert from 'node:assert/strict';
import test from 'node:test';

import { validateCommercialFact, validateCrmDocument, validateProjectCreation, validateProjectWriteAccess, upsertCrmCommercialFact } from '../src/lib/api-credentials/efetivo-project-writes.js';
import { validatePlaygroundRequest } from '../src/lib/api-credentials/playground.js';
import { createOperationalRouter } from '../src/routes/integrations/v1/operational.js';

const fact = {
  key: 'CONTRACT_SIGNED', status: 'CONFIRMED', reference: 'Contrato 123',
  occurredOn: '2026-09-30', externalId: 'crm-fact-123', sourceVersion: '1',
  sourceUpdatedAt: '2026-09-30T12:00:00.000Z'
};

function databaseDouble({ workflow = true } = {}) {
  let stored = null;
  let versions = 0;
  const database = {
    project: { findFirst: async () => ({ id: 'p1', workflow: workflow ? { projectId: 'p1' } : null }) },
    projectWorkflowCommercialFact: {
      findUnique: async () => stored,
      upsert: async ({ create, update }) => {
        stored = stored ? { ...stored, ...update } : { ...create };
      },
      update: async ({ data }) => { stored = { ...stored, ...data }; }
    },
    projectWorkflow: { update: async () => { versions += 1; } },
    projectWorkflowEvent: { create: async () => ({}) },
    $transaction: async callback => callback(database),
    get state() { return { stored, versions }; }
  };
  return database;
}

test('CRM writes validate scope of projects and strict operation bodies', () => {
  assert.throws(() => validateProjectWriteAccess(null, {}, { projectAccessMode: 'SELECTED' }, { create: true }), error => error.code === 'PROJECT_NOT_ALLOWED');
  assert.throws(() => validateProjectWriteAccess('p2', {}, { projectAccessMode: 'SELECTED', projectIds: new Set(['p1']) }), error => error.code === 'PROJECT_NOT_ALLOWED');
  assert.equal(validateProjectWriteAccess('p1', {}, { projectAccessMode: 'SELECTED', projectIds: new Set(['p1']) }), 'p1');
  assert.throws(() => validateProjectCreation({ code: 'p1' }));
  assert.throws(() => validateCommercialFact({ ...fact, status: 'CONFIRMED', occurredOn: null }));
  assert.throws(() => validateCrmDocument({ type: 'CONTRACT', title: 'Contrato', externalId: 'd1', sourceVersion: '1', sourceUpdatedAt: fact.sourceUpdatedAt, fileData: 'raw' }));
  assert.equal(validatePlaygroundRequest({ operationId: 'efetivo.projects.commercialFact.post', pathParams: { id: 'p1' }, body: fact }).operationId, 'efetivo.projects.commercialFact.post');
  assert.throws(() => validatePlaygroundRequest({ operationId: 'efetivo.projects.commercialFact.post', pathParams: { id: 'p1' }, body: { ...fact, secret: 'x' } }));
});

test('each CRM POST route requires its own write scope', () => {
  const routes = [
    ['/efetivo/projetos', 'efetivo.projetos.create'],
    ['/efetivo/projetos/:id/fatos-comerciais', 'efetivo.projetos.fatos-comerciais.write'],
    ['/efetivo/projetos/:id/documentos', 'efetivo.projetos.documentos.write']
  ];
  const router = createOperationalRouter();
  for (const [path, scope] of routes) {
    const route = router.stack.find(layer => layer.route?.path === path)?.route;
    assert.equal(route?.methods.post, true);
    let allowed = false;
    route.stack[0].handle({ apiAuth: { scopeCodes: new Set([scope]) }, query: {} }, {}, () => { allowed = true; });
    assert.equal(allowed, true);
    const res = { status(code) { this.statusCode = code; return this; }, setHeader() {}, json(body) { this.body = body; } };
    route.stack[0].handle({ apiAuth: { scopeCodes: new Set(['efetivo.projetos.status.read']) }, query: {}, requestId: 'request-123' }, res, () => assert.fail('READ não autoriza POST'));
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'INSUFFICIENT_SCOPE');
  }
});

test('CRM commercial fact creates, replays and ignores older events without changing workflow again', async () => {
  const database = databaseDouble();
  assert.equal((await upsertCrmCommercialFact(database, 'p1', fact)).outcome, 'CREATED');
  assert.equal(database.state.stored.source, 'CRM');
  assert.equal(database.state.versions, 1);
  assert.equal((await upsertCrmCommercialFact(database, 'p1', fact)).outcome, 'REPLAYED');
  assert.equal(database.state.versions, 1);
  assert.equal((await upsertCrmCommercialFact(database, 'p1', { ...fact, sourceVersion: '0', sourceUpdatedAt: '2026-09-29T12:00:00.000Z' })).outcome, 'IGNORED_OLDER');
  assert.equal(database.state.versions, 1);
  await assert.rejects(() => upsertCrmCommercialFact(database, 'p1', { ...fact, reference: 'Different' }), error => error.code === 'SOURCE_VERSION_CONFLICT');
  assert.equal((await upsertCrmCommercialFact(database, 'p1', { ...fact, sourceVersion: '2' })).outcome, 'UPDATED');
  assert.equal(database.state.versions, 2);
});

test('CRM commercial fact requires a started workflow', async () => {
  await assert.rejects(() => upsertCrmCommercialFact(databaseDouble({ workflow: false }), 'p1', fact), error => error.code === 'WORKFLOW_NOT_STARTED');
});

test('CRM commercial fact retries a serialization conflict before writing', async () => {
  const database = databaseDouble();
  const originalTransaction = database.$transaction;
  let attempts = 0;
  database.$transaction = async (callback, options) => {
    assert.equal(options.isolationLevel, 'Serializable');
    attempts += 1;
    if (attempts === 1) throw { code: 'P2034' };
    return originalTransaction(callback);
  };
  assert.equal((await upsertCrmCommercialFact(database, 'p1', fact)).outcome, 'CREATED');
  assert.equal(attempts, 2);
});
