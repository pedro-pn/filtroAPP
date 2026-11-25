import { createHash, timingSafeEqual } from 'node:crypto';

import { Router } from 'express';

import env from '../../config/env.js';
import { brasiliaDayStart, COUNTER_KINDS, incrementUsageCounter } from '../../lib/abuse/usage-counters.js';
import { defineRoute } from '../../lib/api-contract/registry.js';
import { jsonResponseSchema, libValidatedBodySchema } from '../../lib/api-contract/domains/efetivo.js';
import asyncHandler from '../../lib/async-handler.js';
import { ProjectIntakeConflictError, receiveProjectIntake } from '../../lib/projects/project-intake.js';
import { createMemoryRateLimit } from '../../lib/rate-limit.js';

const projectIntakeRateLimit = createMemoryRateLimit({
  windowMs: 60_000,
  max: 60,
  message: 'Muitos envios para o webhook de projetos. Tente novamente em instantes.'
});

function digest(value) {
  return createHash('sha256').update(String(value)).digest();
}

function bearerToken(req) {
  const match = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

export function requireProjectIntakeToken(req, res, next) {
  const expected = env.projectIntakeWebhookToken;
  const provided = bearerToken(req);
  if (!expected) {
    return res.status(503).json({
      error: 'Webhook de projetos não configurado neste ambiente.',
      code: 'PROJECT_WEBHOOK_NOT_CONFIGURED'
    });
  }
  if (!provided) {
    return res.status(401).json({
      error: 'Credencial de serviço ausente ou inválida.',
      code: 'INVALID_SERVICE_CREDENTIAL'
    });
  }
  const providedDigest = digest(provided);
  const expectedDigest = digest(expected);
  if (!timingSafeEqual(providedDigest, expectedDigest)) {
    return res.status(401).json({
      error: 'Credencial de serviço ausente ou inválida.',
      code: 'INVALID_SERVICE_CREDENTIAL'
    });
  }
  return next();
}

// Spec 042, 7.6: o caminho versionado é /api/webhooks/v1/projects. O antigo
// /api/webhooks/projects segue aceito (mesmo handler e mesmo token), descontinuado:
// responde com Deprecation (RFC 9745) e Link para a v1, e o uso é contado por dia
// para confirmar quando o ComercialAPP parou de chamá-lo. Sunset (RFC 8594) só sai
// quando PROJECT_WEBHOOK_LEGACY_SUNSET estiver definido (D5: 60 dias após a migração).
export const PROJECT_WEBHOOK_V1_PATH = '/api/webhooks/v1/projects';
export const LEGACY_PROJECT_WEBHOOK_DEPRECATED_AT = new Date('2026-11-25T00:00:00Z');

export function setLegacyWebhookHeaders(res, { sunset = env.projectWebhookLegacySunset } = {}) {
  res.setHeader('Deprecation', `@${Math.floor(LEGACY_PROJECT_WEBHOOK_DEPRECATED_AT.getTime() / 1000)}`);
  res.setHeader('Link', `<${PROJECT_WEBHOOK_V1_PATH}>; rel="successor-version"`);
  if (sunset instanceof Date && !Number.isNaN(sunset.getTime())) res.setHeader('Sunset', sunset.toUTCString());
}

function countLegacyUse({ increment = incrementUsageCounter, now = new Date(), logger = console } = {}) {
  Promise.resolve()
    .then(() => increment({ kind: COUNTER_KINDS.LEGACY_PROJECT_WEBHOOK_DAY, periodStart: brasiliaDayStart(now), count: 1 }))
    .catch(error => logger.warn?.('Falha ao contar uso do webhook antigo de projetos.', error?.message || error));
}

async function receive(req, res) {
  try {
    const result = await receiveProjectIntake(req.body);
    return res.status(result.status === 'created' ? 201 : 200).json(result);
  } catch (error) {
    if (error instanceof ProjectIntakeConflictError) {
      return res.status(409).json({ error: error.message, code: error.code });
    }
    throw error;
  }
}

export function createProjectIntakeWebhookRouter({ legacy = false, countUse = countLegacyUse } = {}) {
  const router = Router();
  const markLegacy = (_req, res, next) => {
    setLegacyWebhookHeaders(res);
    countUse();
    next();
  };
  defineRoute(router, {
    method: 'post',
    path: '/',
    summary: legacy
      ? 'Webhook de projetos do ComercialAPP (caminho antigo, descontinuado: use /api/webhooks/v1/projects)'
      : 'Webhook de projetos do ComercialAPP (v1): cria ou atualiza o projeto a partir da proposta',
    auth: 'apiToken',
    tags: ['integracoes'],
    body: libValidatedBodySchema,
    validateInput: 'handler',
    validatedBy: 'lib/projects/project-intake.js (receiveProjectIntake)',
    responses: { 200: jsonResponseSchema, 201: jsonResponseSchema },
    errors: [400, 401, 409, 429, 503],
    ...(legacy ? { deprecated: true } : {})
  }, ...(legacy ? [markLegacy] : []), projectIntakeRateLimit, requireProjectIntakeToken, asyncHandler(receive));
  return router;
}

export const legacyProjectIntakeWebhookRouter = createProjectIntakeWebhookRouter({ legacy: true });
export default createProjectIntakeWebhookRouter();
