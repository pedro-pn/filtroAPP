import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decryptSignatureToken,
  encryptSignatureToken,
  signatureTokenData,
  signatureTokenHash
} from '../src/lib/signature-token.js';
import env, { assertProductionSignatureTokenSecretConfigured } from '../src/config/env.js';

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

test('signature token decryption supports previous signing secrets during rotation', () => {
  const previousEnv = {
    signatureTokenSecret: env.signatureTokenSecret,
    previousSignatureTokenSecrets: env.previousSignatureTokenSecrets
  };
  try {
    env.signatureTokenSecret = 'old-signature-token-secret';
    env.previousSignatureTokenSecrets = [];
    const encrypted = encryptSignatureToken('rotating-signature-token');

    env.signatureTokenSecret = 'new-signature-token-secret';
    env.previousSignatureTokenSecrets = ['old-signature-token-secret'];

    assert.equal(decryptSignatureToken(encrypted), 'rotating-signature-token');
  } finally {
    env.signatureTokenSecret = previousEnv.signatureTokenSecret;
    env.previousSignatureTokenSecrets = previousEnv.previousSignatureTokenSecrets;
  }
});

test('production requires an explicit signature token secret', () => {
  assert.throws(
    () => assertProductionSignatureTokenSecretConfigured({ nodeEnv: 'production', signatureTokenSecret: '' }),
    /SIGNATURE_TOKEN_SECRET/
  );
  assert.doesNotThrow(
    () => assertProductionSignatureTokenSecretConfigured({ nodeEnv: 'production', signatureTokenSecret: 'secret' })
  );
});
