import { Router } from 'express';

import asyncHandler from '../../lib/async-handler.js';
import prisma from '../../lib/prisma.js';
import { seedInhibitionOptions } from '../../lib/inhibition-options.js';
import { RDO_ACCESS_ROLES, requireAuth, requireModuleRole } from '../../middleware/auth.js';

const router = Router();
const requireRdoAccess = requireModuleRole(...RDO_ACCESS_ROLES);

router.use(requireAuth, requireRdoAccess);

router.get('/', asyncHandler(async (_req, res) => {
  await seedInhibitionOptions(prisma);
  const [vessels, systems] = await Promise.all([
    prisma.inhibitionVessel.findMany({
      where: { isActive: true },
      orderBy: [{ order: 'asc' }, { code: 'asc' }]
    }),
    prisma.inhibitionSystem.findMany({
      where: { isActive: true },
      orderBy: [{ order: 'asc' }, { code: 'asc' }]
    })
  ]);
  res.json({ vessels, systems });
}));

export default router;
