import assert from 'node:assert/strict';
import test from 'node:test';

import { createApiTokenAuthenticator } from '../src/middleware/api-token-auth.js';
import { createApiToken } from '../src/lib/api-credentials/token.js';

const key = 'external-auth-test-key-with-at-least-32-characters';
const issued = createApiToken({ key, keyVersion: 1 });

function credential(overrides = {}) {
  return {
    id: 'cred_1', selector: issued.selector, secretVerifier: issued.verifier, hashKeyVersion: 1,
    startsAt: new Date('2026-09-01Z'), expiresAt: new Date('2026-10-01Z'), revokedAt: null, overlapEndsAt: null,
    allowedIpCidrs: [], scopes: [{ scopeCode: 'qualidade.registros.read' }], projects: [], projectAccessMode: 'ALL',
    ...overrides
  };
}

function invoke(middleware, authorization, row) {
  return new Promise((resolve, reject) => {
    const req = { headers: { authorization }, ip: '203.0.113.9', socket: { remoteAddress: '203.0.113.9' } };
    const res = {
      statusCode: 200,
      setHeader() {},
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ next: false, statusCode: this.statusCode, body, req }); return this; }
    };
    const prismaClient = { apiCredential: { async findUnique() { return row; } } };
    const tested = createApiTokenAuthenticator({ prismaClient, envConfig: { apiTokenHashKeys: { 1: key } }, now: () => new Date('2026-09-04Z') });
    tested(req, res, error => error ? reject(error) : resolve({ next: true, statusCode: 200, req }));
  });
}

test('missing, malformed, unknown, scheduled, expired, revoked and human session tokens are indistinguishable', async () => {
  const cases = [
    ['', null], ['Bearer human-session-token', null], ['Bearer fva_bad', null],
    [`Bearer ${issued.token}`, null],
    [`Bearer ${issued.token}`, credential({ startsAt: new Date('2026-09-05Z') })],
    [`Bearer ${issued.token}`, credential({ expiresAt: new Date('2026-09-03Z') })],
    [`Bearer ${issued.token}`, credential({ revokedAt: new Date('2026-09-03Z') })]
  ];
  const results = await Promise.all(cases.map(([header, row]) => invoke(null, header, row)));
  for (const result of results) {
    assert.equal(result.statusCode, 401);
    assert.deepEqual(result.body, { code: 'INVALID_TOKEN', message: 'Credencial de integração inválida.', requestId: result.body.requestId });
  }
  assert.equal(new Set(results.map(result => `${result.body.code}:${result.body.message}`)).size, 1);
});

test('valid token exposes only server-side credential context and enforces CIDR', async () => {
  const ok = await invoke(null, `Bearer ${issued.token}`, credential({
    allowedIpCidrs: ['203.0.113.0/24'], projectAccessMode: 'SELECTED',
    projects: [{ projectId: 'project-1', project: { code: '05776' } }]
  }));
  assert.equal(ok.next, true);
  assert.equal(ok.req.apiAuth.credentialId, 'cred_1');
  assert.equal(ok.req.apiAuth.scopeCodes.has('qualidade.registros.read'), true);
  assert.equal(ok.req.apiAuth.projectCodes.has('05776'), true);
  assert.equal('token' in ok.req.apiAuth, false);
  const denied = await invoke(null, `Bearer ${issued.token}`, credential({ allowedIpCidrs: ['10.0.0.0/8'] }));
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.body.code, 'IP_NOT_ALLOWED');
});
