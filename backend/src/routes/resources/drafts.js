import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import prisma from '../../lib/prisma.js';
import { requireAuth } from '../../middleware/auth.js';

const router = Router();

const schema = z.object({
  id: z.string().optional(),
  projectId: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  reportDate: z.string().nullable().optional(),
  payload: z.any()
});

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const items = await prisma.reportDraft.findMany({
    where: { userId: req.auth.user.id },
    include: { project: true },
    orderBy: { updatedAt: 'desc' }
  });
  res.json(items);
}));

router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const data = schema.parse(req.body);
  const item = await prisma.reportDraft.create({
    data: {
      userId: req.auth.user.id,
      projectId: data.projectId || null,
      title: data.title || null,
      reportDate: data.reportDate || null,
      payload: data.payload || {}
    },
    include: { project: true }
  });
  res.status(201).json(item);
}));

router.put('/:id', requireAuth, asyncHandler(async (req, res) => {
  const data = schema.omit({ id: true }).parse(req.body);
  const current = await prisma.reportDraft.findUniqueOrThrow({ where: { id: req.params.id } });
  if (current.userId !== req.auth.user.id) {
    return res.status(403).json({ error: 'Voce nao tem permissao para alterar este rascunho.' });
  }
  const item = await prisma.reportDraft.update({
    where: { id: req.params.id },
    data: {
      projectId: data.projectId || null,
      title: data.title || null,
      reportDate: data.reportDate || null,
      payload: data.payload || {}
    },
    include: { project: true }
  });
  res.json(item);
}));

router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  const current = await prisma.reportDraft.findUniqueOrThrow({ where: { id: req.params.id } });
  if (current.userId !== req.auth.user.id) {
    return res.status(403).json({ error: 'Voce nao tem permissao para excluir este rascunho.' });
  }
  await prisma.reportDraft.delete({ where: { id: req.params.id } });
  res.status(204).end();
}));

export default router;
