import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import prisma from '../../lib/prisma.js';
import { requireAuth, requireManager } from '../../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const segmentSchema = z.object({
  label: z.string().trim().min(1),
  slug: z.string().trim().min(1).optional(),
  order: z.coerce.number().int().nonnegative().optional()
});

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

router.get('/', asyncHandler(async (_req, res) => {
  const items = await prisma.clientSegment.findMany({
    where: { isActive: true },
    orderBy: [{ order: 'asc' }, { label: 'asc' }]
  });
  res.json(items);
}));

router.post('/', requireManager, asyncHandler(async (req, res) => {
  const data = segmentSchema.parse(req.body);
  const slug = slugify(data.slug || data.label);
  if (!slug) return res.status(400).json({ error: 'Slug inválido.' });

  const existing = await prisma.clientSegment.findUnique({ where: { slug } });
  if (existing) {
    const item = await prisma.clientSegment.update({
      where: { id: existing.id },
      data: {
        label: data.label,
        isActive: true,
        ...(data.order !== undefined ? { order: data.order } : {})
      }
    });
    return res.status(200).json(item);
  }

  const item = await prisma.clientSegment.create({
    data: {
      label: data.label,
      slug,
      order: data.order ?? 0
    }
  });
  res.status(201).json(item);
}));

export default router;
