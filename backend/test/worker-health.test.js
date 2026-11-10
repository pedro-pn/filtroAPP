import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createWorkerProgress, evaluateWorkerHealth, startWorkerHealthReporter, beginWorkerTask } from '../src/lib/operations/worker-health.js';

test('worker precisa terminar rotinas, um arquivo atualizado por timer não comprova progresso', () => {
  let now = 0;
  const state = createWorkerProgress({ now: () => now });
  assert.equal(evaluateWorkerHealth(state.snapshot(), now).healthy, true);
  now = 121_000;
  assert.equal(evaluateWorkerHealth(state.snapshot(), now).reason, 'no-job-progress');
  const finish = state.begin('queue');
  assert.equal(evaluateWorkerHealth(state.snapshot(), now).healthy, true);
  finish(); finish();
  assert.equal(state.snapshot().completed, 1);
  assert.equal(state.snapshot().active.length, 0);
  now += 119_000;
  assert.equal(evaluateWorkerHealth(state.snapshot(), now).healthy, true);
  now += 2_000;
  assert.equal(evaluateWorkerHealth(state.snapshot(), now).reason, 'no-job-progress');
});

test('rotina travada é detectada mesmo com outras filas terminando e snapshots frescos', () => {
  let now = 0;
  const state = createWorkerProgress({ now: () => now });
  state.begin('stalled', 60_000);
  now = 106_000;
  state.begin('other')();
  assert.deepEqual(evaluateWorkerHealth(state.snapshot(), now), { healthy: false, reason: 'task-stalled', task: 'stalled' });
});

test('snapshot antigo, inválido ou futuro não é saudável', () => {
  const state = createWorkerProgress({ now: () => 0 });
  const snapshot = state.snapshot();
  assert.equal(evaluateWorkerHealth(snapshot, 46_000).reason, 'stale-snapshot');
  assert.equal(evaluateWorkerHealth({ ...snapshot, checkedAt: 100_000 }, 0).reason, 'stale-snapshot');
  assert.equal(evaluateWorkerHealth({}, 0).reason, 'invalid-snapshot');
});

test('reporter escreve snapshot atômico e comando verifica o processo e o progresso', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'filtro-worker-health-'));
  const file = path.join(dir, 'health.json');
  const stop = startWorkerHealthReporter({ file, intervalMs: 10 });
  try {
    beginWorkerTask('queue:probe')();
    let snapshot;
    for (let i = 0; i < 100; i++) {
      try { snapshot = JSON.parse(await fs.readFile(file, 'utf8')); if (snapshot.completed) break; } catch { /* pending initial atomic write */ }
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(snapshot.completed, 1);
    const check = () => spawnSync(process.execPath, ['scripts/check-worker-health.js'], {
      cwd: new URL('..', import.meta.url), env: { ...process.env, WORKER_HEALTH_FILE: file }, encoding: 'utf8'
    });
    assert.equal(check().status, 0);
    stop();
    // Allow an in-flight write to finish before replacing the fixture.
    await new Promise(resolve => setTimeout(resolve, 20));
    await fs.writeFile(file, JSON.stringify({ ...snapshot, checkedAt: Date.now() - 60_000 }));
    const failed = check();
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /stale-snapshot/);
    await fs.writeFile(file, '{invalid');
    assert.equal(check().status, 1);
  } finally { stop(); await fs.rm(dir, { recursive: true, force: true }); }
});
