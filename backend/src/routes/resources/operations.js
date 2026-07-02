import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import { captureOperationalError, errorTrackingStatus } from '../../lib/operations/error-tracking.js';
import { getOperationalStatus } from '../../lib/operations/status.js';
import { createMemoryRateLimit } from '../../lib/rate-limit.js';
import { requireAuth, requireHubAdmin } from '../../middleware/auth.js';

const router = Router();
const clientErrorLimiter = createMemoryRateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: 'Muitas notificações de erro. Tente novamente mais tarde.'
});

const clientErrorSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  name: z.string().trim().max(120).optional().nullable(),
  stack: z.string().trim().max(8000).optional().nullable(),
  source: z.string().trim().max(120).optional().nullable(),
  url: z.string().trim().max(1000).optional().nullable(),
  userAgent: z.string().trim().max(1000).optional().nullable(),
  context: z.record(z.string(), z.unknown()).optional().nullable()
}).passthrough();

router.post('/client-errors', clientErrorLimiter, asyncHandler(async (req, res) => {
  const data = clientErrorSchema.parse(req.body || {});
  const error = new Error(data.message);
  error.name = data.name || 'ClientError';
  if (data.stack) error.stack = data.stack;

  const result = await captureOperationalError(error, {
    source: data.source || 'frontend',
    context: {
      url: data.url || null,
      userAgent: data.userAgent || req.headers['user-agent'] || null,
      ...data.context
    }
  });

  res.status(202).json({
    accepted: true,
    tracking: errorTrackingStatus(),
    sent: result.sent === true
  });
}));

router.use(requireAuth, requireHubAdmin);

router.get('/status', asyncHandler(async (_req, res) => {
  res.json(await getOperationalStatus());
}));

export default router;
