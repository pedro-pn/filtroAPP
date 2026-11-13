import { logSlowOperation } from '../lib/performance-logging.js';
import { getDatabasePoolMetrics } from '../lib/prisma.js';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import env from '../config/env.js';
import { measureRequestStage, withRequestPerformance } from '../lib/operations/request-performance.js';

// Só os segmentos literais conhecidos podem entrar no prefixo. Isso também cobre
// routers montados em um ID/token cujo parâmetro não chega ao router filho.
const mountSegments = new Set(('api rdo auth notifications privacy webhooks projects reports bootstrap collaborators job-roles dds-themes project-segments operational-reports statistics surveys equipment inhibition-options units manometers particle-counters drafts uploads databook anotacoes romaneio logistica epi equipamentos estoque qualidade acompanhamento comercial custo ponto operations efetivo workforce assinaturas admin accounts integracoes v1 planning project-workflow conferencia-alocacao public-sign').split(' '));

export function normalizedRequestRoute(req) {
  if (typeof req.route?.path !== 'string') return 'unmatched';
  const prefix = String(req.baseUrl || '').split('/').filter(Boolean)
    .map(segment => mountSegments.has(segment) ? segment : ':scope').join('/');
  return `${prefix ? `/${prefix}` : ''}${req.route.path === '/' && prefix ? '' : req.route.path}` || '/';
}

export function createRequestMetrics({
  enabled = env.httpPerformanceEnabled,
  windowMs = env.httpPerformanceWindowMs,
  sampleIntervalMs = env.httpPerformanceSampleMs,
  getPool = getDatabasePoolMetrics,
  write = record => console.info('[HTTP PERFORMANCE]', JSON.stringify(record)),
  slowLog = logSlowOperation
} = {}) {
  const deadline = performance.now() + windowMs;
  const active = new Set();
  let timer;
  let lastSample = 0;
  let poolSamples = 0, poolZeroSamples = 0, poolWaitingMax = 0, poolWaitingSince = null, poolWaitingRunMaxMs = 0;
  const sample = () => {
    const now = performance.now();
    const delayMs = Math.max(0, now - lastSample - sampleIntervalMs);
    lastSample = now;
    const pool = getPool();
    poolSamples++;
    poolWaitingMax = Math.max(poolWaitingMax, pool.waiting);
    if (!pool.waiting) { poolZeroSamples++; poolWaitingSince = null; }
    else if (poolWaitingSince === null) poolWaitingSince = now;
    if (poolWaitingSince !== null) poolWaitingRunMaxMs = Math.max(poolWaitingRunMaxMs, now - poolWaitingSince);
    for (const trace of active) {
      trace.poolWaitingMax = Math.max(trace.poolWaitingMax, pool.waiting);
      trace.eventLoopDelayMaxMs = Math.max(trace.eventLoopDelayMaxMs, delayMs);
    }
  };
  return (req, res, next) => {
    const startedAt = performance.now();
    const detailed = enabled && startedAt < deadline;
    const trace = detailed ? {
      requestId: randomUUID(), stages: {}, poolWaitingMax: getPool().waiting, eventLoopDelayMaxMs: 0
    } : null;
    if (trace) {
      active.add(trace);
      if (!timer) {
        lastSample = performance.now();
        timer = setInterval(sample, sampleIntervalMs);
        timer.unref();
      }
      const json = res.json;
      res.json = function (...args) { return measureRequestStage('http.serialize', () => json.apply(this, args)); };
    }
    let finished = false;
    const finish = aborted => {
      if (finished) return;
      finished = true;
      const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
      const dbPool = getPool();
      const path = normalizedRequestRoute(req);
      slowLog('http_request', durationMs, { method: req.method, path, statusCode: res.statusCode, dbPool });
      if (!trace) return;
      active.delete(trace);
      if (!active.size) { clearInterval(timer); timer = undefined; poolWaitingSince = null; }
      trace.poolWaitingMax = Math.max(trace.poolWaitingMax, dbPool.waiting);
      trace.eventLoopDelayMaxMs = Math.max(trace.eventLoopDelayMaxMs, performance.now() - lastSample - sampleIntervalMs, 0);
      // Drain global interval counts once. Concurrent requests must not each
      // report the same pool observation; start/end snapshots are excluded.
      const activePool = { samples: poolSamples, waitingZeroSamples: poolZeroSamples,
        waitingMax: poolWaitingMax, observedWaitingRunMaxMs: poolWaitingRunMaxMs, sampleIntervalMs };
      poolSamples = 0; poolZeroSamples = 0; poolWaitingMax = 0; poolWaitingRunMaxMs = 0;
      write({
        timestamp: new Date().toISOString(), requestId: trace.requestId,
        method: req.method, path, statusCode: res.statusCode, aborted,
        durationMs, responseBytes: Number(res.getHeader('content-length')) || 0,
        dbPool, activePool, poolWaitingMax: trace.poolWaitingMax,
        eventLoopDelayMaxMs: Math.round(trace.eventLoopDelayMaxMs * 100) / 100,
        ...(trace.caches ? { caches: Object.fromEntries(Object.entries(trace.caches).map(([name, values]) =>
          [name, Object.fromEntries(Object.entries(values).map(([field, value]) => [field, Math.round(value * 100) / 100]))])) } : {}),
        stages: Object.fromEntries(Object.entries(trace.stages).map(([name, ms]) => [name, Math.round(ms * 100) / 100]))
      });
    };
    res.once('finish', () => finish(false));
    res.once('close', () => finish(!res.writableFinished));
    if (trace) return withRequestPerformance(trace, next);
    return next();
  };
}

export const requestMetrics = createRequestMetrics();
