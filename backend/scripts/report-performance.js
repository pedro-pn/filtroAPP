import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { REQUEST_CACHE_NAMES, REQUEST_CACHE_FIELDS } from '../src/lib/operations/request-performance.js';

// Limita a memória mesmo quando a entrada contém logs de vários dias.
export function createPerformanceReport({ maxRoutes = 256, maxSamples = 10000 } = {}) {
  const routes = new Map();
  let droppedRoutes = 0;
  const pool = { samples: 0, waitingZeroSamples: 0, waitingMax: 0, observedWaitingRunMaxMs: 0 };
  const poolIntervals = new Set();
  const caches = {};
  return {
    add(event) {
      if (!event || typeof event.path !== 'string' || typeof event.method !== 'string'
        || !Number.isFinite(event.durationMs) || event.durationMs < 0) return;
      for (const name of REQUEST_CACHE_NAMES) {
        for (const field of REQUEST_CACHE_FIELDS) {
          const value = event.caches?.[name]?.[field];
          if (!Number.isFinite(value) || value < 0 || (!field.endsWith('Ms') && !Number.isSafeInteger(value))) continue;
          const counters = caches[name] ??= {};
          counters[field] = Math.min(Number.MAX_SAFE_INTEGER, (counters[field] || 0) + value);
        }
      }
      const activePool = event.activePool;
      if (activePool && Number.isSafeInteger(activePool.samples) && activePool.samples >= 0
        && Number.isSafeInteger(activePool.waitingZeroSamples) && activePool.waitingZeroSamples >= 0
        && activePool.waitingZeroSamples <= activePool.samples) {
        pool.samples += activePool.samples;
        pool.waitingZeroSamples += activePool.waitingZeroSamples;
        pool.waitingMax = Math.max(pool.waitingMax, Number(activePool.waitingMax) || 0);
        pool.observedWaitingRunMaxMs = Math.max(pool.observedWaitingRunMaxMs, Number(activePool.observedWaitingRunMaxMs) || 0);
        if (Number.isInteger(activePool.sampleIntervalMs) && activePool.sampleIntervalMs >= 10 && activePool.sampleIntervalMs <= 1000) poolIntervals.add(activePool.sampleIntervalMs);
      }
      const key = JSON.stringify([event.method, event.path, event.statusCode, Boolean(event.aborted)]);
      if (!routes.has(key)) {
        if (routes.size >= maxRoutes) { droppedRoutes++; return; }
        routes.set(key, { method: event.method, path: event.path, statusCode: event.statusCode,
          aborted: Boolean(event.aborted), requests: 0, durations: [], maxMs: 0, maxPoolWaiting: 0, maxEventLoopDelayMs: 0 });
      }
      const route = routes.get(key);
      route.requests++;
      route.maxMs = Math.max(route.maxMs, event.durationMs);
      if (route.durations.length < maxSamples) route.durations.push(event.durationMs);
      route.maxPoolWaiting = Math.max(route.maxPoolWaiting, Number(event.poolWaitingMax) || 0);
      route.maxEventLoopDelayMs = Math.max(route.maxEventLoopDelayMs, Number(event.eventLoopDelayMaxMs) || 0);
    },
    result() {
      return { droppedRoutes, pool: { ...pool, sampleIntervalsMs: [...poolIntervals].sort((a, b) => a - b),
        waitingZeroFraction: pool.samples ? pool.waitingZeroSamples / pool.samples : null,
        waitingZeroTargetMet: pool.samples ? pool.waitingZeroSamples / pool.samples >= .95 : null,
        observedWaitingOverFiveSeconds: pool.samples ? pool.observedWaitingRunMaxMs > 5000 : null },
      caches: Object.fromEntries(Object.entries(caches).map(([name, values]) =>
        [name, Object.fromEntries(Object.entries(values).map(([field, value]) => [field, Math.round(value * 100) / 100]))])),
      routes: [...routes.values()].map(({ durations, ...route }) => {
        const values = durations.toSorted((a, b) => a - b);
        const complete = route.requests === values.length;
        const percentile = fraction => complete ? values[Math.ceil(values.length * fraction) - 1] : null;
        return { ...route, samples: values.length, complete,
          enoughSamplesForAcceptance: complete && values.length >= 100,
          p50Ms: percentile(.5), p95Ms: percentile(.95) };
      }) };
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = createPerformanceReport();
  for await (const line of createInterface({ input: process.stdin })) {
    const marker = line.indexOf('[HTTP PERFORMANCE]');
    if (marker < 0) continue;
    try { report.add(JSON.parse(line.slice(marker + '[HTTP PERFORMANCE]'.length).trim())); }
    catch { /* Outras mensagens e linhas incompletas não pertencem à coleta. */ }
  }
  console.log(JSON.stringify(report.result(), null, 2));
}
