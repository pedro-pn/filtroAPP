import assert from 'node:assert/strict';
import test from 'node:test';
import { reportJobRunVolume } from '../src/lib/operations/job-run-volume.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('job volume uses a bounded read-only snapshot and emits aggregate UTC counts and storage only', async () => {
  const calls = [];
  const tx = { $executeRaw: async sql => { calls.push(sql.join('')); }, $queryRaw: async (sql, ...values) => {
    calls.push(sql.join(''));
    if (calls.length === 3) return [{ observedAt: new Date('2026-11-11T12:00:00Z'), readOnly: true, estimatedRows: -1,
      tableBytes: '1024', indexBytes: '2048', totalBytes: '3072' }];
    assert.deepEqual(values, [7]);
    return [{ day: new Date('2026-11-11'), status: 'COMPLETED', rows: '123' },
      { day: new Date('2026-11-11'), status: 'OTHER', rows: '9007199254740993' }];
  } };
  const database = { $transaction: async (callback, options) => {
    assert.deepEqual(options, { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 10000 });
    return callback(tx);
  } };
  const result = await reportJobRunVolume({ database });
  assert.equal(calls[0], 'SET TRANSACTION READ ONLY');
  assert.equal(calls[1], "SET LOCAL statement_timeout = '5s'");
  assert.equal(result.readOnly, true); assert.equal(result.complete, true);
  assert.equal(result.storage.estimatedRows, null);
  assert.equal(result.storage.totalBytes, 3072);
  assert.deepEqual(result.rowsByUtcDayAndStatus, [{ day: '2026-11-11', status: 'COMPLETED', rows: 123 },
    { day: '2026-11-11', status: 'OTHER', rows: '9007199254740993' }]);
});

test('invalid volume windows fail before any database access and query failures propagate', async () => {
  const database = { $transaction: async () => { throw new Error('query failed'); } };
  for (const days of [0, 91, 1.5, NaN]) await assert.rejects(reportJobRunVolume({ days, database }), /entre 1 e 90/);
  await assert.rejects(reportJobRunVolume({ days: 1, database }), /query failed/);
});

test('a failed volume CLI overwrites an old success artifact without exposing connection details', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'filtro-job-volume-cli-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'report.json');
  await fs.writeFile(output, JSON.stringify({ complete: true }));
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/report-job-run-volume.js', import.meta.url)),
    '--days=91', '--output=' + output], { encoding: 'utf8', timeout: 10000,
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: 'postgresql://unused:local_test@127.0.0.1:59999/volume_test' }
  });
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(await fs.readFile(output, 'utf8')), { complete: false, readOnly: null, error: 'JOB_VOLUME_REPORT_FAILED' });
  assert.equal((result.stdout + result.stderr).includes('local_test'), false);
});
