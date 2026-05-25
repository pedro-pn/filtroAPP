import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import prisma from '../../lib/prisma.js';
import { syncRomaneioCatalog } from '../../lib/romaneio-catalog.js';
import { requireAuth, requireInternalUser, requireManager } from '../../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const schema = z.object({
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  category: z.string().trim().min(1)
});

const categoryRenameSchema = z.object({
  currentName: z.string().trim().min(1),
  newName: z.string().trim().min(1)
});

router.get('/', requireInternalUser, asyncHandler(async (_req, res) => {
  const items = await prisma.unit.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }, { code: 'asc' }] });
  res.json(items);
}));

router.get('/categories', requireManager, asyncHandler(async (_req, res) => {
  const [unitCategories, romaneioCategories] = await Promise.all([
    prisma.unit.findMany({
      distinct: ['category'],
      select: { category: true },
      orderBy: { category: 'asc' }
    }),
    prisma.romaneioCatalogItem.findMany({
      distinct: ['categoryName'],
      where: { isActive: true },
      select: { categoryName: true },
      orderBy: { categoryName: 'asc' }
    })
  ]);

  const categories = Array.from(new Set([
    ...unitCategories.map(item => item.category),
    ...romaneioCategories.map(item => item.categoryName)
  ].map(item => String(item || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));

  res.json(categories);
}));

router.post('/', requireManager, asyncHandler(async (req, res) => {
  const data = schema.parse(req.body);
  const item = await prisma.unit.create({ data });
  await syncRomaneioCatalog();
  res.status(201).json(item);
}));

router.put('/categories/rename', requireManager, asyncHandler(async (req, res) => {
  const data = categoryRenameSchema.parse(req.body);
  const update = await prisma.unit.updateMany({
    where: { category: data.currentName },
    data: { category: data.newName }
  });
  await syncRomaneioCatalog();
  res.json({ category: data.newName, updatedCount: update.count });
}));

router.put('/:id', requireManager, asyncHandler(async (req, res) => {
  const data = schema.partial().parse(req.body);
  const item = await prisma.unit.update({ where: { id: req.params.id }, data });
  await syncRomaneioCatalog();
  res.json(item);
}));

router.delete('/:id', requireManager, asyncHandler(async (req, res) => {
  await prisma.unit.delete({ where: { id: req.params.id } });
  res.status(204).end();
}));

export default router;
