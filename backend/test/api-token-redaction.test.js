import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeAdminEvent, sanitizeRequestLog } from '../src/lib/api-credentials/audit.js';
import { sendIntegrationError } from '../src/middleware/api-request-context.js';
import { sanitizedHttpErrorForObservability } from '../src/app.js';
import { makeApiCredentialSchemas } from '../../shared/schemas/api-credentials.js';
import { z } from 'zod';

const token = 'fva_1234567890abcdef_abcdefghijklmnopqrstuvwxyzABCDEFGH1';
const hmac = 'a'.repeat(64);

function serialized(value) {
  return JSON.stringify(value);
}

test('administrative events discard unknown payloads and redact secrets, paths and PII', () => {
  const result = sanitizeAdminEvent({
    credentialId: 'cred-1',
    type: 'REVOKED',
    reason: `Vazou ${token} para pessoa@example.com`,
    requestId: token,
    actorUserAgent: `client Authorization: Bearer ${token}`,
    summary: {
      operationId: 'quality.records.list',
      response: { token },
      body: token,
      path: '/home/app/private/evidence.pdf',
      secretVerifier: hmac,
      recipientEmail: 'pessoa@example.com'
    }
  });
  const output = serialized(result);
  assert.doesNotMatch(output, /fva_|Bearer|example\.com|\/home\/|a{64}/);
  assert.deepEqual(result.summary, { operationId: 'quality.records.list' });
});

test('usage logs derive path/scope from the catalog and only retain allowlisted filter summaries', () => {
  const result = sanitizeRequestLog({
    credentialId: 'cred-1',
    requestId: 'request-safe-123',
    operationId: 'quality.records.list',
    scopeCode: 'qualidade.registros.read',
    pathTemplate: '/tmp/private/evidence.pdf',
    statusCode: 200,
    outcomeCode: 'OK',
    responseRows: 1,
    responseBytes: 42,
    durationMs: 5,
    userAgent: `Bearer ${token}`,
    filterSummary: { projectId: token, includeDeleted: false, email: 'pessoa@example.com', response: token },
    authorization: `Bearer ${token}`,
    response: { token }
  });
  const output = serialized(result);
  assert.equal(result.pathTemplate, '/qualidade/registros');
  assert.equal(result.scopeCode, 'qualidade.registros.read');
  assert.deepEqual(result.filterSummary, { projectId: '[REDACTED]', includeDeleted: false });
  assert.doesNotMatch(output, /fva_|Bearer|example\.com|\/tmp\//);
});

test('integration error envelopes never echo secret-bearing messages or fields', () => {
  let payload;
  const res = {
    setHeader() {},
    status(code) { assert.equal(code, 400); return this; },
    json(value) { payload = value; return value; }
  };
  sendIntegrationError(res, { requestId: 'request-safe-123' }, 400, 'VALIDATION_ERROR', `Bearer ${token}`, {
    fields: [{ path: 'query.token', message: `/var/private/${hmac}` }]
  });
  const output = serialized(payload);
  assert.doesNotMatch(output, /fva_|Bearer|\/var\/|a{64}/);
  assert.equal(payload.message, 'A requisição não pôde ser processada.');
  assert.equal(payload.fields[0].message, 'Valor inválido.');
});

test('global error observability redacts integration Authorization values', () => {
  const safe = sanitizedHttpErrorForObservability(new Error(`Falha para Bearer ${token}`), {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.doesNotMatch(String(safe.stack), /fva_/);
  assert.match(safe.message, /REDACTED/);
});

test('administrative input schemas reject secret material before it can be stored and serialized', () => {
  const schemas = makeApiCredentialSchemas(z);
  const base = {
    name: 'BI Qualidade', purpose: 'Carga diária controlada', recipientName: 'Time de dados',
    recipientContact: null, description: null, startsAt: '2026-09-04T12:00:00.000Z', expiresAt: '2026-09-05T12:00:00.000Z',
    scopeCodes: ['qualidade.registros.read'], projectAccess: { mode: 'ALL', projectIds: [] },
    allowedIpCidrs: [], allowedFormats: ['JSON'], limits: { requestsPerMinute: 10, requestsPerDay: 100, rowsPerDay: 1000, maxPageSize: 100 }
  };
  assert.equal(schemas.create.safeParse({ ...base, description: token }).success, false);
  assert.equal(schemas.revoke.safeParse({ expectedVersion: 1, reason: `Revogar chave ${hmac}` }).success, false);
});
