import assert from 'node:assert/strict';
import test from 'node:test';

import { effectiveCredentialStatus, revokeCredential, validateRotationWindow } from '../src/lib/api-credentials/service.js';
import { assertPolicyReduction } from '../src/lib/api-credentials/authorization.js';

const current = {
  id: 'cred_1', version: 2, startsAt: new Date('2026-09-01Z'), expiresAt: new Date('2026-10-01Z'), revokedAt: null, overlapEndsAt: null,
  scopeCodes: ['qualidade.registros.read', 'qualidade.naturezas.read'], projectAccess: { mode: 'SELECTED', projectIds: ['p1', 'p2'] },
  allowedIpCidrs: ['10.0.0.0/8'], limits: { requestsPerMinute: 60, requestsPerDay: 1000, rowsPerDay: 10000, maxPageSize: 100 }
};

test('policy updates accept reduction and reject every privilege expansion dimension', () => {
  assert.doesNotThrow(() => assertPolicyReduction(current, {
    scopeCodes: ['qualidade.registros.read'], projectAccess: { mode: 'SELECTED', projectIds: ['p1'] },
    allowedIpCidrs: ['10.10.0.0/16'], expiresAt: '2026-09-20T00:00:00Z',
    limits: { requestsPerMinute: 30, requestsPerDay: 500, rowsPerDay: 5000, maxPageSize: 50 }
  }));
  for (const patch of [
    { scopeCodes: [...current.scopeCodes, 'qualidade.excluidos.read'] },
    { projectAccess: { mode: 'ALL', projectIds: [] } },
    { projectAccess: { mode: 'SELECTED', projectIds: ['p1', 'p3'] } },
    { allowedIpCidrs: [] },
    { expiresAt: '2026-11-01T00:00:00Z' },
    { limits: { ...current.limits, maxPageSize: 200 } }
  ]) assert.throws(() => assertPolicyReduction(current, patch), error => error.code === 'ROTATION_REQUIRED');
});

test('rotation overlap is bounded and terminal statuses never reactivate', () => {
  const now = new Date('2026-09-04T12:00:00Z');
  assert.equal(validateRotationWindow(now, now, 60).toISOString(), now.toISOString());
  assert.equal(validateRotationWindow(new Date('2026-09-04T12:30:00Z'), now, 60).toISOString(), '2026-09-04T12:30:00.000Z');
  assert.throws(() => validateRotationWindow(new Date('2026-09-04T14:00:00Z'), now, 60), /sobreposição/i);
  assert.equal(effectiveCredentialStatus({ ...current, overlapEndsAt: new Date('2026-09-04T12:30:00Z') }, new Date('2026-09-04T12:31:00Z')), 'REVOKED');
  assert.equal(effectiveCredentialStatus({ ...current, expiresAt: new Date('2026-09-03Z') }, now), 'EXPIRED');
});

test('revocation is optimistic, terminal, justified and idempotent retries conflict', async () => {
  const row = { ...current, scopes: [], projects: [], selector: 'abcdefghijklmnop', secretLastFour: 'last', name: 'Token', purpose: 'Finalidade completa', recipientName: 'Dados', allowedFormats: ['JSON'], requestsPerMinute: 60, requestsPerDay: 1000, rowsPerDay: 10000, maxPageSize: 100, createdAt: new Date(), updatedAt: new Date(), createdBy: { id: 'a', name: 'A' }, replacement: null };
  const events = [];
  const prisma = {
    apiCredential: { async findUnique() { return row; } },
    apiCredentialEvent: { async findUnique({ where }) { return events.find(event => event.requestId === where.requestId) || null; } },
    async $transaction(callback) { return callback({
      apiCredential: {
        async updateMany({ data }) { Object.assign(row, data, { version: row.version + 1 }); return { count: 1 }; },
        async findUnique() { return row; }
      },
      apiCredentialEvent: { async create({ data }) { events.push(data); return data; } }
    }); }
  };
  const revoked = await revokeCredential(prisma, row.id, { expectedVersion: 2, reason: 'Acesso não é mais necessário.' }, { actorUserId: 'admin_1', idempotencyKey: '44444444-4444-4444-8444-444444444444', now: new Date('2026-09-04Z') });
  assert.equal(revoked.effectiveStatus, 'REVOKED');
  assert.equal(events[0].type, 'REVOKED');
  await assert.rejects(() => revokeCredential(prisma, row.id, { expectedVersion: 3, reason: 'Acesso não é mais necessário.' }, { actorUserId: 'admin_1', idempotencyKey: '44444444-4444-4444-8444-444444444444', now: new Date('2026-09-04Z') }), error => error.code === 'IDEMPOTENCY_REPLAY');
});
