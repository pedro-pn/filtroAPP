import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACCOUNT_PASSWORD_SETUP_HOURS,
  createPendingPasswordHash,
  issueAccountPasswordSetup,
  passwordSetupUrlForToken
} from '../src/lib/accounts/password-setup.js';
import { createPasswordResetToken, hashToken } from '../src/lib/auth.js';
import { verifyPassword } from '../src/lib/password.js';

test('passwordSetupUrlForToken creates a unique-use setup route without duplicate slashes', () => {
  assert.equal(
    passwordSetupUrlForToken('https://app.example.com/', 'abc 123'),
    'https://app.example.com/reset-password?token=abc%20123&setup=1'
  );
  assert.equal(
    passwordSetupUrlForToken('', 'token'),
    '/reset-password?token=token&setup=1'
  );
});

test('issueAccountPasswordSetup invalidates prior links and returns the issued link', async () => {
  const calls = [];
  const expiresAt = new Date('2026-09-02T16:00:00.000Z');
  const prismaClient = {
    passwordResetToken: {
      deleteMany: async args => {
        calls.push(['deleteMany', args]);
        return { count: 1 };
      }
    }
  };

  const result = await issueAccountPasswordSetup({
    userId: 'user-1',
    prismaClient,
    envConfig: { appUrl: 'https://app.example.com' },
    createToken: async (userId, receivedPrisma, options) => {
      assert.equal(userId, 'user-1');
      assert.equal(receivedPrisma, prismaClient);
      assert.deepEqual(options, { expiresInHours: 24 * 7, tokenPrefix: 'setup_' });
      return { token: 'setup-token', expiresAt };
    }
  });

  assert.deepEqual(calls, [[
    'deleteMany',
    { where: { userId: 'user-1', usedAt: null } }
  ]]);
  assert.deepEqual(result, {
    url: 'https://app.example.com/reset-password?token=setup-token&setup=1',
    expiresAt
  });
});

test('account password setup links are configured to expire after one week', () => {
  assert.equal(ACCOUNT_PASSWORD_SETUP_HOURS, 168);
});

test('createPasswordResetToken supports the setup prefix and one-week expiration', async () => {
  let createArgs = null;
  const prismaClient = {
    passwordResetToken: {
      create: async args => {
        createArgs = args;
        return { id: 'token-row', ...args.data };
      }
    }
  };
  const startedAt = Date.now();

  const result = await createPasswordResetToken('user-setup', prismaClient, {
    expiresInHours: ACCOUNT_PASSWORD_SETUP_HOURS,
    tokenPrefix: 'setup_'
  });

  assert.match(result.token, /^setup_[a-f0-9]{64}$/);
  assert.equal(createArgs.data.tokenHash, hashToken(result.token));
  const durationMs = result.expiresAt.getTime() - startedAt;
  assert.ok(durationMs >= 7 * 24 * 60 * 60 * 1000 - 1_000);
  assert.ok(durationMs <= 7 * 24 * 60 * 60 * 1000 + 1_000);
});

test('createPendingPasswordHash does not create a known default password', async () => {
  const passwordHash = await createPendingPasswordHash();
  assert.equal(await verifyPassword('senha123', passwordHash), false);
});
