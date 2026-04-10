import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import prisma from '../../lib/prisma.js';

const router = Router();

const schema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  serviceTags: z.array(z.string()).default([])
});

router.get('/', asyncHandler(async (_req, res) => {
  const items = await prisma.equipment.findMany({ orderBy: { name: 'asc' } });
  res.json(items);
}));

router.post('/', asyncHandler(async (req, res) => {
  const data = schema.parse(req.body);
  const item = await prisma.equipment.create({ data });
  res.status(201).json(item);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const data = schema.partial().parse(req.body);
  const item = await prisma.equipment.update({ where: { id: req.params.id }, data });
  res.json(item);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await prisma.equipment.delete({ where: { id: req.params.id } });
  res.status(204).end();
}));

export default router;
