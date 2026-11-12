import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';

const requests = new AsyncLocalStorage();

export const REQUEST_CACHE_NAMES = Object.freeze(['responses', 'monthly', 'references', 'progress']);
export const REQUEST_CACHE_FIELDS = Object.freeze(['hit', 'miss', 'shared', 'bypassed', 'expired', 'evicted',
  'oversized', 'loadFailed', 'decodeFailed', 'revisionChanged', 'encodedBytes', 'encodeMs', 'decodeMs']);

// Fixed labels and numeric aggregates only: cache keys, revisions, users and
// payloads never enter telemetry. No clock or allocation when collection is off.
export function recordRequestCache(name, field, value = 1) {
  if (!REQUEST_CACHE_NAMES.includes(name) || !REQUEST_CACHE_FIELDS.includes(field)
    || !Number.isFinite(value) || value < 0) return;
  const trace = requests.getStore();
  if (!trace) return;
  trace.caches ??= {};
  const counters = trace.caches[name] ??= {};
  counters[field] = (counters[field] || 0) + value;
}

export function measureRequestCacheStage(name, stage, callback) {
  if (!requests.getStore() || !REQUEST_CACHE_NAMES.includes(name)) return callback();
  const started = performance.now();
  const finish = () => recordRequestCache(name, stage + 'Ms', performance.now() - started);
  try {
    const result = callback();
    if (result && typeof result.then === 'function') return result.finally(finish);
    finish();
    return result;
  } catch (error) { finish(); throw error; }
}

export function withRequestPerformance(trace, callback) {
  return requests.run(trace, callback);
}

// Os nomes são constantes do código. Nenhum parâmetro, corpo ou resultado é guardado.
export function measureRequestStage(name, callback) {
  const trace = requests.getStore();
  if (!trace) return callback();
  const started = performance.now();
  const finish = () => {
    if (!Object.hasOwn(trace.stages, name) && Object.keys(trace.stages).length >= 20) return;
    trace.stages[name] = (trace.stages[name] || 0) + performance.now() - started;
  };
  try {
    const result = callback();
    if (result && typeof result.then === 'function') return result.finally(finish);
    finish();
    return result;
  } catch (error) {
    finish();
    throw error;
  }
}
