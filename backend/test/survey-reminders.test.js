import assert from 'node:assert/strict';
import test from 'node:test';

import { expirationDueWhere, reminderDueWhere } from '../src/lib/survey-reminders.js';

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
