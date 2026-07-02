import { logSlowOperation } from '../lib/performance-logging.js';

export function requestMetrics(req, res, next) {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    logSlowOperation('http_request', Math.round(durationMs), {
      method: req.method,
      path: req.route?.path || req.path,
      statusCode: res.statusCode
    });
  });
  next();
}
