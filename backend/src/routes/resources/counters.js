import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import prisma from '../../lib/prisma.js';

const router = Router();

const dateField = z.string().min(1);

const schema = z.object({
  code: z.string().min(1),
  serialNumber: z.string().min(1),
  calibratedAt: dateField,
  expiresAt: dateField
});

router.get('/', asyncHandler(async (_req, res) => {
  const items = await prisma.particleCounter.findMany({ orderBy: { code: 'asc' } });
  res.json(items);
}));

router.post('/', asyncHandler(async (req, res) => {
  const data = schema.parse(req.body);
  const item = await prisma.particleCounter.create({
    data: {
      ...data,
      calibratedAt: new Date(data.calibratedAt),
      expiresAt: new Date(data.expiresAt)
    }
  });
  res.status(201).json(item);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const data = schema.partial().parse(req.body);
  const payload = {
    ...data,
    ...(data.calibratedAt ? { calibratedAt: new Date(data.calibratedAt) } : {}),
    ...(data.expiresAt ? { expiresAt: new Date(data.expiresAt) } : {})
  };
  const item = await prisma.particleCounter.update({ where: { id: req.params.id }, data: payload });
  res.json(item);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await prisma.particleCounter.delete({ where: { id: req.params.id } });
  res.status(204).end();
}));

export default router;
