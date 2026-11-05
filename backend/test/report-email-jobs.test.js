import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { enqueueReportEmail, processReportEmailQueue, reportEmailRetryAt } from '../src/lib/reports/email-jobs.js';

async function database(t, { grouped = true } = {}) {
  const db = new PGlite({ parsers: { 1114: value => new Date(value + 'Z') } });
  t.after(() => db.close());
  await db.exec("SET TIME ZONE 'UTC'");
  await db.exec(`CREATE TABLE "Report" (id text PRIMARY KEY, "reportType" text, status text,
    "updatedAt" timestamp(3), "clientReleasedAt" timestamp(3), "specialConditions" jsonb, "projectId" text DEFAULT 'project');
    CREATE TABLE "ReportSignature" (id text PRIMARY KEY, "reportId" text, status text, "signedAt" timestamp(3), "signerEmail" text DEFAULT 'signer@example.com');`);
  await db.exec(await readFile(new URL('../prisma/migrations/20261030180000_report_email_outbox/migration.sql', import.meta.url), 'utf8'));
  const migrate = async () => db.exec(await readFile(new URL('../prisma/migrations/20261105120000_report_signature_email_digest/migration.sql', import.meta.url), 'utf8'));
  if (grouped) await migrate();
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
  return { db, client, migrate, row: async id => (await db.query('SELECT * FROM "ReportEmailJob" WHERE id=$1', [id])).rows[0] };
}

test('signature, physical signature and manual release delivery intents commit atomically and survive restart', async t => {
  const { db } = await database(t);
  await db.exec(`INSERT INTO "Report" (id,"reportType",status,"updatedAt","clientReleasedAt","specialConditions") VALUES ('rdo','RDO','APPROVED',now(),null,'{}');
    INSERT INTO "ReportSignature" (id,"reportId",status,"signedAt") VALUES ('sig','rdo','PENDING',null);`);
  await db.exec(`BEGIN;
    UPDATE "ReportSignature" SET status='SIGNED',"signedAt"=now() WHERE id='sig';
    ROLLBACK;`);
  assert.equal((await db.query('SELECT * FROM "ReportEmailJob"')).rows.length, 0);
  await db.exec(`UPDATE "ReportSignature" SET status='SIGNED',"signedAt"=now() WHERE id='sig';
    UPDATE "ReportSignature" SET status='SIGNED' WHERE id='sig';
    UPDATE "Report" SET status='SIGNED' WHERE id='rdo';
    INSERT INTO "Report" (id,"reportType",status,"updatedAt","clientReleasedAt","specialConditions") VALUES ('service','RCPU','APPROVED','2026-10-30 18:00', '2026-10-30 18:00','{"parentRdoId":"rdo"}');`);
  assert.deepEqual((await db.query('SELECT kind FROM "ReportEmailJob" ORDER BY kind')).rows.map(row => row.kind),
    ['MANUAL_RELEASE', 'RELEASE_SCAN', 'SIGNATURE_NOTICE', 'SIGNED_COPY']);
});

test('batch and consecutive signatures wait ten quiet minutes and deliver one job per project and kind', async t => {
  const { db, client } = await database(t);
  await db.exec(`INSERT INTO "Report" (id,"reportType",status) VALUES ('r1','RDO','APPROVED'), ('r2','RDO','APPROVED');
    INSERT INTO "ReportSignature" (id,"reportId",status,"signedAt") VALUES ('s1','r1','SIGNED','2026-01-01');`);
  const original = (await db.query('SELECT * FROM "ReportEmailJob"')).rows;
  assert.equal(original.length, 2);
  assert.ok(original.every(job => job.nextAttemptAt.getTime() >= Date.now() + 590_000));
  await db.exec(`UPDATE "ReportEmailJob" SET "nextAttemptAt" = now() + interval '2 minutes';
    INSERT INTO "ReportSignature" (id,"reportId",status,"signedAt") VALUES ('s2','r2','SIGNED',now());
    UPDATE "ReportSignature" SET status='SIGNED' WHERE id='s2';`);
  const grouped = (await db.query('SELECT * FROM "ReportEmailJob"')).rows;
  assert.equal(grouped.length, 2);
  assert.ok(grouped.every(job => job.payload.signatures.length === 2));
  assert.ok(grouped.every(job => job.nextAttemptAt.getTime() >= Date.now() + 590_000));
  const sent = [];
  let clock = new Date(Date.now() + 5 * 60_000);
  const options = { client, enabled: () => true, now: () => clock,
    processJob: async (job, send) => send(job.kind, { to: 'signer@example.com', count: job.payload.signatures.length }),
    mailer: async message => { sent.push(message); return { accepted: [message.to] }; } };
  assert.equal(await processReportEmailQueue(options), 0);
  clock = new Date(Math.max(...grouped.map(job => job.nextAttemptAt.getTime())));
  assert.equal(await processReportEmailQueue(options), 2);
  assert.deepEqual(sent.map(message => message.count), [2, 2]);
});

