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
      "updatedAt" timestamp(3), "clientReleasedAt" timestamp(3), "specialConditions" jsonb);
      CREATE TABLE "ReportSignature" (id text PRIMARY KEY, "reportId" text, status text, "signedAt" timestamp(3));`);
    await admin.query(await readFile(new URL('../prisma/migrations/20261030180000_report_email_outbox/migration.sql', import.meta.url), 'utf8'));
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
  } finally {
    await client?.$disconnect();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
