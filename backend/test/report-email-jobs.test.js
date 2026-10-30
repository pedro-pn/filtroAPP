import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { enqueueReportEmail, processReportEmailQueue, reportEmailRetryAt } from '../src/lib/reports/email-jobs.js';

async function database(t) {
  const db = new PGlite({ parsers: { 1114: value => new Date(value + 'Z') } });
  t.after(() => db.close());
  await db.exec("SET TIME ZONE 'UTC'");
  await db.exec(`CREATE TABLE "Report" (id text PRIMARY KEY, "reportType" text, status text,
    "updatedAt" timestamp(3), "clientReleasedAt" timestamp(3), "specialConditions" jsonb);
    CREATE TABLE "ReportSignature" (id text PRIMARY KEY, "reportId" text, status text, "signedAt" timestamp(3));`);
  await db.exec(await readFile(new URL('../prisma/migrations/20261030180000_report_email_outbox/migration.sql', import.meta.url), 'utf8'));
  const client = {
    $queryRawUnsafe: async (sql, ...values) => (await db.query(sql, values)).rows,
    reportEmailJob: {
      upsert: async ({ create }) => {
        await db.query('INSERT INTO "ReportEmailJob" (id,kind,payload) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [create.id, create.kind, JSON.stringify(create.payload)]);
      },
      updateMany: async ({ where, data }) => {
        const values = [];
        const set = Object.entries(data).map(([name, value]) => {
          values.push(value?.push ? [value.push] : value);
          return `"${name}" = ${value?.push ? '"deliveredKeys" || ' : ''}$${values.length}`;
        });
        const filter = Object.entries(where).map(([name, value]) => { values.push(value); return `"${name}" = $${values.length}`; });
        const rows = await db.query(`UPDATE "ReportEmailJob" SET ${set.join(',')} WHERE ${filter.join(' AND ')} RETURNING id`, values);
        return { count: rows.rows.length };
      }
    }
  };
  return { db, client, row: async id => (await db.query('SELECT * FROM "ReportEmailJob" WHERE id=$1', [id])).rows[0] };
}

test('signature, physical signature and manual release delivery intents commit atomically and survive restart', async t => {
  const { db } = await database(t);
  await db.exec(`INSERT INTO "Report" VALUES ('rdo','RDO','APPROVED',now(),null,'{}');
    INSERT INTO "ReportSignature" VALUES ('sig','rdo','PENDING',null);`);
  await db.exec(`BEGIN;
    UPDATE "ReportSignature" SET status='SIGNED',"signedAt"=now() WHERE id='sig';
    ROLLBACK;`);
  assert.equal((await db.query('SELECT * FROM "ReportEmailJob"')).rows.length, 0);
  await db.exec(`UPDATE "ReportSignature" SET status='SIGNED',"signedAt"=now() WHERE id='sig';
    UPDATE "ReportSignature" SET status='SIGNED' WHERE id='sig';
    UPDATE "Report" SET status='SIGNED' WHERE id='rdo';
    INSERT INTO "Report" VALUES ('service','RCPU','APPROVED','2026-10-30 18:00', '2026-10-30 18:00','{"parentRdoId":"rdo"}');`);
  assert.deepEqual((await db.query('SELECT kind FROM "ReportEmailJob" ORDER BY kind')).rows.map(row => row.kind),
    ['MANUAL_RELEASE', 'RELEASE_SCAN', 'SIGNATURE_NOTICE', 'SIGNED_COPY']);
});

test('SMTP/PDF failure stays pending; a restarted worker resumes only recipients still missing', async t => {
  const { client, row } = await database(t);
  await enqueueReportEmail(client, 'release', 'SERVICE_RELEASE', {});
  let clock = new Date(Date.now() + 5000);
  const delivered = [];
  let failing = true;
  const processJob = async (job, send) => {
    for (const email of ['first@example.com', 'second@example.com']) await send(email, { to: email });
  };
  const mailer = async message => {
    if (message.to === 'second@example.com' && failing) throw new Error('432 4.3.2 concurrent connections');
    delivered.push(message.to);
    return { accepted: [message.to] };
  };
  const options = { client, processJob, mailer, enabled: () => true, now: () => clock };
  await processReportEmailQueue(options);
  assert.equal((await row('release')).status, 'PENDING');
  assert.deepEqual((await row('release')).deliveredKeys, ['first@example.com']);
  assert.match((await row('release')).lastError, /432/);
  assert.equal(await processReportEmailQueue(options), 0);
  clock = (await row('release')).nextAttemptAt;
  failing = false;
  await processReportEmailQueue(options);
  assert.deepEqual(delivered, ['first@example.com', 'second@example.com']);
  assert.equal((await row('release')).status, 'COMPLETED');
  await enqueueReportEmail(client, 'release', 'SERVICE_RELEASE', {});
  assert.equal(await processReportEmailQueue(options), 0);
});

test('stale claims recover, live claims are exclusive and disabled delivery never becomes completed', async t => {
  const { db, client, row } = await database(t);
  await enqueueReportEmail(client, 'stale', 'SIGNED_COPY', {});
  await db.exec(`UPDATE "ReportEmailJob" SET status='RUNNING',"lockToken"='dead',"lockedUntil"=now()-interval '1 hour'`);
  const options = { client, enabled: () => true, now: () => new Date(Date.now() + 5000), processJob: async (_, send) => send('x', { to: 'x' }), mailer: async () => ({ skipped: true }) };
  assert.equal(await processReportEmailQueue({ ...options, enabled: () => false }), 0);
  await processReportEmailQueue(options);
  assert.equal((await row('stale')).status, 'PENDING');
  assert.deepEqual((await row('stale')).deliveredKeys, []);
  await db.exec(`UPDATE "ReportEmailJob" SET status='RUNNING',"lockedUntil"=now()+interval '1 hour'`);
  assert.equal(await processReportEmailQueue(options), 0);
  const now = new Date();
  assert.equal(reportEmailRetryAt(99999, now).getTime() - now.getTime(), 3_600_000);
});
