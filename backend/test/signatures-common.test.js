import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeSignerEmail,
  signatureEvidenceFromRequest,
  signatureTokenExpiresAt
} from '../src/lib/signatures/common.js';

test('common signature helpers normalize signer email and request evidence', () => {
  assert.equal(normalizeSignerEmail(' Cliente@Exemplo.COM '), 'cliente@exemplo.com');
  assert.deepEqual(
    signatureEvidenceFromRequest({
      app: { get: () => true },
      ips: ['172.20.0.2', '8.8.8.8'],
      ip: '10.0.0.1',
      headers: { 'user-agent': 'Unit Test Browser' }
    }),
    {
      ipAddress: '8.8.8.8',
      userAgent: 'Unit Test Browser'
    }
  );
});

test('signatureTokenExpiresAt calculates expiration by day interval', () => {
  const before = Date.now();
  const expiresAt = signatureTokenExpiresAt(7);
  const after = Date.now();

  assert.ok(expiresAt.getTime() >= before + 7 * 24 * 60 * 60 * 1000);
  assert.ok(expiresAt.getTime() <= after + 7 * 24 * 60 * 60 * 1000);
});