test('projects and copy recipients have separate groups; only RDOs generate signer copies', async t => {
  const { db } = await database(t);
  await db.exec(`INSERT INTO "Report" (id,"reportType",status,"projectId") VALUES
    ('r1','RDO','APPROVED','p1'), ('r2','RDO','APPROVED','p2'), ('service','RCPU','APPROVED','p1');
    INSERT INTO "ReportSignature" (id,"reportId",status,"signedAt","signerEmail") VALUES
      ('s1','r1','SIGNED',now(),' One@Example.com '), ('s2','r1','SIGNED',now(),'two@example.com'),
      ('s3','r2','SIGNED',now(),'one@example.com'), ('s4','service','SIGNED',now(),'one@example.com');`);
  const jobs = (await db.query('SELECT * FROM "ReportEmailJob"')).rows;
  assert.equal(jobs.length, 5);
  assert.deepEqual(jobs.filter(job => job.kind === 'SIGNATURE_NOTICE').map(job => job.payload.signatures.length).sort(), [1, 3]);
  const copies = jobs.filter(job => job.kind === 'SIGNED_COPY');
  assert.equal(copies.length, 3);
  assert.ok(copies.every(job => job.payload.signatures.length === 1));
  assert.equal(copies.filter(job => job.payload.recipientEmail === 'one@example.com').length, 2);
});

test('new signatures never mutate running or partially delivered groups', async t => {
  const { db, client } = await database(t);
  await db.exec(`INSERT INTO "Report" (id,"reportType",status) VALUES ('r','RDO','APPROVED');
    INSERT INTO "ReportSignature" (id,"reportId",status,"signedAt") VALUES ('s1','r','SIGNED',now());
    UPDATE "ReportEmailJob" SET status='RUNNING', attempts=1, "lockToken"='live', "lockedUntil"=now()+interval '1 hour'
      WHERE kind='SIGNED_COPY';
    UPDATE "ReportEmailJob" SET attempts=1, "deliveredKeys"=ARRAY['first@example.com'], "nextAttemptAt"=now()
      WHERE kind='SIGNATURE_NOTICE';
    INSERT INTO "ReportSignature" (id,"reportId",status,"signedAt") VALUES ('s2','r','SIGNED',now());`);
  const jobs = (await db.query('SELECT * FROM "ReportEmailJob"')).rows;
  assert.equal(jobs.length, 4);
  assert.ok(jobs.every(job => job.payload.signatures.length === 1));
  const sent = [];
  await processReportEmailQueue({ client, enabled: () => true, now: () => new Date(Date.now() + 1000),
    processJob: async (job, send) => {
      assert.equal(job.payload.signatures[0].signatureId, 's1');
      for (const to of ['first@example.com', 'second@example.com']) await send(to, { to });
    }, mailer: async message => { sent.push(message.to); return { accepted: [message.to] }; } });
  assert.deepEqual(sent, ['second@example.com']);
});

test('migration consolidates never attempted legacy jobs and preserves delivery receipts', async t => {
  const { db, migrate } = await database(t, { grouped: false });
  await db.exec(`INSERT INTO "Report" (id,"reportType",status) VALUES ('r','RDO','APPROVED');
    INSERT INTO "ReportSignature" (id,"reportId",status,"signedAt") VALUES ('s1','r','SIGNED',now()), ('s2','r','SIGNED',now());
    UPDATE "ReportEmailJob" SET attempts=1, "deliveredKeys"=ARRAY['done@example.com']
      WHERE kind='SIGNATURE_NOTICE' AND payload->>'signatureId'='s1';`);
  await migrate();
  const jobs = (await db.query('SELECT * FROM "ReportEmailJob"')).rows;
  assert.equal(jobs.length, 3);
  assert.equal(jobs.find(job => job.kind === 'SIGNED_COPY').payload.signatures.length, 2);
  const attempted = jobs.find(job => job.attempts === 1);
  assert.equal(attempted.payload.signatureId, 's1');
  assert.deepEqual(attempted.deliveredKeys, ['done@example.com']);
  assert.equal(jobs.find(job => job.kind === 'SIGNATURE_NOTICE' && job.attempts === 0).payload.signatures.length, 1);
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
