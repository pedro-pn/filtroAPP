import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import prisma from '../../lib/prisma.js';
import { syncRomaneioCatalog } from '../../lib/romaneio-catalog.js';
import { requireAuth, requireInternalUser, requireManager } from '../../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const dateField = z.string().min(1);

const schema = z.object({
  code: z.string().trim().min(1),
  serialNumber: z.string().trim().min(1),
  category: z.string().trim().min(1).default('CONTADOR DE PARTICULAS'),
  calibratedAt: dateField,
  expiresAt: dateField
});

const categoryRenameSchema = z.object({
  currentName: z.string().trim().min(1),
  newName: z.string().trim().min(1)
});

router.get('/', requireInternalUser, asyncHandler(async (_req, res) => {
  const items = await prisma.particleCounter.findMany({ orderBy: [{ category: 'asc' }, { code: 'asc' }] });
  res.json(items);
}));

router.post('/', requireManager, asyncHandler(async (req, res) => {
  const data = schema.parse(req.body);
  const existing = await prisma.particleCounter.findUnique({ where: { code: data.code } });
  if (existing && !existing.isActive) {
    const item = await prisma.particleCounter.update({
      where: { id: existing.id },
      data: { ...data, isActive: true, calibratedAt: new Date(data.calibratedAt), expiresAt: new Date(data.expiresAt) }
    });
    await syncRomaneioCatalog();
    return res.status(200).json(item);
  }
  const item = await prisma.particleCounter.create({
    data: { ...data, calibratedAt: new Date(data.calibratedAt), expiresAt: new Date(data.expiresAt) }
  });
  await syncRomaneioCatalog();
  res.status(201).json(item);
}));

router.put('/categories/rename', requireManager, asyncHandler(async (req, res) => {
  const data = categoryRenameSchema.parse(req.body);
  const update = await prisma.particleCounter.updateMany({
    where: { category: data.currentName },
    data: { category: data.newName }
  });
  await syncRomaneioCatalog();
  res.json({ category: data.newName, updatedCount: update.count });
}));

router.put('/:id', requireManager, asyncHandler(async (req, res) => {
  const data = schema.partial().parse(req.body);
  const payload = {
    ...data,
    ...(data.calibratedAt ? { calibratedAt: new Date(data.calibratedAt) } : {}),
    ...(data.expiresAt ? { expiresAt: new Date(data.expiresAt) } : {})
  };
  const item = await prisma.particleCounter.update({ where: { id: req.params.id }, data: payload });
  await syncRomaneioCatalog();
  res.json(item);
}));

router.delete('/:id', requireManager, asyncHandler(async (req, res) => {
  await prisma.particleCounter.update({ where: { id: req.params.id }, data: { isActive: false } });
  await syncRomaneioCatalog();
  res.status(204).end();
}));

export default router;
