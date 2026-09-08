import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  computeTokenVerifier,
  createApiToken,
  parseApiToken,
  serializeCredentialPublic,
  verifyApiToken
} from '../src/lib/api-credentials/token.js';

const key = 'test-api-token-hmac-key-with-more-than-32-characters';

test('tokens use the strict fva selector/secret format with 256-bit random secrets', () => {
  const issued = Array.from({ length: 64 }, () => createApiToken({ key, keyVersion: 1 }));
  assert.equal(new Set(issued.map(item => item.token)).size, issued.length);

  for (const item of issued) {
    assert.match(item.token, /^fva_[A-Za-z0-9_-]{16}_[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(parseApiToken(item.token).secret, 'base64url').length, 32);
    assert.equal(item.verifier, computeTokenVerifier({ selector: item.selector, secret: item.secret, key }));
  }
});

test('token parser rejects ambiguous or malformed authorization values', () => {
  for (const value of ['', 'Bearer fva_a_b', 'fva_a_b', 'fva_1234567890123456_bad!', 'fva_a_b_extra']) {
    assert.equal(parseApiToken(value), null);
  }
});

test('versioned HMAC verification accepts the right key and follows the dummy path for unknown selectors', () => {
  const issued = createApiToken({ key, keyVersion: 7 });
  const credential = {
    selector: issued.selector,
    secretVerifier: issued.verifier,
    hashKeyVersion: 7
  };

  assert.equal(verifyApiToken({ rawToken: issued.token, credential, keyResolver: version => version === 7 ? key : '' }), true);
  assert.equal(verifyApiToken({ rawToken: `${issued.token.slice(0, -1)}A`, credential, keyResolver: () => key }), false);
  assert.equal(verifyApiToken({ rawToken: issued.token, credential: null, keyResolver: () => key }), false);
});

test('public serialization never exposes token, secret or verifier', () => {
  const publicValue = serializeCredentialPublic({
    id: 'cred_1', selector: '1234567890123456', secretVerifier: 'hmac', hashKeyVersion: 1,
    secretLastFour: 'abcd', name: 'BI Qualidade', scopes: [], token: 'fva_should_not_leak'
  });
  const serialized = JSON.stringify(publicValue);
  assert.equal(publicValue.tokenPrefix, 'fva_1234567890123456');
  assert.equal(publicValue.secretLastFour, 'abcd');
  assert.doesNotMatch(serialized, /secretVerifier|hashKeyVersion|fva_should_not_leak/);
});

test('migration keeps security policy arrays non-null', async () => {
  const migration = await readFile(new URL('../prisma/migrations/20260904180000_api_token_playground/migration.sql', import.meta.url), 'utf8');
  assert.match(migration, /"allowedIpCidrs" TEXT\[\] NOT NULL DEFAULT/);
  assert.match(migration, /"allowedFormats" TEXT\[\] NOT NULL DEFAULT/);
});
