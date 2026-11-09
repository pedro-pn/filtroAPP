import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

// Limita a memória mesmo quando a entrada contém logs de vários dias.
export function createPerformanceReport({ maxRoutes = 256, maxSamples = 10000 } = {}) {
  const routes = new Map();
  let droppedRoutes = 0;
  return {
    add(event) {
      if (!event || typeof event.path !== 'string' || typeof event.method !== 'string'
        || !Number.isFinite(event.durationMs) || event.durationMs < 0) return;
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
      return { droppedRoutes, routes: [...routes.values()].map(({ durations, ...route }) => {
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
