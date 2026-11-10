import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Prisma } from '@prisma/client';
import { createDerivedReadCache, databaseReadVersion, UNTRACKED_READ_CACHE_MODELS } from '../src/lib/operations/derived-read-cache.js';
import { assertLocalPerformanceDatabase } from '../scripts/lib/http-performance-report.js';

test('PostgreSQL: late commits, rollbacks and independent writers invalidate derived responses', {
  skip: !process.env.HTTP_PERFORMANCE_TEST_DATABASE_URL
}, async t => {
  const url = process.env.HTTP_PERFORMANCE_TEST_DATABASE_URL;
  assertLocalPerformanceDatabase(url);
  process.env.DATABASE_URL = url;
  const { createPrismaClient } = await import('../src/lib/prisma.js');
  const database = createPrismaClient({ pool: new pg.Pool({ connectionString: url, max: 1 }) });
  const writers = new pg.Pool({ connectionString: url, max: 2, query_timeout: 2000, statement_timeout: 2000 });
  const first = await writers.connect(), second = await writers.connect();
  const prefix = 'derived-cache-' + randomUUID(), keys = [prefix + '-a', prefix + '-b'];
  t.after(async () => {
    await first.query('ROLLBACK'); await second.query('ROLLBACK');
    first.release(); second.release();
    await database.acompanhamentoSetting.deleteMany({ where: { key: { in: keys } } });
    await database.jobRun.deleteMany({ where: { id: prefix } });
    await writers.end(); await database.$disconnect();
  });
  await database.acompanhamentoSetting.createMany({ data: keys.map((key, i) => ({ key, numberValue: i + 1 })) });
  const cache = createDerivedReadCache();
  let reads = 0;
  const load = async () => { reads++; return (await database.acompanhamentoSetting.findMany({
    where: { key: { in: keys } }, orderBy: { key: 'asc' }, select: { numberValue: true }
  })).map(row => row.numberValue); };
  const initial = await databaseReadVersion(database);
  assert.equal(await databaseReadVersion(database), initial, 'Ordinary reads must not invalidate themselves');
  assert.deepEqual(await cache.get(initial, 'values', load), [1, 2]);
  assert.deepEqual(await cache.get(initial, 'values', load), [1, 2]);
  assert.equal(reads, 1);

  await first.query('BEGIN');
  await first.query('UPDATE "AcompanhamentoSetting" SET "numberValue" = 100 WHERE key = $1', [keys[0]]);
  await second.query('BEGIN');
  await second.query('UPDATE "AcompanhamentoSetting" SET "numberValue" = 200 WHERE key = $1', [keys[1]]);
  await second.query('COMMIT');
  const during = await databaseReadVersion(database);
  assert.notEqual(during, initial);
  assert.deepEqual(await cache.get(during, 'values', load), [1, 200], 'Uncommitted changes stay invisible');
  await first.query('COMMIT');
  const committed = await databaseReadVersion(database);
  assert.notEqual(committed, during, 'The older writer committing last must change the revision');
  assert.deepEqual(await cache.get(committed, 'values', load), [100, 200]);

  await first.query('BEGIN');
  await first.query('UPDATE "AcompanhamentoSetting" SET "numberValue" = 300 WHERE key = $1', [keys[0]]);
  const pending = await databaseReadVersion(database);
  assert.deepEqual(await cache.get(pending, 'values', load), [100, 200]);
  await first.query('ROLLBACK');
  const rolledBack = await databaseReadVersion(database);
  assert.equal(rolledBack, committed, 'A rollback must not change the committed source vector');
  assert.deepEqual(await cache.get(rolledBack, 'values', load), [100, 200]);
  assert.equal(reads, 3);

  await t.test('polling job records do not invalidate financial responses', async () => {
    const before = await databaseReadVersion(database);
    await database.jobRun.create({ data: { id: prefix, name: 'performance-test', status: 'COMPLETED' } });
    await database.jobRun.update({ where: { id: prefix }, data: { finishedAt: new Date() } });
    assert.equal(await databaseReadVersion(database), before);
  });

  await t.test('statement triggers cover every Prisma source, including future model additions', async () => {
    const expected = Prisma.dmmf.datamodel.models.map(model => model.dbName || model.name)
      .filter(name => !UNTRACKED_READ_CACHE_MODELS.includes(name)).sort();
    const triggers = await database.$queryRaw`
      SELECT c.relname AS name, t.tgtype::int AS kind, t.tgenabled::text AS enabled
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND t.tgname = 'performance_read_revision'
    `;
    assert.deepEqual(triggers.map(row => row.name).sort(), expected);
    assert.ok(triggers.every(row => row.kind === 60 && row.enabled === 'O'), 'INSERT/UPDATE/DELETE/TRUNCATE statement coverage');
  });

  await t.test('bounded compaction preserves active writers and advances an epoch before removing markers', async () => {
    const { compactReadRevisions, previewReadRevisionCompaction } = await import('../src/lib/operations/read-revision-maintenance.js');
    const before = await databaseReadVersion(database);
    const inactive = await database.performanceReadRevision.create({ data: {
      writerPid: -100000 - Math.floor(Math.random() * 1000000), revision: 1, updatedAt: new Date(Date.now() - 72 * 3600000)
    } });
    const [{ pid }] = await first.query('SELECT pg_backend_pid() AS pid').then(result => result.rows);
    const active = await database.performanceReadRevision.findUniqueOrThrow({ where: { writerPid: pid } });
    await database.performanceReadRevision.update({ where: { id: active.id }, data: { updatedAt: new Date(Date.now() - 72 * 3600000) } });
    try {
      assert.equal((await previewReadRevisionCompaction({ database })).eligible, 1);
      const afterInsert = await databaseReadVersion(database);
      assert.notEqual(afterInsert, before);
      assert.equal((await compactReadRevisions({ database, batchSize: 1 })).deleted, 1);
      assert.equal(await database.performanceReadRevision.findUnique({ where: { id: inactive.id } }), null);
      assert.ok(await database.performanceReadRevision.findUnique({ where: { id: active.id } }));
      const after = await databaseReadVersion(database);
      assert.notEqual(after, before, 'Compaction cannot recreate a previously cached fingerprint');
      assert.notEqual(after, afterInsert);
    } finally {
      await database.performanceReadRevision.deleteMany({ where: { id: inactive.id } });
      await database.performanceReadRevision.update({ where: { id: active.id }, data: { updatedAt: active.updatedAt } });
    }
  });
});
