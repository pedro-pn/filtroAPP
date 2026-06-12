import assert from 'node:assert/strict';
import test from 'node:test';

import { expirationDueWhere, processSurveyExpirations, reminderDueWhere } from '../src/lib/survey-reminders.js';

test('reminderDueWhere waits the reminder gap after the initial survey send', () => {
  const now = new Date('2026-05-11T12:00:00.000Z');
  const where = reminderDueWhere(now);

  assert.deepEqual(where.OR, [
    {
      lastReminderAt: null,
      sentAt: { lt: new Date('2026-05-08T12:00:00.000Z') }
    },
    {
      lastReminderAt: { lt: new Date('2026-05-08T12:00:00.000Z') }
    }
  ]);
});

test('expirationDueWhere selects unanswered expired surveys that were not notified', () => {
  const now = new Date('2026-05-13T12:00:00.000Z');

  assert.deepEqual(expirationDueWhere(now), {
    respondedAt: null,
    expiresAt: { lte: now },
    expirationNotifiedAt: null
  });
});

test('processSurveyExpirations marks the survey once even when expiration email fails', async () => {
  const now = new Date('2026-05-13T12:00:00.000Z');
  const survey = {
    id: 'survey-expired',
    respondedAt: null,
    expiresAt: new Date('2026-05-12T12:00:00.000Z'),
    expirationNotifiedAt: null,
    project: {
      managerOnly: false,
      clientName: 'Cliente',
      code: 'P-001',
      name: 'Projeto'
    }
  };
  const resetUpdates = [];
  const client = {
    satisfactionSurvey: {
      async findMany(args) {
        const due = survey.respondedAt === null &&
          survey.expiresAt.getTime() <= args.where.expiresAt.lte.getTime() &&
          survey.expirationNotifiedAt === null;
        return due ? [survey] : [];
      },
      async updateMany(args) {
        if (args.where.id !== survey.id || survey.expirationNotifiedAt !== null) {
          return { count: 0 };
        }
        survey.expirationNotifiedAt = args.data.expirationNotifiedAt;
        return { count: 1 };
      },
      async update(args) {
        resetUpdates.push(args);
        survey.expirationNotifiedAt = args.data.expirationNotifiedAt;
        return survey;
      }
    },
    user: {
      async findMany() {
        return [
          { email: 'gestor@example.com' },
          { email: 'coord@example.com' }
        ];
      }
    }
  };
  const recipientsByAttempt = [];
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    const first = await processSurveyExpirations({
      client,
      now,
      async notifyExpired({ recipients }) {
        recipientsByAttempt.push(recipients);
        throw new Error('smtp falhou depois de enviar');
      }
    });
    const second = await processSurveyExpirations({
      client,
      now,
      async notifyExpired({ recipients }) {
        recipientsByAttempt.push(recipients);
      }
    });

    assert.deepEqual(first, { checked: 1, notified: 0 });
    assert.deepEqual(second, { checked: 0, notified: 0 });
    assert.equal(recipientsByAttempt.length, 1);
    assert.deepEqual(recipientsByAttempt[0], ['gestor@example.com', 'coord@example.com']);
    assert.equal(resetUpdates.length, 0);
    assert.ok(survey.expirationNotifiedAt instanceof Date);
  } finally {
    console.error = originalConsoleError;
  }
});
