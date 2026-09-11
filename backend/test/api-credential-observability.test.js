import assert from 'node:assert/strict';
import test from 'node:test';

import { recordApiRequest } from '../src/lib/api-credentials/audit.js';
import { getCredentialUsage } from '../src/lib/api-credentials/service.js';
import { retentionCutoffs, retentionTargets } from '../src/lib/data-retention.js';

test('usage log updates lastUsedAt without weakening revocation predicate', async () => {
  const calls = [];
  const prisma = {
    apiRequestLog: { create({ data }) { calls.push(['log', data]); return Promise.resolve(data); } },
    apiCredential: { updateMany(args) { calls.push(['credential', args]); return Promise.resolve({ count: 1 }); } },
    async $transaction(operations) { return Promise.all(operations); }
  };
  await recordApiRequest(prisma, { credentialId: 'c1', requestId: 'r1', operationId: 'quality.records.list', scopeCode: 'qualidade.registros.read', pathTemplate: '/qualidade/registros', statusCode: 200, outcomeCode: 'OK', responseRows: 2, responseBytes: 40, durationMs: 8 });
  assert.equal(calls[1][1].where.revokedAt, null);
  assert.ok(calls[1][1].where.OR);
  assert.equal(JSON.stringify(calls).includes('Authorization'), false);
});

test('usage summary aggregates only counts, rows and bytes', async () => {
  const prisma = { apiRequestLog: {
    async aggregate() { return { _count: { _all: 3 }, _sum: { responseRows: 12, responseBytes: 500 } }; },
    async groupBy({ by }) { return by[0] === 'statusCode' ? [{ statusCode: 200, _count: { _all: 2 } }, { statusCode: 429, _count: { _all: 1 } }] : [{ operationId: 'quality.records.list', _count: { _all: 3 } }]; }
  } };
  const result = await getCredentialUsage(prisma, 'c1', { from: '2026-09-01T00:00:00Z', to: '2026-09-05T00:00:00Z' });
  assert.deepEqual(result.byStatus, { 200: 2, 429: 1 });
  assert.deepEqual(result.byOperation, { 'quality.records.list': 3 });
  assert.equal(result.rows, 12);
  assert.equal('headers' in result, false);
});

test('retention includes request logs and quota buckets but preserves lifecycle events', () => {
  const targets = retentionTargets(retentionCutoffs(new Date('2026-09-04Z'), 365));
  assert.ok(targets.apiRequestLogs);
  assert.ok(targets.apiUsageBuckets);
  assert.equal(targets.apiCredentialEvents, undefined);
});
