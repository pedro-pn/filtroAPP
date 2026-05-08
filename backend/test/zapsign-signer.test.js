import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveSignerUrlForUser,
  resolveZapSignSigner,
  zapsignAdditionalSignersForProject
} from '../src/lib/zapsign-signer.js';
import { ZAPSIGN_SIGNERS_KEY } from '../src/lib/zapsign-progress.js';

const project = {
  clientName: 'Cliente Primario',
  clientEmailPrimary: 'primary@example.com',
  clientEmailCc: ['cc@example.com', 'signer@example.com'],
  clientSigners: [
    { name: 'Assinante Extra', email: 'signer@example.com' }
  ]
};

test('resolveZapSignSigner rejects a CC client that is not configured as a signer', () => {
  assert.throws(
    () => resolveZapSignSigner({ project }, { email: 'cc@example.com', name: 'CC Client' }),
    error => error.statusCode === 403
  );
});

test('resolveZapSignSigner uses the authenticated configured signer identity', () => {
  assert.deepEqual(
    resolveZapSignSigner({ project }, { email: 'Signer@Example.com', name: 'Logged Name' }),
    {
      signerName: 'Assinante Extra',
      signerEmail: 'signer@example.com'
    }
  );
});

test('zapsignAdditionalSignersForProject includes the primary client when an extra signer starts the flow', () => {
  assert.deepEqual(
    zapsignAdditionalSignersForProject(project, 'signer@example.com'),
    [{ name: 'Cliente Primario', email: 'primary@example.com' }]
  );
});

test('resolveSignerUrlForUser never returns the primary signer token for another client', () => {
  const report = {
    zapsignSignerToken: 'primary-token',
    project,
    specialConditions: {}
  };

  assert.equal(resolveSignerUrlForUser(report, { email: 'cc@example.com' }), null);
});

test('resolveSignerUrlForUser returns a configured signer URL from stored ZapSign signers', () => {
  const report = {
    zapsignSignerToken: 'primary-token',
    project,
    specialConditions: {
      [ZAPSIGN_SIGNERS_KEY]: [
        { email: 'signer@example.com', signerUrl: 'https://sign.example.com/signer' }
      ]
    }
  };

  assert.equal(
    resolveSignerUrlForUser(report, { email: 'signer@example.com' }),
    'https://sign.example.com/signer'
  );
});
