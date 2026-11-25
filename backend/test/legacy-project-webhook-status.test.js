import assert from 'node:assert/strict';
import test from 'node:test';

import { legacyProjectWebhookStatus } from '../src/lib/integrations/legacy-project-webhook-status.js';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-25T15:00:00Z');

function client(rows) {
  return { usageCounter: { async findMany() { return rows; } } };
}

test('legacy webhook status sums the last 30 days and reports the last day it was used', async () => {
  const status = await legacyProjectWebhookStatus(client([
    { periodStart: new Date(now.getTime() - 2 * DAY), count: 3 },
    { periodStart: new Date(now.getTime() - 10 * DAY), count: 4 },
    { periodStart: new Date(now.getTime() - 45 * DAY), count: 9 }
  ]), { projectWebhookLegacySunset: null }, now);
  assert.equal(status.status, 'IN_USE');
  assert.equal(status.last30Days, 7);
  assert.equal(status.lastUsedDay, new Date(now.getTime() - 2 * DAY).toISOString());
  assert.equal(status.sunset, null);
});

test('legacy webhook status is IDLE without recent calls and shows the configured sunset', async () => {
  const sunset = new Date('2027-03-01T00:00:00Z');
  const status = await legacyProjectWebhookStatus(client([{ periodStart: new Date(now.getTime() - 40 * DAY), count: 2 }]),
    { projectWebhookLegacySunset: sunset }, now);
  assert.equal(status.status, 'IDLE');
  assert.equal(status.last30Days, 0);
  assert.equal(status.sunset, sunset.toISOString());
});

test('legacy webhook status degrades to UNAVAILABLE when the counter cannot be read', async () => {
  const broken = { usageCounter: { async findMany() { throw Object.assign(new Error('down'), { code: 'P1001' }); } } };
  assert.equal((await legacyProjectWebhookStatus(broken, {}, now)).status, 'UNAVAILABLE');
  assert.equal((await legacyProjectWebhookStatus({}, {}, now)).status, 'UNAVAILABLE');
});
