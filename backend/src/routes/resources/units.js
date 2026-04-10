import { Router } from 'express';
import { UnitCategory } from '@prisma/client';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import prisma from '../../lib/prisma.js';

const router = Router();

const schema = z.object({
  code: z.string().min(1),
  category: z.nativeEnum(UnitCategory)
});

router.get('/', asyncHandler(async (_req, res) => {
  const items = await prisma.unit.findMany({ orderBy: [{ category: 'asc' }, { code: 'asc' }] });
  res.json(items);
}));

router.post('/', asyncHandler(async (req, res) => {
  const data = schema.parse(req.body);
  const item = await prisma.unit.create({ data });
  res.status(201).json(item);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const data = schema.partial().parse(req.body);
  const item = await prisma.unit.update({ where: { id: req.params.id }, data });
  res.json(item);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await prisma.unit.delete({ where: { id: req.params.id } });
  res.status(204).end();
}));

export default router;
