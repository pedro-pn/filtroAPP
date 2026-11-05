import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { enqueueReportEmail, processReportEmailQueue } from '../src/lib/reports/email-jobs.js';

test('PostgreSQL and Prisma recover durable delivery receipts with exclusive worker claims', {
  skip: process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL
}, async () => {
  const schema = `email_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  let client;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"; SET search_path = "${schema}"`);
    await admin.query(`CREATE TABLE "Report" (id text PRIMARY KEY, "reportType" text, status text,
      "updatedAt" timestamp(3), "clientReleasedAt" timestamp(3), "specialConditions" jsonb, "projectId" text DEFAULT 'project');
      CREATE TABLE "ReportSignature" (id text PRIMARY KEY, "reportId" text, status text, "signedAt" timestamp(3), "signerEmail" text DEFAULT 'signer@example.com');`);
    await admin.query(await readFile(new URL('../prisma/migrations/20261030180000_report_email_outbox/migration.sql', import.meta.url), 'utf8'));
    await admin.query(await readFile(new URL('../prisma/migrations/20261105120000_report_signature_email_digest/migration.sql', import.meta.url), 'utf8'));
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` });
    client = new PrismaClient({ adapter: new PrismaPg(pool, { schema, disposeExternalPool: true }) });
    await enqueueReportEmail(client, 'delivery', 'SERVICE_RELEASE', {});
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const options = { client, maxJobs: 1, enabled: () => true };
    const first = processReportEmailQueue({ ...options, processJob: async () => { started(); await gate; } });
    await Promise.race([ready, new Promise((_, reject) => setTimeout(() => reject(new Error('worker did not claim a due job')), 5000).unref())]);
    assert.equal(await processReportEmailQueue({ ...options, processJob: async () => assert.fail('already claimed') }), 0);
    release();
    await first;
    assert.equal((await client.reportEmailJob.findUnique({ where: { id: 'delivery' } })).status, 'COMPLETED');
    // A crashed worker leaves a recoverable lease; a saved recipient receipt survives.
    await client.reportEmailJob.update({ where: { id: 'delivery' }, data: {
      status: 'RUNNING', lockedUntil: new Date(0), lockToken: 'dead-process', deliveredKeys: ['first@example.com']
    } });
    const sent = [];
    await processReportEmailQueue({ ...options, mailer: async message => { sent.push(message.to); return { accepted: [message.to] }; },
      processJob: async (_, send) => {
        await send('first@example.com', { to: 'first@example.com' });
        await send('second@example.com', { to: 'second@example.com' });
      } });
    assert.deepEqual(sent, ['second@example.com']);
    assert.equal((await client.reportEmailJob.findUnique({ where: { id: 'delivery' } })).attempts, 2);

    // Concurrent signature transactions share one quiet-period group.
    await admin.query(`INSERT INTO "Report" (id,"reportType",status) VALUES ('r1','RDO','APPROVED'), ('r2','RDO','APPROVED')`);
    await Promise.all(['r1', 'r2'].map(id => client.$executeRawUnsafe(
      `INSERT INTO "ReportSignature" (id,"reportId",status,"signedAt") VALUES ($1,$2,'SIGNED',now())`, `sig-${id}`, id)));
    const grouped = await client.reportEmailJob.findMany({ where: { kind: { in: ['SIGNATURE_NOTICE', 'SIGNED_COPY'] } } });
    assert.equal(grouped.length, 2);
    assert.ok(grouped.every(job => job.payload.signatures.length === 2));
    assert.ok(grouped.every(job => job.nextAttemptAt.getTime() > Date.now() + 590_000));

    // A signature arriving during delivery starts a fresh immutable group for
    // the claimed kind, and extends the other group's quiet period atomically.
    let finishDigest;
    const digestGate = new Promise(resolve => { finishDigest = resolve; });
    let digestStarted;
    const digestReady = new Promise(resolve => { digestStarted = resolve; });
    const digestWorker = processReportEmailQueue({ ...options,
      now: () => new Date(Math.max(...grouped.map(job => job.nextAttemptAt.getTime())) + 1000),
      processJob: async () => { digestStarted(); await digestGate; } });
    try {
      await Promise.race([digestReady, new Promise((_, reject) => setTimeout(() => reject(new Error('digest was not claimed')), 5000).unref())]);
      const running = await client.reportEmailJob.findFirst({ where: { status: 'RUNNING' } });
      await client.$executeRawUnsafe(`INSERT INTO "ReportSignature" (id,"reportId",status,"signedAt") VALUES ('sig-third','r1','SIGNED',now())`);
      const after = await client.reportEmailJob.findMany({ where: { kind: { in: ['SIGNATURE_NOTICE', 'SIGNED_COPY'] } } });
      assert.equal(after.length, 3);
      assert.equal(after.find(job => job.id === running.id).payload.signatures.length, 2);
      assert.equal(after.find(job => job.id !== running.id && job.kind === running.kind).payload.signatures.length, 1);
      assert.equal(after.find(job => job.kind !== running.kind).payload.signatures.length, 3);
    } finally {
      finishDigest();
      await digestWorker;
    }
  } finally {
    await client?.$disconnect();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
