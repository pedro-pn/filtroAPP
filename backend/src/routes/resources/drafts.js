import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import prisma from '../../lib/prisma.js';
import { RDO_INTERNAL_ROLES, requireAuth, requireModuleRole } from '../../middleware/auth.js';

const router = Router();
const requireRdoInternal = requireModuleRole(...RDO_INTERNAL_ROLES);
const RDO_DRAFT_MODULE = 'rdo';
const ROMANEIO_DRAFT_MODULE = 'romaneio';

const schema = z.object({
  id: z.string().optional(),
  projectId: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  reportDate: z.string().nullable().optional(),
  payload: z.any()
});

export function isRdoDraftPayload(payload) {
  return !payload || typeof payload !== 'object' || payload.__module !== ROMANEIO_DRAFT_MODULE;
}

export function rdoDraftItems(items) {
  return items.filter(item => isRdoDraftPayload(item.payload));
}

function normalizeDraftPayload(data) {
  return {
    ...(data.payload && typeof data.payload === 'object' && !Array.isArray(data.payload) ? data.payload : {}),
    __module: RDO_DRAFT_MODULE,
    projectId: data.projectId || null,
    reportDate: data.reportDate || null
  };
}

async function deleteRdoDrafts(where) {
  const drafts = await prisma.reportDraft.findMany({
    where,
    select: { id: true, payload: true }
  });
  const ids = rdoDraftItems(drafts).map(item => item.id);
  if (!ids.length) return;
  await prisma.reportDraft.deleteMany({ where: { id: { in: ids } } });
}

router.get('/', requireAuth, requireRdoInternal, asyncHandler(async (req, res) => {
  const items = await prisma.reportDraft.findMany({
    where: { userId: req.auth.user.id },
    include: { project: true },
    orderBy: { updatedAt: 'desc' }
  });
  res.json(rdoDraftItems(items));
}));

router.post('/', requireAuth, requireRdoInternal, asyncHandler(async (req, res) => {
  const data = schema.parse(req.body);
  const payload = normalizeDraftPayload(data);
  if (data.projectId && data.reportDate) {
    await deleteRdoDrafts({
      userId: req.auth.user.id,
      projectId: data.projectId,
      reportDate: data.reportDate
    });
  }
  const item = await prisma.reportDraft.create({
    data: {
      userId: req.auth.user.id,
      projectId: data.projectId || null,
      title: data.title || null,
      reportDate: data.reportDate || null,
      payload
    },
    include: { project: true }
  });
  res.status(201).json(item);
}));

router.put('/:id', requireAuth, requireRdoInternal, asyncHandler(async (req, res) => {
  const data = schema.omit({ id: true }).parse(req.body);
  const current = await prisma.reportDraft.findUniqueOrThrow({ where: { id: req.params.id } });
  if (current.userId !== req.auth.user.id || !isRdoDraftPayload(current.payload)) {
    return res.status(403).json({ error: 'Você não tem permissão para alterar este rascunho.' });
  }
  const payload = normalizeDraftPayload(data);
  if (data.projectId && data.reportDate) {
    await deleteRdoDrafts({
      userId: req.auth.user.id,
      projectId: data.projectId,
      reportDate: data.reportDate,
      id: { not: req.params.id }
    });
  }
  const item = await prisma.reportDraft.update({
    where: { id: req.params.id },
    data: {
      projectId: data.projectId || null,
      title: data.title || null,
      reportDate: data.reportDate || null,
      payload
    },
    include: { project: true }
  });
  res.json(item);
}));

router.delete('/:id', requireAuth, requireRdoInternal, asyncHandler(async (req, res) => {
  const current = await prisma.reportDraft.findUniqueOrThrow({ where: { id: req.params.id } });
  if (current.userId !== req.auth.user.id || !isRdoDraftPayload(current.payload)) {
    return res.status(403).json({ error: 'Você não tem permissão para excluir este rascunho.' });
  }
  await prisma.reportDraft.delete({ where: { id: req.params.id } });
  res.status(204).end();
}));

export default router;
