import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeAdminEvent, sanitizeRequestLog } from '../src/lib/api-credentials/audit.js';
import { reserveCredentialQuota, settleCredentialQuota } from '../src/lib/api-credentials/quota.js';

function memoryQuotaStore() {
  const state = { requests: 0, rows: 0, bytes: 0 };
  return {
    state,
    async reserve({ limits, requestedRows }) {
      if (state.requests >= limits.requestsPerMinute || state.requests >= limits.requestsPerDay) return null;
      if (state.rows + requestedRows > limits.rowsPerDay) return null;
      state.requests += 1;
      state.rows += requestedRows;
      return { requestedRows };
    },
    async settle({ reservation, actualRows, responseBytes }) {
      state.rows -= reservation.requestedRows - actualRows;
      state.bytes += responseBytes;
    }
  };
}

test('a page larger than the entire daily row quota is rejected before reservation or data access', async () => {
  let reserved = false;
  await assert.rejects(() => reserveCredentialQuota({
    store: { async reserve() { reserved = true; return {}; } }, credentialId: 'test', requestedRows: 100,
    limits: { requestsPerMinute: 60, requestsPerDay: 1000, rowsPerDay: 10 }
  }), error => error.statusCode === 429 && error.code === 'QUOTA_EXCEEDED');
  assert.equal(reserved, false);
});

test('quota reservations remain bounded under concurrent calls and reconcile actual rows/bytes', async () => {
  const store = memoryQuotaStore();
  const params = {
    store, credentialId: 'cred_1', requestedRows: 10, now: new Date('2026-09-04T12:00:00Z'),
    limits: { requestsPerMinute: 2, requestsPerDay: 5, rowsPerDay: 25 }
  };
  const settled = await Promise.allSettled(Array.from({ length: 4 }, () => reserveCredentialQuota(params)));
  assert.equal(settled.filter(item => item.status === 'fulfilled').length, 2);
  assert.equal(settled.filter(item => item.status === 'rejected').length, 2);
  await settleCredentialQuota({ store, reservation: settled[0].value, actualRows: 4, responseBytes: 512 });
  assert.deepEqual(store.state, { requests: 2, rows: 14, bytes: 512 });
});

test('audit allowlists drop authorization, tokens, payloads, responses and unexpected PII', () => {
  const event = sanitizeAdminEvent({
    credentialId: 'cred_1', actorUserId: 'user_1', type: 'CREATED', reason: 'Integração aprovada',
    token: 'fva_secret', Authorization: 'Bearer secret', body: { password: 'x' }, response: { rows: [1] }
  });
  assert.deepEqual(event, { credentialId: 'cred_1', actorUserId: 'user_1', type: 'CREATED', reason: 'Integração aprovada' });

  const log = sanitizeRequestLog({
    credentialId: 'cred_1', requestId: 'req_1', operationId: 'quality.records.list',
    scopeCode: 'qualidade.registros.read', pathTemplate: '/qualidade/registros', statusCode: 200,
    outcomeCode: 'OK', responseRows: 3, responseBytes: 120, durationMs: 8, clientIp: '203.0.113.1',
    userAgent: 'safe-client/1.0', filterSummary: { projectId: 'p1' }, token: 'fva_secret', body: { a: 1 }
  });
  assert.equal(log.responseRows, 3);
  assert.equal(log.token, undefined);
  assert.equal(log.body, undefined);
  assert.doesNotMatch(JSON.stringify(log), /fva_secret|Authorization|password/);
});
