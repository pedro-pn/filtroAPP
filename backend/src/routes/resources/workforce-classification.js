import { Router } from 'express';
import { z } from 'zod';
import asyncHandler from '../../lib/async-handler.js';
import prisma from '../../lib/prisma.js';
import { requireAuth, requireHubAdmin } from '../../middleware/auth.js';
import { listWorkforce, updateWorkforceBatch, updateWorkforceRole } from '../../lib/collaborators/workforce-classification.js';
import { getWorkforceVisibility, updateWorkforceVisibility } from '../../lib/collaborators/workforce-visibility.js';
import { withCurrentJobRole } from '../../lib/collaborators/job-role-service.js';

export function createWorkforceClassificationRouter({ database = prisma } = {}) {
  const router = Router();
  router.use(requireAuth, requireHubAdmin);
  router.get('/visibility', asyncHandler(async (_req, res) => { res.json(await getWorkforceVisibility(database)); }));
  router.put('/visibility', asyncHandler(async (req, res) => { res.json(await updateWorkforceVisibility(database, req.body, req.auth.user.id)); }));
  // Administration must be able to link accounts and review all classifications.
  router.get('/collaborator-options', asyncHandler(async (_req, res) => {
    const items = await database.collaborator.findMany({ orderBy: { name: 'asc' }, select: {
      id: true, code: true, name: true, jobRoleId: true, isActive: true, jobRole: { select: { id: true, name: true } }
    } });
    res.json(items.map(withCurrentJobRole));
  }));
  router.get('/collaborators', asyncHandler(async (req, res) => { res.json(await listWorkforce(database, req.query)); }));
  router.patch('/collaborators', asyncHandler(async (req, res) => { res.json(await updateWorkforceBatch(database, req.body, req.auth.user.id)); }));
  router.get('/job-roles', asyncHandler(async (_req, res) => {
    res.json(await database.jobRole.findMany({ orderBy: { name: 'asc' }, select: {
      id: true, name: true, isActive: true, isOperational: true, workforceClassification: true,
      sourceIsOperational: true, classificationManagedLocally: true, classificationVersion: true,
      _count: { select: { collaborators: true } }
    } }));
  }));
  router.patch('/job-roles/:id', asyncHandler(async (req, res) => { res.json(await updateWorkforceRole(database, req.params.id, req.body, req.auth.user.id)); }));
  router.get('/history', asyncHandler(async (req, res) => {
    const query = z.object({ entityType: z.enum(['COLLABORATOR', 'JOB_ROLE', 'VISIBILITY']), entityId: z.string().min(1).max(100) }).strict().parse(req.query);
    const events = await database.workforceClassificationEvent.findMany({ where: query, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 });
    const actorIds = [...new Set(events.map(event => event.actorUserId).filter(Boolean))];
    const actors = actorIds.length ? await database.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [];
    const names = new Map(actors.map(actor => [actor.id, actor.name]));
    res.json(events.map(event => ({ ...event, actorName: event.actorUserId ? names.get(event.actorUserId) || 'Conta removida' : 'Migração / sistema' })));
  }));
  return router;
}

export default createWorkforceClassificationRouter();
