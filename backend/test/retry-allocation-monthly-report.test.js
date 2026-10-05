import assert from 'node:assert/strict';
import test from 'node:test';

import { retryAllocationMonthlyReports } from '../scripts/retry-allocation-monthly-report.js';

function options(overrides = {}) {
  return {
    now: new Date('2026-10-05T12:00:00Z'),
    client: {
      allocationReportRecipient: { findMany: async () => [{ email: 'sent@example.com' }, { email: 'pending@example.com' }] },
      allocationReportRecipientDelivery: { findMany: async () => [{ email: 'sent@example.com', status: 'SENT' }] }
    },
    log: () => {},
    processReport: async () => assert.fail('dry-run must not process or send'),
    ...overrides
  };
}

test('recovery defaults to read-only previews and removes repeated month arguments', async () => {
  const logs = [];
  await retryAllocationMonthlyReports(['2026-08', '2026-09', '2026-08'], options({ log: line => logs.push(JSON.parse(line)) }));
  assert.deepEqual(logs.map(row => row.yearMonth), ['2026-08', '2026-09']);
  for (const row of logs) {
    assert.equal(row.mode, 'dry-run');
    assert.equal(row.delivered, 1);
    assert.equal(row.pending, 1);
    assert.equal(row.status, 'SENT_WITH_ERRORS');
  }
});

test('recovery apply uses the normal monthly processor for each closed month', async () => {
  const months = [];
  const config = options({ processReport: async args => {
    assert.equal(args.client, config.client);
    assert.equal(args.now, config.now);
    months.push(args.yearMonth);
    return { sent: 1, pending: 0, skipped: false };
  } });
  await retryAllocationMonthlyReports(['2026-08', '2026-09', '--apply'], config);
  assert.deepEqual(months, ['2026-08', '2026-09']);
});

test('recovery validates all month arguments before any send', async () => {
  for (const args of [[], ['2026-13'], ['--unknown'], ['2026-08', '2026-10', '--apply']]) {
    await assert.rejects(() => retryAllocationMonthlyReports(args, options()));
  }
});

for (const result of [
  { sent: 0, pending: 1, skipped: false },
  { skipped: true, reason: 'already_processed' },
  { skipped: true, reason: 'missing_mailer_config' }
]) {
  test(`recovery stops before the next month when processing leaves an unresolved result: ${JSON.stringify(result)}`, async () => {
    const months = [];
    await assert.rejects(() => retryAllocationMonthlyReports(['2026-08', '2026-09', '--apply'], options({
      processReport: async ({ yearMonth }) => { months.push(yearMonth); return result; }
    })), /continua pendente/);
    assert.deepEqual(months, ['2026-08']);
  });
}
