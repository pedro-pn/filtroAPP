import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decryptSignatureToken,
  encryptSignatureToken,
  signatureTokenData,
  signatureTokenHash
} from '../src/lib/signature-token.js';

test('signature tokens are encrypted for storage and decrypt back to the original token', () => {
  const token = 'public-signature-token';
  const encrypted = encryptSignatureToken(token);

  assert.notEqual(encrypted.tokenEncrypted, token);
  assert.equal(decryptSignatureToken(encrypted), token);
  assert.equal(signatureTokenHash(token), signatureTokenHash(token));
});

test('signatureTokenData returns raw token, hash, and encrypted payload', () => {
  const data = signatureTokenData();

  assert.equal(typeof data.token, 'string');
  assert.equal(data.token.length, 64);
  assert.equal(data.tokenHash, signatureTokenHash(data.token));
  assert.equal(decryptSignatureToken(data), data.token);
});
