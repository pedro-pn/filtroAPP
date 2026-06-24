import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import prisma from '../../lib/prisma.js';
import { RDO_INTERNAL_ROLES, requireAuth, requireManager, requireModuleRole } from '../../middleware/auth.js';

const router = Router();
const requireRdoInternal = requireModuleRole(...RDO_INTERNAL_ROLES);

const schema = z.object({
  name: z.string().min(1),
  order: z.number().int().optional(),
  isActive: z.boolean().optional()
});

router.get('/', requireAuth, requireRdoInternal, asyncHandler(async (req, res) => {
  const includeInactive = req.query.all === 'true';
  const items = await prisma.jobRole.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [{ order: 'asc' }, { name: 'asc' }]
  });
  res.json(items);
}));

router.post('/', requireAuth, requireRdoInternal, requireManager, asyncHandler(async (req, res) => {
  const data = schema.parse(req.body);
  const item = await prisma.jobRole.create({
    data: { name: data.name.trim(), order: data.order ?? 0, isActive: data.isActive ?? true }
  });
  res.status(201).json(item);
}));

router.patch('/:id', requireAuth, requireRdoInternal, requireManager, asyncHandler(async (req, res) => {
  const data = schema.partial().parse(req.body);
  const item = await prisma.jobRole.update({
    where: { id: req.params.id },
    data: {
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.order !== undefined ? { order: data.order } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {})
    }
  });
  res.json(item);
}));

router.delete('/:id', requireAuth, requireRdoInternal, requireManager, asyncHandler(async (req, res) => {
  await prisma.jobRole.update({ where: { id: req.params.id }, data: { isActive: false } });
  res.status(204).end();
}));

export default router;
