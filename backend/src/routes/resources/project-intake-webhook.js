import { createHash, timingSafeEqual } from 'node:crypto';

import { Router } from 'express';

import env from '../../config/env.js';
import asyncHandler from '../../lib/async-handler.js';
import { ProjectIntakeConflictError, receiveProjectIntake } from '../../lib/projects/project-intake.js';
import { createMemoryRateLimit } from '../../lib/rate-limit.js';

const router = Router();
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

router.post('/', projectIntakeRateLimit, requireProjectIntakeToken, asyncHandler(async (req, res) => {
  try {
    const result = await receiveProjectIntake(req.body);
    return res.status(result.status === 'created' ? 201 : 200).json(result);
  } catch (error) {
    if (error instanceof ProjectIntakeConflictError) {
      return res.status(409).json({ error: error.message, code: error.code });
    }
    throw error;
  }
}));

export default router;
