import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHttpPerformanceBenchmark } from '../scripts/benchmark-http-performance.js';

test('HTTP + PostgreSQL: concurrent independent sessions preserve permissions, metrics and worker freshness', {
  skip: !process.env.HTTP_PERFORMANCE_TEST_DATABASE_URL, timeout: 90000
}, async () => {
  process.env.DATABASE_URL = process.env.HTTP_PERFORMANCE_TEST_DATABASE_URL;
  const result = await runHttpPerformanceBenchmark({ requests: 2, coldRounds: 1, reportCount: 40, scopeCount: 6, concurrency: 4, distributeGroupReports: true, readCacheEnabled: true });
  assert.equal(result.environment.readCacheEnabled, true);
  assert.equal(result.summary.filter(row => row.phase === 'first-process').length, 8);
  assert.equal(result.summary.filter(row => row.phase === 'warm').length, 8);
  assert.equal(result.samples.length, 48);
  assert.equal(result.permissionChecks.length, 8);
  assert.equal(result.refresh.length, 16);
  assert.equal(result.acceptance.refreshWithin15s, true);
  assert.equal(result.acceptance.warmP95Available, false);
  assert.equal(result.acceptance.productionAcceptance, false);
  assert.equal(result.complete, true);
  assert.equal(result.attemptedScenarioRequests, result.samples.length);
  assert.equal(result.fixture.analyzedBeforeRequests, true);
  assert.equal(result.fixture.groupReportsDistributed, true);
  for (const row of result.summary) { assert.equal(row.status, 200); assert.equal(row.serverP95Ms, null); }
  for (const row of result.samples) {
    assert.ok(row.server.databaseCalls > 0, 'Trace must include real session/database reads');
    assert.ok(row.server.databaseQueriesPeak >= 1 && row.server.databaseQueriesPeak <= row.server.databaseCalls,
      'Peak measures submitted unfinished queries, including work queued in pg');
    assert.equal(row.server.dbPool.max, 8);
    assert.equal(row.server.aborted, false);
    assert.doesNotMatch(JSON.stringify(row), /labor-benchmark-|Bearer |tokenHash|synthetic-unused-login/);
  }
  assert.ok(result.pool.find(row => row.phase === 'warm').samples > 0);
  assert.equal(result.worker.projectTimestampUnchanged, true);
  for (const row of result.refresh.filter(row => row.scenario === 'cards')) assert.equal(row.changed, true);
});

test('HTTP benchmark preserves existing operational data and writes a visibly incomplete artifact', {
  skip: !process.env.HTTP_PERFORMANCE_TEST_DATABASE_URL, timeout: 30000
}, async t => {
  process.env.DATABASE_URL = process.env.HTTP_PERFORMANCE_TEST_DATABASE_URL;
  const { createPrismaClient } = await import('../src/lib/prisma.js');
  const database = createPrismaClient();
  const id = 'http-benchmark-guard-' + randomUUID();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'filtro-http-guard-'));
  const output = path.join(directory, 'incomplete.json');
  t.after(async () => {
    await database.project.deleteMany({ where: { id } });
    await database.$disconnect();
    await fs.rm(directory, { recursive: true, force: true });
  });
  await database.project.create({ data: { id, code: id, name: 'Existing synthetic project',
    clientName: 'Synthetic', clientCnpj: '', contractCode: id, location: 'Local' } });
  const countBefore = await database.project.count();
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/benchmark-http-performance.js', import.meta.url)), '--output=' + output],
    { env: { ...process.env, NODE_ENV: 'test' }, encoding: 'utf8', timeout: 15000 });
  assert.equal(child.status, 1);
  const partial = JSON.parse(await fs.readFile(output, 'utf8'));
  assert.equal(partial.complete, false);
  assert.equal(partial.attemptedScenarioRequests, 0);
  assert.equal(partial.acceptance.functionalChecksPassed, false);
  assert.match(partial.failure.message, /dedicated empty test database/);
  assert.equal(await database.project.count(), countBefore);
  assert.ok(await database.project.findUnique({ where: { id } }));
});
