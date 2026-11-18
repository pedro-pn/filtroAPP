import assert from 'node:assert/strict';
import test from 'node:test';

import { createHealthCheck } from '../src/lib/operations/health.js';

test('health check reports ok with version when the database answers', async () => {
  const check = createHealthCheck({ probe: async () => [{ '?column?': 1 }], versionFn: () => 'abc1234' });
  assert.deepEqual(await check(), { ok: true, database: 'ok', version: 'abc1234' });
});

test('health check reports unavailable when the database query fails', async () => {
  const check = createHealthCheck({
    probe: async () => {
      throw new Error("Can't reach database server");
    },
    versionFn: () => 'abc1234'
  });
  assert.deepEqual(await check(), { ok: false, database: 'unavailable', version: 'abc1234' });
});

test('health check times out a hanging database probe', async () => {
  const check = createHealthCheck({
    probe: () => new Promise(() => {}),
    timeoutMs: 20,
    versionFn: () => 'unknown'
  });
  const result = await check();
  assert.equal(result.ok, false);
  assert.equal(result.database, 'timeout');
});

test('health check shares in-flight probes and caches the result briefly', async () => {
  let now = 0;
  let probes = 0;
  const check = createHealthCheck({
    probe: async () => {
      probes += 1;
    },
    cacheMs: 1000,
    nowFn: () => now,
    versionFn: () => 'v'
  });
  await Promise.all([check(), check(), check()]);
  assert.equal(probes, 1);
  now = 500;
  await check();
  assert.equal(probes, 1);
  now = 1500;
  await check();
  assert.equal(probes, 2);
});
