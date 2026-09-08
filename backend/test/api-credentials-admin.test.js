import assert from 'node:assert/strict';
import test from 'node:test';

import { requireHubAdmin } from '../src/middleware/auth.js';
import { API_SCOPES, assertApiCatalogIntegrity } from '../src/lib/api-credentials/catalog.js';
import { createCredential, effectiveCredentialStatus, getCredential, listCredentials } from '../src/lib/api-credentials/service.js';

const key = 'admin-test-api-token-key-with-at-least-32-characters';

function responseDouble() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function credentialRow(overrides = {}) {
  return {
    id: 'cred_1', selector: 'abcdefghijklmnop', secretVerifier: 'a'.repeat(64), hashKeyVersion: 1,
    secretLastFour: 'wxyz', name: 'BI Qualidade', purpose: 'Extrair indicadores mensais', recipientName: 'Equipe de dados',
    recipientContact: null, description: null, startsAt: new Date('2026-09-04T12:00:00Z'), expiresAt: new Date('2026-10-04T12:00:00Z'),
    neverExpiresConfirmedAt: null, projectAccessMode: 'SELECTED', allowedIpCidrs: [], allowedFormats: ['JSON'],
    requestsPerMinute: 60, requestsPerDay: 10000, rowsPerDay: 500000, maxPageSize: 100,
    lastUsedAt: null, revokedAt: null, revocationReason: null, rotatedFromId: null, overlapEndsAt: null, version: 1,
    createdAt: new Date('2026-09-04T12:00:00Z'), updatedAt: new Date('2026-09-04T12:00:00Z'),
    scopes: [{ scopeCode: 'qualidade.registros.read' }], projects: [{ projectId: 'project_1' }],
    createdBy: { id: 'admin_1', name: 'Admin' }, replacement: null,
    ...overrides
  };
}

function fakePrisma() {
  const rows = [];
  const events = [];
  const tx = {
    apiCredential: {
      async create({ data }) {
        const row = credentialRow({
          ...data,
          id: `cred_${rows.length + 1}`,
          scopes: data.scopes.create.map(item => ({ scopeCode: item.scopeCode })),
          projects: (data.projects?.create || []).map(item => ({ projectId: item.projectId })),
          createdBy: { id: data.createdByUserId, name: 'Admin' }, replacement: null,
          createdAt: new Date('2026-09-04T12:00:00Z'), updatedAt: new Date('2026-09-04T12:00:00Z')
        });
        rows.push(row);
        return row;
      }
    },
    apiCredentialEvent: { async create({ data }) { events.push(data); return data; } }
  };
  return {
    rows, events,
    apiCredential: {
      async findUnique({ where }) { return rows.find(row => row.issuanceRequestId === where.issuanceRequestId || row.id === where.id) || null; },
      async findMany() { return rows; }
    },
    async $transaction(callback) { return callback(tx); }
  };
}

const validInput = {
  name: 'BI Qualidade', purpose: 'Extrair indicadores mensais', recipientName: 'Equipe de dados', recipientContact: null, description: null,
  startsAt: '2026-09-04T12:00:00.000Z', expiresAt: '2026-10-04T12:00:00.000Z',
  scopeCodes: ['qualidade.registros.read'], projectAccess: { mode: 'SELECTED', projectIds: ['project_1'] },
  allowedIpCidrs: [], allowedFormats: ['JSON'], limits: { requestsPerMinute: 60, requestsPerDay: 10000, rowsPerDay: 500000, maxPageSize: 100 }
};

