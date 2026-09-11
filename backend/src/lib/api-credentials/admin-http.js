import { randomUUID } from 'node:crypto';
import { integrationApiErrorHandler } from '../../middleware/api-request-context.js';
import { apiValidationError } from '../../../../shared/schemas/api-validation-messages.js';

export function adminCredentialRequestContext(req, res, next) {
  req.requestId = randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
}

// Mantém o campo legado error, usando a mesma redação segura da API externa.
export function adminCredentialErrorHandler(error, req, res, next) {
  const localizedError = error?.name === 'ZodError' ? {
    name: 'ZodError',
    issues: error.issues.map(issue => ({ ...issue, message: apiValidationError(issue) ?? issue.message }))
  } : error;
  return integrationApiErrorHandler(localizedError, req, {
    headersSent: res.headersSent,
    setHeader: (...args) => res.setHeader(...args),
    status(code) { res.status(code); return this; },
    json(body) { return res.json({ ...body, error: body.message }); }
  }, next);
}
