import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import prisma from '../../lib/prisma.js';
import { RDO_INTERNAL_ROLES, requireAuth, requireModuleRole } from '../../middleware/auth.js';

const router = Router();
const requireRdoInternal = requireModuleRole(...RDO_INTERNAL_ROLES);

const schema = z.object({
  id: z.string().optional(),
  projectId: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  reportDate: z.string().nullable().optional(),
  payload: z.any()
});

function rdoDraftWhere(userId) {
  return {
    userId,
    NOT: {
      payload: {
        path: ['__module'],
        equals: 'romaneio'
      }
    }
  };
}

router.get('/', requireAuth, requireRdoInternal, asyncHandler(async (req, res) => {
  const items = await prisma.reportDraft.findMany({
    where: rdoDraftWhere(req.auth.user.id),
    include: { project: true },
    orderBy: { updatedAt: 'desc' }
  });
  res.json(items);
}));

router.post('/', requireAuth, requireRdoInternal, asyncHandler(async (req, res) => {
  const data = schema.parse(req.body);
  if (data.projectId && data.reportDate) {
    await prisma.reportDraft.deleteMany({
      where: {
        ...rdoDraftWhere(req.auth.user.id),
        projectId: data.projectId,
        reportDate: data.reportDate
      }
    });
  }
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

router.put('/:id', requireAuth, requireRdoInternal, asyncHandler(async (req, res) => {
  const data = schema.omit({ id: true }).parse(req.body);
  const current = await prisma.reportDraft.findUniqueOrThrow({ where: { id: req.params.id } });
  if (current.userId !== req.auth.user.id || current.payload?.__module === 'romaneio') {
    return res.status(403).json({ error: 'Você não tem permissão para alterar este rascunho.' });
  }
  if (data.projectId && data.reportDate) {
    await prisma.reportDraft.deleteMany({
      where: {
        ...rdoDraftWhere(req.auth.user.id),
        projectId: data.projectId,
        reportDate: data.reportDate,
        id: { not: req.params.id }
      }
    });
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

router.delete('/:id', requireAuth, requireRdoInternal, asyncHandler(async (req, res) => {
  const current = await prisma.reportDraft.findUniqueOrThrow({ where: { id: req.params.id } });
  if (current.userId !== req.auth.user.id || current.payload?.__module === 'romaneio') {
    return res.status(403).json({ error: 'Você não tem permissão para excluir este rascunho.' });
  }
  await prisma.reportDraft.delete({ where: { id: req.params.id } });
  res.status(204).end();
}));

export default router;
