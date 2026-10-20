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
  return items.filter(item => !item.project?.deletedAt && isRdoDraftPayload(item.payload));
}

function normalizeDraftPayload(data) {
  return {
    ...(data.payload && typeof data.payload === 'object' && !Array.isArray(data.payload) ? data.payload : {}),
    __module: RDO_DRAFT_MODULE,
    projectId: data.projectId || null,
    reportDate: data.reportDate || null
  };
}

export async function saveRdoDraft(database, userId, data, draftId = null, userRole = 'COLLABORATOR') {
  return database.$transaction(async tx => {
    // A trava de transação funciona também entre processos/instâncias da API.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`rdo-drafts:${userId}`}))`;
    const payload = normalizeDraftPayload(data);
    let current = null;
    if (draftId) {
      current = await tx.reportDraft.findUniqueOrThrow({ where: { id: draftId } });
      if (current.userId !== userId || !isRdoDraftPayload(current.payload)) {
        throw Object.assign(new Error('Você não tem permissão para alterar este rascunho.'), { statusCode: 403 });
      }
    } else if (data.projectId && data.reportDate) {
      const drafts = await tx.reportDraft.findMany({
        where: { userId, projectId: data.projectId, reportDate: data.reportDate },
        select: { id: true, payload: true },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }]
      });
      current = drafts.find(draft => isRdoDraftPayload(draft.payload)
        && (draft.payload?.serviceOnly === true) === (payload.serviceOnly === true)) || null;
    }
    if (userRole === 'COLLABORATOR') {
      // Check both ends so changing/removing the project cannot rewrite an
      // existing draft after its project has been archived.
      const projectIds = new Set([current?.projectId || current?.payload?.projectId, data.projectId].filter(Boolean));
      for (const projectId of projectIds) {
        const project = await tx.project.findUnique({ where: { id: projectId }, select: { isActive: true, deletedAt: true } });
        if (!project || project.deletedAt) {
          throw Object.assign(new Error('Projeto não encontrado.'), { statusCode: 404 });
        }
        if (!project.isActive) {
          throw Object.assign(new Error('Projeto arquivado: você pode apenas visualizar os relatórios existentes.'), {
            statusCode: 403, code: 'PROJECT_ARCHIVED_READ_ONLY'
          });
        }
      }
    }
    const values = {
      projectId: data.projectId || null,
      title: data.title || null,
      reportDate: data.reportDate || null,
      payload
    };
    const item = current
      ? await tx.reportDraft.update({ where: { id: current.id }, data: values, include: { project: true } })
      : await tx.reportDraft.create({ data: { ...values, userId }, include: { project: true } });
    return { item, created: !current };
  });
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
  const { item, created } = await saveRdoDraft(prisma, req.auth.user.id, data, null, req.auth.user.role);
  res.status(created ? 201 : 200).json(item);
}));

router.put('/:id', requireAuth, requireRdoInternal, asyncHandler(async (req, res) => {
  const data = schema.omit({ id: true }).parse(req.body);
  const { item } = await saveRdoDraft(prisma, req.auth.user.id, data, req.params.id, req.auth.user.role);
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
