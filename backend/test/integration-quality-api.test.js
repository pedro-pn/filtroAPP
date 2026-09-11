import assert from 'node:assert/strict';
import test from 'node:test';

import { createSignedCursor } from '../src/lib/api-credentials/cursor.js';
import { listIntegrationQualityRecords } from '../src/lib/qualidade/integration-service.js';

const key = 'quality-integration-cursor-key-over-32-characters';
const makeRow = (id, updatedAt) => ({
  id, number: id, type: 'DESVIO', registeredAt: new Date('2026-01-01Z'), origin: null, projectId: 'p1', eventDate: new Date('2026-01-01Z'),
  natureId: null, description: null, impact: null, linkedRnc: null, disposition: null, definedAction: null, actionOwner: null,
  actionDeadline: null, evidence: null, resultVerification: null, status: 'ABERTO', deletedAt: null,
  createdAt: new Date('2026-01-01Z'), updatedAt: new Date(updatedAt), project: { id: 'p1', code: 'P1', name: 'P1' }, nature: null, evidences: []
});

function clientWithRows(rows) {
  return { qualityRecord: { async findMany(args) { clientWithRows.lastArgs = args; return rows.slice(0, args.take); } } };
}

test('full/incremental query fixes snapshot, orders by updatedAt/id and emits a signed next cursor', async () => {
  const rows = [makeRow('a', '2026-09-03Z'), makeRow('b', '2026-09-03Z'), makeRow('c', '2026-09-04Z')];
  const client = clientWithRows(rows);
  const result = await listIntegrationQualityRecords(client, {
    limit: 2, updatedSince: '2026-09-01T00:00:00.000Z', projectId: 'p1'
  }, { cursorKey: key, snapshotAt: new Date('2026-09-04T12:00:00Z'), scopes: new Set(['qualidade.registros.read']), projectAccessMode: 'ALL' });
  assert.equal(result.items.length, 2);
  assert.equal(result.page.hasMore, true);
  assert.ok(result.page.nextCursor);
  assert.deepEqual(clientWithRows.lastArgs.orderBy, [{ updatedAt: 'asc' }, { id: 'asc' }]);
  assert.equal(result.page.snapshotAt, '2026-09-04T12:00:00.000Z');
});

test('projectCode filters by the public project code and respects the credential project set', async () => {
  const client = clientWithRows([makeRow('a', '2026-09-03Z')]);
  await listIntegrationQualityRecords(client, { limit: 10, projectCode: '05776' }, {
    cursorKey: key, snapshotAt: new Date('2026-09-04T12:00:00Z'), scopes: new Set(['qualidade.registros.read']),
    projectAccessMode: 'SELECTED', projectIds: new Set(['p1']), projectCodes: new Set(['05776'])
  });
  assert.deepEqual(clientWithRows.lastArgs.where.project, { code: '05776' });
  await assert.rejects(() => listIntegrationQualityRecords(client, { limit: 10, projectCode: '9999' }, {
    cursorKey: key, scopes: new Set(['qualidade.registros.read']), projectAccessMode: 'SELECTED',
    projectIds: new Set(['p1']), projectCodes: new Set(['05776'])
  }), error => error.code === 'PROJECT_NOT_ALLOWED');
});

test('cursor tampering, changed filters and page limits are rejected', async () => {
  const client = clientWithRows([]);
  const payload = { operationId: 'quality.records.list', version: 1, filters: { projectId: 'p1' }, position: { updatedAt: '2026-09-03T00:00:00.000Z', id: 'a' }, snapshotAt: '2026-09-04T00:00:00.000Z' };
  const cursor = createSignedCursor({ payload, key });
  await assert.rejects(() => listIntegrationQualityRecords(client, { limit: 10, cursor, projectId: 'p2' }, { cursorKey: key, scopes: new Set(['qualidade.registros.read']), maxPageSize: 100, projectAccessMode: 'ALL' }), error => error.code === 'INVALID_CURSOR' && error.statusCode === 400);
  await assert.rejects(() => listIntegrationQualityRecords(client, { limit: 101 }, { cursorKey: key, scopes: new Set(['qualidade.registros.read']), maxPageSize: 100, projectAccessMode: 'ALL' }), /limite/i);
});

test('recurrence aggregation is constrained to the credential project set', async () => {
  const calls = [];
  const row = { ...makeRow('a', '2026-09-03Z'), natureId: 'nature-1', nature: { id: 'nature-1', name: 'Desvio', isActive: true } };
  const client = { qualityRecord: { async findMany(args) {
    calls.push(args);
    return args.select?.number ? [row] : [];
  } } };
  await listIntegrationQualityRecords(client, { limit: 10 }, {
    cursorKey: key,
    snapshotAt: new Date('2026-09-04T12:00:00Z'),
    scopes: new Set(['qualidade.registros.read']),
    projectAccessMode: 'SELECTED',
    projectIds: new Set(['p1', 'p2']),
    maxPageSize: 100
  });
  assert.deepEqual(calls[1].where.projectId, { in: ['p1', 'p2'] });
});
