import assert from 'node:assert/strict';
import test from 'node:test';
import { executePlaygroundOperation } from '../src/lib/api-credentials/playground.js';
import { getCredential, listCredentialEvents } from '../src/lib/api-credentials/service.js';
import { API_SCOPES } from '../src/lib/api-credentials/catalog.js';
import { publicQualityRecord, publicQualityNature, publicQualityEvidence } from '../src/lib/qualidade/public-serializer.js';
import { makeApiCredentialSchemas } from '../../shared/schemas/api-credentials.js';
import { z } from 'zod';
import { adminCredentialRequestContext, adminCredentialErrorHandler } from '../src/lib/api-credentials/admin-http.js';
import { IntegrationApiError } from '../src/middleware/api-request-context.js';

test('admin errors preserve safe diagnostics, legacy error, request ID and retry headers', () => {
  const req = {};
  const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  adminCredentialRequestContext(req, res, () => {});
  adminCredentialErrorHandler(new IntegrationApiError(429, 'RATE_LIMITED', 'Limite atingido.', { retryAfterSeconds: 30 }), req, res);
  assert.equal(res.statusCode, 429); assert.equal(res.body.error, res.body.message);
  assert.equal(res.body.requestId, res.headers['X-Request-Id']); assert.equal(res.headers['Retry-After'], '30');
  assert.equal(res.headers['Cache-Control'], 'no-store');
  adminCredentialErrorHandler(new Error('password secret /home/private user@example.com'), req, res);
  assert.equal(res.statusCode, 500); assert.equal(res.body.code, 'INTERNAL_ERROR');
  assert.doesNotMatch(JSON.stringify(res.body), /password|secret|\/home\/|user@example/);
  const invalid = z.object({ query: z.object({ limit: z.number().positive() }) }).safeParse({ query: { limit: -1 } });
  adminCredentialErrorHandler(invalid.error, req, res);
  assert.equal(res.statusCode, 400); assert.equal(res.body.fields[0].path, 'query.limit');
});

test('invalid operational parameters and credential IDs are rejected before Prisma', async () => {
  const db = { apiCredential: { findUnique() { assert.fail('Prisma não deve ser consultado'); } } };
  for (const query of [{ createdSince: 'invalid' }, { itemId: '' }, { active: 'maybe' }]) {
    const operationId = query.active ? 'operational.CompanyEquipment.list' : 'operational.StockMovement.list';
    await assert.rejects(() => executePlaygroundOperation(db, 'synthetic-id', { operationId, query }), e => e.name === 'ZodError');
  }
  for (const id of [' ', 'x'.repeat(101)]) await assert.rejects(() => getCredential(db, id), e => e.name === 'ZodError');
});

test('admin validation messages use Portuguese without echoing rejected values or changing the error contract', () => {
  const schema = z.object({ name: z.string().min(3), mode: z.enum(['ALL', 'SELECTED']), limit: z.number().int().positive(), date: z.string().datetime() }).strict();
  const invalid = schema.safeParse({ name: '', mode: 'Bearer ficticio', limit: 1.5, date: 'invalid', 'private@example.com': true });
  const req = { requestId: 'synthetic-request' };
  const res = { setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
  adminCredentialErrorHandler(invalid.error, req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'VALIDATION_ERROR');
  assert.equal(res.body.error, 'Parâmetros inválidos.');
  assert.equal(res.body.requestId, req.requestId);
  assert.equal(res.body.fields.length, 5);
  assert.ok(res.body.fields.some(field => field.path === 'date' && field.message === 'Informe uma data e hora válidas.'));
  assert.doesNotMatch(JSON.stringify(res.body), /Too small|Too big|Invalid|Expected|expected|received|Unrecognized|Bearer|private@example/);
});

test('event cursor requires a strict valid position before any query', async () => {
  const db = { apiCredentialEvent: { findMany() { assert.fail('Cursor inválido não consulta eventos'); } } };
  for (const cursor of ['!', ...[{}, null, [], { createdAt: 'invalid', id: 'event' }, { createdAt: '2026-09-08T12:00:00Z', id: '' }, { createdAt: '2026-09-08T12:00:00Z', id: 'event', extra: true }].map(v => Buffer.from(JSON.stringify(v)).toString('base64url'))]) {
    await assert.rejects(() => listCredentialEvents(db, 'synthetic-id', { cursor }), e => e.code === 'INVALID_CURSOR' && e.statusCode === 400);
  }
});

test('valid event cursors preserve chronological pagination and actor projection', async () => {
  let query;
  const cursor = Buffer.from(JSON.stringify({ createdAt: '2026-09-08T12:00:00Z', id: 'event' })).toString('base64url');
  await listCredentialEvents({ apiCredentialEvent: { async findMany(args) { query = args; return []; } } }, 'synthetic-id', { cursor });
  assert.equal(query.take, 26);
  assert.equal(query.where.OR[1].id.lt, 'event');
  assert.equal(query.select.actor.select.name, true);
});

test('quality catalog fields match public serializers, including tombstones and evidence availability', () => {
  const scope = code => API_SCOPES.find(s => s.code === code);
  assert.deepEqual(scope('qualidade.registros.read').exposedFields, Object.keys(publicQualityRecord({})));
  assert.deepEqual(scope('qualidade.naturezas.read').exposedFields, Object.keys(publicQualityNature({})));
  assert.deepEqual(scope('qualidade.evidencias.metadata.read').exposedFields, Object.keys(publicQualityEvidence({})));
  assert.ok(scope('qualidade.excluidos.read').exposedFields.includes('deletedAt'));
  assert.deepEqual(scope('qualidade.evidencias.download').exposedFields, ['arquivo original']);
});

test('shared policy rejects invalid IPs and CIDRs, allowing IPv4/IPv6 hosts and networks', () => {
  const schemas = makeApiCredentialSchemas(z);
  const input = { expectedVersion: 1, reason: 'Restringir integração' };
  for (const ip of ['invalid', '999.1.1.1', '203.0.113.0/33', '2001:db8::/129', '203.0.113.0/x']) assert.equal(schemas.reduce.safeParse({ ...input, allowedIpCidrs: [ip] }).success, false, ip);
  for (const ip of ['203.0.113.1', '203.0.113.0/24', '2001:db8::', '2001:db8::/32']) assert.equal(schemas.reduce.safeParse({ ...input, allowedIpCidrs: [ip] }).success, true, ip);
});
