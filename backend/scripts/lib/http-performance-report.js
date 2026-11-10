import assert from 'node:assert/strict';

export function assertLocalPerformanceDatabase(value) {
  const url = new URL(value || 'invalid:');
  assert.ok(['postgresql:', 'postgres:'].includes(url.protocol)
    && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    && /_test$/.test(url.pathname) && !url.search,
  'HTTP benchmark requires a loopback PostgreSQL test database without connection query overrides.');
}

export function summarizeHttpSamples(samples) {
  const groups = new Map();
  for (const sample of samples) {
    const { scenario, profile, phase, status, server } = sample;
    const key = JSON.stringify([scenario, profile, phase, status, server.aborted]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(sample);
  }
  return [...groups.values()].map(rows => {
    const first = rows[0];
    const percentile = (field, fraction) => {
      const values = rows.map(field).sort((a, b) => a - b);
      return values[Math.ceil(values.length * fraction) - 1];
    };
    const enoughSamples = rows.length >= 100;
    return { scenario: first.scenario, profile: first.profile, phase: first.phase,
      status: first.status, aborted: first.server.aborted, requests: rows.length, enoughSamples,
      clientMedianMs: percentile(row => row.clientMs, .5),
      clientP95Ms: enoughSamples ? percentile(row => row.clientMs, .95) : null,
      serverMedianMs: percentile(row => row.server.durationMs, .5),
      serverP95Ms: enoughSamples ? percentile(row => row.server.durationMs, .95) : null,
      maxBytes: Math.max(...rows.map(row => row.bytes)),
      databaseCallsMedian: percentile(row => row.server.databaseCalls || 0, .5),
      databaseCallsMax: Math.max(...rows.map(row => row.server.databaseCalls || 0)),
      maxPoolWaiting: Math.max(...rows.map(row => row.server.poolWaitingMax)),
      maxEventLoopDelayMs: Math.max(...rows.map(row => row.server.eventLoopDelayMaxMs)) };
  });
}

// Interval samples only: request-start/end samples would overcount an idle pool.
export function createActivePoolReport() {
  let samples = 0, waitingZeroSamples = 0, waitingMax = 0, waitingSince = null, waitingRunMaxMs = 0, lastAt = null;
  return {
    add(pool, now, active) {
      if (!active) {
        if (waitingSince != null && lastAt != null) waitingRunMaxMs = Math.max(waitingRunMaxMs, lastAt - waitingSince);
        waitingSince = null;
        return;
      }
      samples++;
      waitingMax = Math.max(waitingMax, pool.waiting);
      if (pool.waiting === 0) { waitingZeroSamples++; waitingSince = null; }
      else if (waitingSince == null) waitingSince = now;
      if (waitingSince != null) waitingRunMaxMs = Math.max(waitingRunMaxMs, now - waitingSince);
      lastAt = now;
    },
    result() {
      return { samples, waitingZeroSamples, waitingMax, observedWaitingRunMaxMs: waitingRunMaxMs,
        waitingZeroFraction: samples ? waitingZeroSamples / samples : null,
        waitingZeroTargetMet: samples ? waitingZeroSamples / samples >= .95 : null,
        observedWaitingOverFiveSeconds: waitingRunMaxMs > 5000 };
    }
  };
}

export async function mapConcurrent(items, concurrency, callback) {
  assert.ok(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 8);
  let cursor = 0, failed = false, failure;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!failed && cursor < items.length) {
      const index = cursor++;
      try { await callback(items[index], index); }
      catch (error) { if (!failed) { failed = true; failure = error; } }
    }
  }));
  if (failed) throw failure;
}
