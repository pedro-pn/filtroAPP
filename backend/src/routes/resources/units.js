import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import prisma from '../../lib/prisma.js';
import { requireAuth, requireInternalUser, requireManager } from '../../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const schema = z.object({
  code: z.string().trim().min(1),
  category: z.string().trim().min(1)
});

router.get('/', requireInternalUser, asyncHandler(async (_req, res) => {
  const items = await prisma.unit.findMany({ orderBy: [{ category: 'asc' }, { code: 'asc' }] });
  res.json(items);
}));

router.post('/', requireManager, asyncHandler(async (req, res) => {
  const data = schema.parse(req.body);
  const item = await prisma.unit.create({ data });
  res.status(201).json(item);
}));

router.put('/:id', requireManager, asyncHandler(async (req, res) => {
  const data = schema.partial().parse(req.body);
  const item = await prisma.unit.update({ where: { id: req.params.id }, data });
  res.json(item);
}));

router.delete('/:id', requireManager, asyncHandler(async (req, res) => {
  await prisma.unit.delete({ where: { id: req.params.id } });
  res.status(204).end();
}));

export default router;
