import { randomUUID } from 'node:crypto';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const SENSITIVE_ERROR_TEXT = /fva_[A-Za-z0-9_-]{16}_[A-Za-z0-9_-]{20,}|\bBearer\s+\S+|\b(?:hmac|secret|password|authorization)\b|\b[a-f0-9]{64}\b|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?:\/home\/|\/var\/|\/tmp\/|[A-Za-z]:\\)/i;

function safeErrorText(value, fallback) {
  const text = String(value || '');
  return text && !SENSITIVE_ERROR_TEXT.test(text) ? text.slice(0, 500) : fallback;
}

function safeErrorFields(fields) {
  if (!Array.isArray(fields)) return undefined;
  return fields.slice(0, 20).map(field => ({
    path: String(field?.path || '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 100),
    message: safeErrorText(field?.message, 'Valor inválido.')
  }));
}

export class IntegrationApiError extends Error {
  constructor(statusCode, code, message, extra = {}) {
    super(message);
    this.name = 'IntegrationApiError';
    this.statusCode = statusCode;
    this.code = code;
    Object.assign(this, extra);
  }
}

export function apiRequestContext({ maxQueryKeys = 20, maxQueryLength = 8192, timeoutMs = 15_000 } = {}) {
  return function integrationRequestContext(req, res, next) {
    if (req.requestId && req.apiStartedAt) {
      res.setHeader('X-Request-Id', req.requestId);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Pragma', 'no-cache');
      return next();
    }
    const incomingRequestId = String(req.headers?.['x-request-id'] || '').trim();
    req.requestId = REQUEST_ID_PATTERN.test(incomingRequestId) ? incomingRequestId : randomUUID();
    req.apiStartedAt = process.hrtime.bigint();
    res.setHeader('X-Request-Id', req.requestId);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');

    const queryText = String(req.originalUrl || '').split('?')[1] || '';
    if (queryText.length > maxQueryLength || Object.keys(req.query || {}).length > maxQueryKeys) {
      return sendIntegrationError(res, req, 400, 'VALIDATION_ERROR', 'A consulta excede os limites permitidos.');
    }
    res.setTimeout(timeoutMs, () => {
      if (!res.headersSent) sendIntegrationError(res, req, 504, 'REQUEST_TIMEOUT', 'A consulta excedeu o tempo limite.');
    });
    next();
  };
}

export function integrationApiBoundary({ allowedOrigins = [], requireHttps = false } = {}) {
  const origins = new Set(allowedOrigins);
  return function integrationBoundary(req, res, next) {
    if (req.integrationBoundaryApplied) return next();
    req.integrationBoundaryApplied = true;
    const origin = typeof req.headers?.origin === 'string' ? req.headers.origin : '';
    if (origin) {
      res.removeHeader('Access-Control-Allow-Origin');
      res.setHeader('Vary', 'Origin');
      if (!origins.has(origin)) {
        return sendIntegrationError(res, req, 403, 'CORS_NOT_ALLOWED', 'Esta origem de navegador não está autorizada.');
      }
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Request-Id');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Request-Id, Retry-After');
      if (req.method === 'OPTIONS') return res.status(204).end();
    }
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return sendIntegrationError(res, req, 405, 'METHOD_NOT_ALLOWED', 'A API de integração aceita somente consultas GET.');
    }
    const contentLength = Number(req.headers?.['content-length'] || 0);
    if ((Number.isFinite(contentLength) && contentLength > 0) || req.headers?.['transfer-encoding']) {
      return sendIntegrationError(res, req, 400, 'BODY_NOT_ALLOWED', 'Requisições de consulta não aceitam corpo.');
    }
    if (requireHttps && !req.secure) {
      return sendIntegrationError(res, req, 403, 'HTTPS_REQUIRED', 'A API de integração exige HTTPS.');
    }
    return next();
  };
}

export function sendIntegrationError(res, req, statusCode, code, message, extra = {}) {
  if (statusCode === 429 && extra.retryAfterSeconds) {
    res.setHeader('Retry-After', String(extra.retryAfterSeconds));
  }
  const fields = safeErrorFields(extra.fields);
  return res.status(statusCode).json({
    code: String(code || 'REQUEST_FAILED').replace(/[^A-Z0-9_]/g, '').slice(0, 80),
    message: safeErrorText(message, 'A requisição não pôde ser processada.'),
    requestId: REQUEST_ID_PATTERN.test(req?.requestId || '') ? req.requestId : randomUUID(),
    ...(fields ? { fields } : {})
  });
}

export function integrationApiErrorHandler(error, req, res, _next) {
  if (res.headersSent) return;
  if (error?.name === 'ZodError') {
    const fields = (error.issues || []).map(issue => ({ path: issue.path.join('.'), message: issue.message }));
    return sendIntegrationError(res, req, 400, 'VALIDATION_ERROR', 'Parâmetros inválidos.', { fields });
  }
  if (error instanceof IntegrationApiError || error?.statusCode) {
    const status = error.statusCode || 500;
    return sendIntegrationError(
      res,
      req,
      status,
      error.code || (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED'),
      status >= 500 ? 'Não foi possível concluir a consulta.' : error.message,
      { retryAfterSeconds: error.retryAfterSeconds, fields: error.fields }
    );
  }
  return sendIntegrationError(res, req, 500, 'INTERNAL_ERROR', 'Não foi possível concluir a consulta.');
}