test('admin routes require accountType ADMIN, not a legacy manager role', () => {
  for (const accountType of ['INTERNAL', 'CLIENT']) {
    const res = responseDouble();
    let nextCalled = false;
    requireHubAdmin({ auth: { user: { accountType, role: 'MANAGER' } } }, res, () => { nextCalled = true; });
    assert.equal(res.statusCode, 403);
    assert.equal(nextCalled, false);
  }
  let nextCalled = false;
  requireHubAdmin({ auth: { user: { accountType: 'ADMIN', role: 'USER' } } }, responseDouble(), () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test('catalog preserves five quality scopes alongside reviewed operational scopes', () => {
  assert.equal(assertApiCatalogIntegrity(), true);
  assert.equal(API_SCOPES.filter(scope => scope.code.startsWith('qualidade.') && scope.status === 'AVAILABLE').length, 5);
  assert.equal(API_SCOPES.filter(scope => scope.status === 'AVAILABLE').length, 33);
});

test('new issuance can select operational scopes without changing an existing quality credential', async () => {
  const db = fakePrisma();
  const options = { actorUserId: 'admin_1', now: new Date('2026-09-04T12:00:00Z'), activeKeyVersion: 1, hashKeys: { 1: key } };
  await createCredential(db, validInput, { ...options, idempotencyKey: '10000000-1111-4111-8111-111111111111' });
  const scopeCodes = API_SCOPES.filter(scope => !scope.code.startsWith('qualidade.')).map(scope => scope.code);
  const issued = await createCredential(db, { ...validInput, scopeCodes }, { ...options, idempotencyKey: '20000000-1111-4111-8111-111111111111' });
  assert.deepEqual(issued.credential.scopeCodes.sort(), scopeCodes.sort());
  assert.deepEqual(db.rows[0].scopes, [{ scopeCode: 'qualidade.registros.read' }]);
});

test('create reveals once, while list/detail serialize no verifier or token and idempotent replay conflicts', async () => {
  const db = fakePrisma();
  const result = await createCredential(db, validInput, {
    actorUserId: 'admin_1', idempotencyKey: '11111111-1111-4111-8111-111111111111', now: new Date('2026-09-04T12:00:00Z'),
    activeKeyVersion: 1, hashKeys: { 1: key }
  });
  assert.match(result.token, /^fva_/);
  assert.equal(result.tokenShownOnce, true);
  assert.doesNotMatch(JSON.stringify(result.credential), /secretVerifier|hashKeyVersion/);
  const page = await listCredentials(db, {}, { now: new Date('2026-09-04T12:00:00Z') });
  const detail = await getCredential(db, db.rows[0].id, { now: new Date('2026-09-04T12:00:00Z') });
  assert.equal(page.items.length, 1);
  assert.doesNotMatch(JSON.stringify([page, detail]), /secretVerifier|"token":/);
  await assert.rejects(() => createCredential(db, validInput, {
    actorUserId: 'admin_1', idempotencyKey: '11111111-1111-4111-8111-111111111111', now: new Date('2026-09-04T12:00:00Z'),
    activeKeyVersion: 1, hashKeys: { 1: key }
  }), error => error.code === 'IDEMPOTENCY_REPLAY');
});

test('no-expiration issuance requires exact typed confirmation and statuses are derived', async () => {
  const db = fakePrisma();
  await assert.rejects(() => createCredential(db, { ...validInput, expiresAt: null }, {
    actorUserId: 'admin_1', idempotencyKey: '22222222-2222-4222-8222-222222222222', now: new Date('2026-09-04T12:00:00Z'),
    activeKeyVersion: 1, hashKeys: { 1: key }
  }));
  await createCredential(db, { ...validInput, expiresAt: null, neverExpiresConfirmation: 'SEM EXPIRAÇÃO' }, {
    actorUserId: 'admin_1', idempotencyKey: '33333333-3333-4333-8333-333333333333', now: new Date('2026-09-04T12:00:00Z'),
    activeKeyVersion: 1, hashKeys: { 1: key }
  });
  assert.ok(db.rows[0].neverExpiresConfirmedAt instanceof Date);
  assert.equal(effectiveCredentialStatus(credentialRow({ startsAt: new Date('2026-09-05Z') }), new Date('2026-09-04Z')), 'SCHEDULED');
  assert.equal(effectiveCredentialStatus(credentialRow({ expiresAt: new Date('2026-09-04Z') }), new Date('2026-09-05Z')), 'EXPIRED');
  assert.equal(effectiveCredentialStatus(credentialRow({ revokedAt: new Date('2026-09-04Z') }), new Date('2026-09-05Z')), 'REVOKED');
});

test('list filters status in the database and composes search with cursor instead of overwriting it', async () => {
  let captured;
  const cursor = Buffer.from(JSON.stringify({ createdAt: '2026-09-03T12:00:00.000Z', id: 'cred-cursor' })).toString('base64url');
  const prisma = { apiCredential: { async findMany(args) { captured = args; return []; } } };
  await listCredentials(prisma, { q: 'dados', status: 'ACTIVE', cursor }, { now: new Date('2026-09-04T12:00:00Z') });
  assert.equal(captured.where.AND.length, 3);
  assert.ok(captured.where.AND[0].OR.some(item => item.name));
  assert.ok(captured.where.AND[1].AND);
  assert.ok(captured.where.AND[2].OR.some(item => item.createdAt));
});

test('malformed administrative cursor is a stable 400 error', async () => {
  const prisma = { apiCredential: { async findMany() { assert.fail('consulta não deveria executar'); } } };
  await assert.rejects(() => listCredentials(prisma, { cursor: Buffer.from(JSON.stringify({ createdAt: 'invalid', id: '' })).toString('base64url') }), error => error.code === 'INVALID_CURSOR' && error.statusCode === 400);
});

test('idempotency key must be a UUID and cannot become a disguised persisted secret', async () => {
  const db = fakePrisma();
  await assert.rejects(() => createCredential(db, validInput, {
    actorUserId: 'admin_1',
    idempotencyKey: 'fva_1234567890abcdef_abcdefghijklmnopqrstuvwxyzABCDEFGH1',
    now: new Date('2026-09-04T12:00:00Z'),
    activeKeyVersion: 1,
    hashKeys: { 1: key }
  }), error => error.code === 'IDEMPOTENCY_KEY_REQUIRED' && error.statusCode === 400);
  assert.equal(db.rows.length, 0);
});
