import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';

const databaseUrl = process.env.JOB_PERFORMANCE_TEST_DATABASE_URL;
test('PostgreSQL: sondagens e retenção preservam trabalho, falhas, execuções em curso e último sucesso', { skip: !databaseUrl }, async t => {
  const url = new URL(databaseUrl);
  assert.match(url.pathname, /_test$/);
  process.env.DATABASE_URL = url.toString();
  const { default: db } = await import('../src/lib/prisma.js');
  const { runTrackedJob } = await import('../src/lib/jobs/runner.js');
  const { previewDataRetention, runDataRetention } = await import('../src/lib/data-retention.js');
  const { hasPendingFinalizations } = await import('../src/lib/assinaturas/jobs.js');
  const { hasSignatureFilePurgeWork } = await import('../src/lib/assinaturas/file-quarantine.js');
  const prefix = 'job-performance-' + randomUUID();
  const now = new Date('2026-11-09T12:00:00Z');
  const old = new Date('2026-01-01T12:00:00Z');
  const retentionIds = [], documents = [];
  t.after(async () => {
    await db.jobRun.deleteMany({ where: { name: { startsWith: prefix } } });
    await db.signatureDocument.deleteMany({ where: { id: { in: documents } } });
    await db.signatureDocumentFilePurge.deleteMany({ where: { targetUserId: prefix } });
    await db.dataRetentionRun.deleteMany({ where: { id: { in: retentionIds } } });
    await db.$disconnect();
  });
  const noData = { count: async () => 0, findMany: async () => [], deleteMany: async () => ({ count: 0 }), updateMany: async () => ({ count: 0 }) };
  const jobModel = Object.fromEntries(['count', 'findMany', 'deleteMany', 'groupBy'].map(method => [method, args => db.jobRun[method]({
    ...args, where: { AND: [{ name: { startsWith: prefix } }, args.where] }
  })]));
  const retentionClient = {
    userSession: noData, passwordResetToken: noData, reportAuditLog: noData,
    epiSignatureRequestAuditLog: noData, satisfactionSurvey: noData, reportDraft: noData,
    jobRun: jobModel,
    dataRetentionRun: { create: async args => { const row = await db.dataRetentionRun.create(args); retentionIds.push(row.id); return row; }, update: args => db.dataRetentionRun.update(args) },
    $transaction: callback => db.$transaction(tx => callback({ ...retentionClient, jobRun: {
      deleteMany: args => tx.jobRun.deleteMany({ ...args, where: { AND: [{ name: { startsWith: prefix } }, args.where] } })
    } }))
  };
  let worked = 0;
  for (let index = 0; index < 5; index++) await runTrackedJob(prefix + ':probe', async () => { worked++; }, {
    prismaClient: db, hasWork: async () => false, nowFn: () => now
  });
  assert.equal(worked, 0);
  const probes = await db.jobRun.findMany({ where: { name: prefix + ':probe' } });
  assert.equal(probes.length, 1);
  assert.equal(probes[0].result.checks, 5);

  const rows = [
    { id: prefix + '-old', name: prefix + ':work', status: 'COMPLETED', finishedAt: old },
    { id: prefix + '-new', name: prefix + ':work', status: 'COMPLETED', finishedAt: now },
    { id: prefix + '-fail', name: prefix + ':work', status: 'FAILED', finishedAt: old },
    { id: prefix + '-running', name: prefix + ':work', status: 'RUNNING', finishedAt: null },
    { id: prefix + '-skip', name: prefix + ':work', status: 'SKIPPED', finishedAt: old },
    { id: prefix + '-last', name: prefix + ':inactive', status: 'COMPLETED', finishedAt: old },
    { id: prefix + '-tie', name: prefix + ':inactive', status: 'COMPLETED', finishedAt: old }
  ];
  await db.jobRun.createMany({ data: rows.map(row => ({ ...row, startedAt: old })) });
  const preview = await previewDataRetention({ prismaClient: retentionClient, now, jobRunRetentionDays: 30 });
  assert.equal(preview.jobRunsToDelete, 2);
  assert.equal(await db.jobRun.count({ where: { id: { in: rows.map(row => row.id) } } }), rows.length);
  await assert.rejects(runDataRetention({ prismaClient: retentionClient, jobRunRetentionDays: -1 }), /explicit integer/);
  const defaults = await runDataRetention({ prismaClient: retentionClient, now, logger: { info() {}, error() {} } });
  assert.equal(defaults.jobRunsDeleted, undefined);
  const applied = await runDataRetention({ prismaClient: retentionClient, now, jobRunRetentionDays: 30, batchSize: 1, maxBatchesPerTarget: 3, logger: { info() {}, error() {} } });
  assert.equal(applied.jobRunsDeleted, 2);
  assert.equal(applied.batches.jobRuns, 2);
  assert.deepEqual((await db.jobRun.findMany({ where: { id: { in: rows.map(row => row.id) } }, select: { id: true } })).map(row => row.id).sort(), rows.filter(row => !['COMPLETED', 'SKIPPED'].includes(row.status) || row.id.endsWith('-new') || row.name.endsWith(':inactive')).map(row => row.id).sort());

  // Real PostgreSQL predicates cover retries and recovery before declaring a scan empty.
  const document = await db.signatureDocument.create({ data: {
    requesterNameSnapshot: 'Pessoa sintética', title: prefix, originalFileName: 'test.pdf',
    fileSizeBytes: 1, pageCount: 1, pageDimensions: [], sourceDocumentHash: prefix,
    status: 'FINALIZANDO', finalizationNextAttemptAt: new Date(now.getTime() + 60_000)
  } });
  documents.push(document.id);
  const scopedDocuments = { signatureDocument: { findFirst: args => db.signatureDocument.findFirst({ ...args, where: { AND: [{ id: document.id }, args.where] } }) } };
  assert.equal(await hasPendingFinalizations(scopedDocuments, now), false);
  assert.equal(await hasPendingFinalizations(scopedDocuments, new Date(now.getTime() + 60_000)), true);
  await db.signatureDocument.update({ where: { id: document.id }, data: { status: 'AGUARDANDO_ASSINATURAS', finalizationNextAttemptAt: null } });
  assert.equal(await hasPendingFinalizations(scopedDocuments, now), false);
  await db.signatureDocumentSigner.create({ data: { documentId: document.id, name: 'Pessoa sintética', position: 1, status: 'ASSINADO' } });
  assert.equal(await hasPendingFinalizations(scopedDocuments, now), true);
  await db.signatureDocumentSigner.create({ data: { documentId: document.id, name: 'Outra pessoa sintética', position: 2, status: 'PENDENTE' } });
  assert.equal(await hasPendingFinalizations(scopedDocuments, now), false);
  const purge = await db.signatureDocumentFilePurge.create({ data: { operationKey: prefix, targetUserId: prefix, quarantineRoot: prefix, manifest: [], status: 'PREPARANDO', createdAt: now } });
  const scopedPurges = { signatureDocumentFilePurge: { findFirst: args => db.signatureDocumentFilePurge.findFirst({ ...args, where: { AND: [{ id: purge.id }, args.where] } }) } };
  assert.equal(await hasSignatureFilePurgeWork(scopedPurges, now), false);
  assert.equal(await hasSignatureFilePurgeWork(scopedPurges, new Date(now.getTime() + 15 * 60_000)), true);
  await db.signatureDocumentFilePurge.update({ where: { id: purge.id }, data: { status: 'EM_PROCESSAMENTO', claimedAt: now } });
  assert.equal(await hasSignatureFilePurgeWork(scopedPurges, now), false);
  assert.equal(await hasSignatureFilePurgeWork(scopedPurges, new Date(now.getTime() + 15 * 60_000)), true);
  await db.signatureDocumentFilePurge.update({ where: { id: purge.id }, data: { status: 'FALHOU', nextAttemptAt: new Date(now.getTime() + 60_000) } });
  assert.equal(await hasSignatureFilePurgeWork(scopedPurges, now), false);
  assert.equal(await hasSignatureFilePurgeWork(scopedPurges, new Date(now.getTime() + 60_000)), true);
});
