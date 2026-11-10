import fs from 'node:fs/promises';

const SNAPSHOT_MAX_AGE_MS = 45_000;
const IDLE_MAX_AGE_MS = 120_000;
const STARTUP_GRACE_MS = 120_000;
export const WORKER_HEALTH_FILE = process.env.WORKER_HEALTH_FILE || '/tmp/filtro-worker-health.json';

export function createWorkerProgress({ now = Date.now, pid = process.pid } = {}) {
  const startedAt = now();
  let lastCompletedAt = null;
  let completed = 0;
  const active = new Map();
  return {
    begin(name, timeoutMs = 60 * 60_000) {
      const token = Symbol(name);
      active.set(token, { name: String(name).slice(0, 128), startedAt: now(),
        timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 60 * 60_000 });
      let done = false;
      return () => {
        if (done) return;
        done = true;
        active.delete(token);
        lastCompletedAt = now();
        completed++;
      };
    },
    snapshot() { return { version: 1, pid, startedAt, checkedAt: now(), lastCompletedAt, completed, active: [...active.values()] }; }
  };
}

export function evaluateWorkerHealth(snapshot, now = Date.now()) {
  if (snapshot?.version !== 1 || !Number.isSafeInteger(snapshot.pid) || snapshot.pid <= 0
    || ![snapshot.startedAt, snapshot.checkedAt].every(Number.isFinite)
    || !Array.isArray(snapshot.active) || snapshot.active.length > 128) return { healthy: false, reason: 'invalid-snapshot' };
  if (snapshot.checkedAt > now + 5_000 || now - snapshot.checkedAt > SNAPSHOT_MAX_AGE_MS) return { healthy: false, reason: 'stale-snapshot' };
  for (const task of snapshot.active) {
    if (![task.startedAt, task.timeoutMs].every(Number.isFinite) || task.timeoutMs <= 0
      || now - task.startedAt > task.timeoutMs + SNAPSHOT_MAX_AGE_MS) return { healthy: false, reason: 'task-stalled', task: task.name };
  }
  // A timer writing a fresh file alone is insufficient: some queue scan/job must
  // finish, or still be running within its deadline. Empty scans count as progress.
  if (now - snapshot.startedAt > STARTUP_GRACE_MS && snapshot.active.length === 0
    && (!Number.isFinite(snapshot.lastCompletedAt) || now - snapshot.lastCompletedAt > IDLE_MAX_AGE_MS)) return { healthy: false, reason: 'no-job-progress' };
  return { healthy: true };
}

let progress;
export function beginWorkerTask(name, timeoutMs) { return progress?.begin(name, timeoutMs) || (() => {}); }

export function startWorkerHealthReporter({ file = WORKER_HEALTH_FILE, logger = console, intervalMs = 15_000 } = {}) {
  if (progress) throw new Error('Worker health reporter already started.');
  progress = createWorkerProgress();
  const current = progress;
  let writing = false;
  const write = async () => {
    if (writing) return;
    writing = true;
    const temporary = `${file}.${process.pid}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(current.snapshot()), { mode: 0o600 });
      await fs.rename(temporary, file);
    } catch (error) { logger.error('[worker] falha ao registrar progresso', error?.message); }
    finally { writing = false; }
  };
  void write();
  const timer = setInterval(() => void write(), intervalMs);
  timer.unref?.();
  return () => { clearInterval(timer); progress = undefined; };
}
