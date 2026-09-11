import assert from 'node:assert/strict';
import test from 'node:test';

import { assertProjectAllowed } from '../src/lib/qualidade/integration-service.js';
import { publicQualityEvidence } from '../src/lib/qualidade/public-serializer.js';
import { requireApiOperation } from '../src/middleware/api-token-auth.js';

function authorize(operationId, scopeCodes, query = {}) {
  const req = { apiAuth: { scopeCodes: new Set(scopeCodes) }, query };
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  let next = false;
  requireApiOperation(operationId)(req, res, () => { next = true; });
  return { next, res };
}

test('operation scope matrix grants exactly the registered subsets', () => {
  assert.equal(authorize('quality.records.list', ['qualidade.registros.read']).next, true);
  assert.equal(authorize('quality.records.list', []).res.statusCode, 403);
  assert.equal(authorize('quality.records.list', ['qualidade.registros.read'], { includeDeleted: 'true' }).res.statusCode, 403);
  assert.equal(authorize('quality.natures.list', ['qualidade.naturezas.read']).next, true);
  assert.equal(authorize('quality.evidence.download', ['qualidade.registros.read', 'qualidade.evidencias.metadata.read']).res.statusCode, 403);
  assert.equal(authorize('quality.evidence.download', ['qualidade.registros.read', 'qualidade.evidencias.metadata.read', 'qualidade.evidencias.download']).next, true);
});

test('selected project policy cannot be bypassed by omitted or different project', () => {
  assert.doesNotThrow(() => assertProjectAllowed('p1', { projectAccessMode: 'SELECTED', projectIds: new Set(['p1']) }));
  assert.throws(() => assertProjectAllowed('p2', { projectAccessMode: 'SELECTED', projectIds: new Set(['p1']) }), /projeto/i);
  assert.throws(() => assertProjectAllowed(null, { projectAccessMode: 'SELECTED', projectIds: new Set(['p1']) }), /projeto/i);
});

test('evidence projection never leaks storage and download availability follows kind', () => {
  const result = publicQualityEvidence({ id: 'e1', kind: 'ATTACHMENT', label: null, fileName: 'a.pdf', mimeType: 'application/pdf', position: 0, createdAt: new Date('2026-09-01Z'), storagePath: '/secret', publicToken: 'secret' });
  assert.equal(result.downloadAvailable, true);
  assert.doesNotMatch(JSON.stringify(result), /storagePath|publicToken|secret/);
});
