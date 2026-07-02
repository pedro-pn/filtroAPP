import { Router } from 'express';

import asyncHandler from '../../lib/async-handler.js';
import { getOperationalStatus } from '../../lib/operations/status.js';
import { requireAuth, requireHubAdmin } from '../../middleware/auth.js';

const router = Router();

router.use(requireAuth, requireHubAdmin);

router.get('/status', asyncHandler(async (_req, res) => {
  res.json(await getOperationalStatus());
}));

export default router;
