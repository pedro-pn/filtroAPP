import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('monthly delivery migration preserves historical sends and allows unsent months without sentAt', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(await readFile(new URL('../prisma/migrations/20260602120000_add_allocation_monthly_report/migration.sql', import.meta.url), 'utf8'));
  await db.exec(`INSERT INTO "AllocationReportDelivery" ("id", "yearMonth", "status", "sentAt", "updatedAt")
    VALUES ('old-send', '2026-06', 'SENT', '2026-07-01 12:00:00', CURRENT_TIMESTAMP)`);
  await db.exec(await readFile(new URL('../prisma/migrations/20261005120000_allocation_report_delivery_sent_at_nullable/migration.sql', import.meta.url), 'utf8'));
  await db.exec(`INSERT INTO "AllocationReportDelivery" ("id", "yearMonth", "status", "updatedAt")
    VALUES ('new-claim', '2026-09', 'CLAIMED', CURRENT_TIMESTAMP)`);
  await db.exec(`UPDATE "AllocationReportDelivery" SET "status" = 'ERROR', "sentAt" = NULL WHERE "id" = 'new-claim'`);
  const { rows } = await db.query('SELECT "yearMonth", "status", "sentAt"::text AS "sentAt" FROM "AllocationReportDelivery" ORDER BY "yearMonth"');
  assert.equal(rows[0].status, 'SENT');
  assert.equal(rows[0].sentAt, '2026-07-01 12:00:00');
  assert.equal(rows[1].status, 'ERROR');
  assert.equal(rows[1].sentAt, null);
});
