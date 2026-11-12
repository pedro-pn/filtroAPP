import fs from 'node:fs/promises';
import { evaluateWorkerHealth, WORKER_HEALTH_FILE } from '../src/lib/operations/worker-health.js';
try {
  const snapshot = JSON.parse(await fs.readFile(WORKER_HEALTH_FILE, 'utf8'));
  process.kill(snapshot.pid, 0);
  const result = evaluateWorkerHealth(snapshot);
  if (!result.healthy) { console.error(JSON.stringify(result)); process.exitCode = 1; }
} catch (error) { console.error('Worker health unavailable:', error?.code || error?.message); process.exitCode = 1; }
