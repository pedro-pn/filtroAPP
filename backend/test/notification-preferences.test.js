import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NotificationEmailCategory,
  consumeNotificationPreferenceToken,
  coordinatorNotificationEmails,
  notificationPreferenceTokenStatus,
  notificationPreferences,
  notificationRecipientsForEmails
} from '../src/lib/notification-preferences.js';

test('notification preferences default to enabled', () => {
  assert.deepEqual(notificationPreferences({}), {
    reports: true,
    signatures: true,
    signatureReminders: true,
    surveyReminders: true
  });
});

test('notification recipients skip users opted out for the category', async () => {
  const calls = [];
  const client = {
    user: {
      async findMany() {
        return [{
          id: 'user-1',
          email: 'cliente@example.com',
          username: 'cliente@example.com',
          notifyReportsByEmail: false,
          notifySignaturesByEmail: true,
          notifySignatureRemindersByEmail: true,
          notifySurveyRemindersByEmail: true
        }];
      }
    },
    notificationPreferenceToken: {
      async findFirst() {
        calls.push('findFirst');
        return { tokenHash: 'token-1' };
      }
    }
  };

  const recipients = await notificationRecipientsForEmails(
    ['cliente@example.com', 'avulso@example.com'],
    NotificationEmailCategory.REPORTS,
    { client }
  );

  assert.deepEqual(recipients, [{
    email: 'avulso@example.com',
    userId: null,
    notificationPreferencesUrl: ''
  }]);
  assert.deepEqual(calls, []);
});

test('notification preference token is consumed once when saving public settings', async () => {
  const now = new Date('2026-06-01T12:00:00.000Z');
  const updates = [];
  const client = {
    notificationPreferenceToken: {
      async findUnique() {
        return {
          id: 'token-row',
          tokenHash: 'token-1',
          userId: 'user-1',
          expiresAt: new Date('2026-06-15T12:00:00.000Z'),
          usedAt: null,
          user: { id: 'user-1', isActive: true }
        };
      }
    },
    async $transaction(fn) {
      return fn({
        notificationPreferenceToken: {
          async updateMany(args) {
            updates.push(args);
            return { count: 1 };
          }
        },
        user: {
          async update(args) {
            return { id: args.where.id, ...args.data };
          }
        }
      });
    }
  };

  const user = await consumeNotificationPreferenceToken('token-1', {
    reports: false,
    signatures: true,
    signatureReminders: false,
    surveyReminders: false
  }, client, now);

  assert.equal(updates[0].data.usedAt, now);
  assert.deepEqual(user, {
    id: 'user-1',
    notifyReportsByEmail: false,
    notifySignaturesByEmail: true,
    notifySignatureRemindersByEmail: false,
    notifySurveyRemindersByEmail: false
  });
});

test('notification preference token status rejects expired or used tokens', () => {
  const now = new Date('2026-06-01T12:00:00.000Z');
  assert.equal(notificationPreferenceTokenStatus({
    expiresAt: new Date('2026-05-31T12:00:00.000Z'),
    usedAt: null,
    user: { isActive: true }
  }, now).valid, false);
  assert.equal(notificationPreferenceTokenStatus({
    expiresAt: new Date('2026-06-02T12:00:00.000Z'),
    usedAt: now,
    user: { isActive: true }
  }, now).valid, false);
});

test('coordinator notification emails include legacy and module coordinator accounts', async () => {
  const client = {
    user: {
      async findMany(args) {
        assert.deepEqual(args.where.OR, [
          { role: 'COORDINATOR' },
          { moduleRoles: { some: { role: 'RDO_COORDINATOR' } } }
        ]);
        return [
          { email: 'coord@example.com', username: 'coord' },
          { email: null, username: 'modulo@example.com' },
          { email: '', username: 'sem-email' },
          { email: 'coord@example.com', username: 'duplicado@example.com' }
        ];
      }
    }
  };

  assert.deepEqual(await coordinatorNotificationEmails({ client }), [
    'coord@example.com',
    'modulo@example.com'
  ]);
});
