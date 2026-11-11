import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { assertLocalPerformanceDatabase } from '../scripts/lib/http-performance-report.js';

test('PostgreSQL: job volume reports aggregates and its transaction rejects writes', {
  skip: !process.env.HTTP_PERFORMANCE_TEST_DATABASE_URL
}, async t => {
  assertLocalPerformanceDatabase(process.env.HTTP_PERFORMANCE_TEST_DATABASE_URL);
  process.env.DATABASE_URL = process.env.HTTP_PERFORMANCE_TEST_DATABASE_URL;
  const { default: db } = await import('../src/lib/prisma.js');
  const { reportJobRunVolume } = await import('../src/lib/operations/job-run-volume.js');
  const prefix = 'job-volume-' + randomUUID();
  t.after(async () => { await db.jobRun.deleteMany({ where: { id: { startsWith: prefix } } }); await db.$disconnect(); });
  const before = await reportJobRunVolume();
  const today = new Date(), yesterday = new Date(today.getTime() - 86400000), old = new Date(today.getTime() - 8 * 86400000);
  await db.jobRun.createMany({ data: [
    { id: prefix + '-completed', name: prefix, status: 'COMPLETED', createdAt: today },
    { id: prefix + '-failed', name: prefix, status: 'FAILED', createdAt: yesterday },
    { id: prefix + '-unknown', name: prefix, status: prefix, createdAt: today },
    { id: prefix + '-old', name: prefix, status: 'COMPLETED', createdAt: old }
  ] });
  const result = await reportJobRunVolume();
  assert.equal(result.readOnly, true); assert.equal(result.complete, true);
  const total = report => report.rowsByUtcDayAndStatus.reduce((sum, row) => sum + Number(row.rows), 0);
  assert.equal(total(result) - total(before), 3);
  assert.equal(JSON.stringify(result).includes(prefix), false, 'Unknown status values and names must not enter the report');
  const database = { $transaction: (callback, options) => db.$transaction(tx => callback({
    $executeRaw: (...args) => tx.$executeRaw(...args),
    $queryRaw: async (...args) => {
      await tx.jobRun.create({ data: { id: prefix + '-forbidden', name: prefix } });
      return tx.$queryRaw(...args);
    }
  }), options) };
  await assert.rejects(reportJobRunVolume({ database }), error =>
    /read.only|25006/i.test(String(error.message) + JSON.stringify(error.meta ?? {})));
  assert.equal(await db.jobRun.findUnique({ where: { id: prefix + '-forbidden' } }), null);
});
