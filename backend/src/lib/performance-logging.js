import env from '../config/env.js';

export function logSlowOperation(operation, durationMs, details = {}, options = {}) {
  const thresholdMs = options.thresholdMs ?? env.slowOperationLogMs;
  if (!Number.isFinite(thresholdMs) || thresholdMs <= 0) return false;
  if (!Number.isFinite(durationMs) || durationMs < thresholdMs) return false;

  console.warn('[SLOW OPERATION]', {
    operation,
    durationMs,
    ...details
  });
  return true;
}
