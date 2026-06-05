import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import prisma from '../../lib/prisma.js';
import { equipmentCache } from '../../lib/resource-list-cache.js';
import { requireAuth, requireInternalUser, requireManager } from '../../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const schema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  serviceTags: z.array(z.string()).default([])
});

router.get('/', requireInternalUser, asyncHandler(async (_req, res) => {
  const items = await equipmentCache.get(() => prisma.equipment.findMany({ orderBy: { name: 'asc' } }));
  res.json(items);
}));

router.post('/', requireManager, asyncHandler(async (req, res) => {
  const data = schema.parse(req.body);
  const existing = await prisma.equipment.findUnique({ where: { code: data.code } });
  if (existing && !existing.isActive) {
    const item = await prisma.equipment.update({ where: { id: existing.id }, data: { ...data, isActive: true } });
    equipmentCache.clear();
    return res.status(200).json(item);
  }
  const item = await prisma.equipment.create({ data });
  equipmentCache.clear();
  res.status(201).json(item);
}));

router.put('/:id', requireManager, asyncHandler(async (req, res) => {
  const data = schema.partial().parse(req.body);
  const item = await prisma.equipment.update({ where: { id: req.params.id }, data });
  equipmentCache.clear();
  res.json(item);
}));

router.delete('/:id', requireManager, asyncHandler(async (req, res) => {
  await prisma.equipment.update({ where: { id: req.params.id }, data: { isActive: false } });
  equipmentCache.clear();
  res.status(204).end();
}));

export default router;
