import assert from 'node:assert/strict';
import test from 'node:test';

import {
  missingClientAccessResetConfig,
  resetUrlForToken,
  sendClientAccessResetEmail
} from '../src/lib/client-access-reset.js';

test('resetUrlForToken builds a reset URL without trailing slash duplication', () => {
  assert.equal(
    resetUrlForToken('https://app.example.com/', 'abc 123'),
    'https://app.example.com/reset-password?token=abc%20123'
  );
});

test('missingClientAccessResetConfig reports SMTP and APP_URL requirements', () => {
  assert.deepEqual(
    missingClientAccessResetConfig({ appUrl: '' }, ['smtpHost', 'smtpPass']),
    ['SMTP smtpHost', 'SMTP smtpPass', 'APP_URL']
  );
});

test('sendClientAccessResetEmail removes issued reset token when mail delivery fails', async () => {
  const deletes = [];
  const expiresAt = new Date('2026-05-08T12:00:00.000Z');
  const prismaClient = {
    passwordResetToken: {
      deleteMany: async args => {
        deletes.push(args);
        return { count: 1 };
      }
    }
  };
  const error = new Error('SMTP down');

  await assert.rejects(
    sendClientAccessResetEmail({
      user: {
        id: 'user-1',
        username: '00112233445566',
        name: 'Cliente',
        email: 'cliente@example.com'
      },
      prismaClient,
      envConfig: { appUrl: 'https://app.example.com' },
      createToken: async userId => {
        assert.equal(userId, 'user-1');
        return { token: 'reset-token', expiresAt };
      },
      templateBuilder: ({ resetUrl }) => ({
        subject: 'reset',
        text: resetUrl
      }),
      mailer: async message => {
        assert.equal(message.to, 'cliente@example.com');
        assert.equal(message.text, 'https://app.example.com/reset-password?token=reset-token');
        throw error;
      }
    }),
    error
  );

  assert.deepEqual(deletes, [
    {
      where: {
        userId: 'user-1',
        usedAt: null
      }
    },
    {
      where: {
        userId: 'user-1',
        expiresAt,
        usedAt: null
      }
    }
  ]);
});

test('sendClientAccessResetEmail does not update the user password hash', async () => {
  const prismaClient = {
    passwordResetToken: {
      deleteMany: async () => ({ count: 1 })
    },
    user: {
      update: async () => {
        throw new Error('password update must not be called');
      }
    }
  };

  await sendClientAccessResetEmail({
    user: {
      id: 'user-1',
      username: '00112233445566',
      name: 'Cliente',
      email: 'cliente@example.com'
    },
    prismaClient,
    envConfig: { appUrl: 'https://app.example.com' },
    createToken: async () => ({ token: 'reset-token', expiresAt: new Date() }),
    templateBuilder: () => ({ subject: 'reset', text: 'body' }),
    mailer: async () => ({ messageId: 'sent' })
  });
});
