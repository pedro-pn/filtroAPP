import { Router } from 'express';
import { z } from 'zod';
import asyncHandler from '../../lib/async-handler.js';
import prisma from '../../lib/prisma.js';
import { requireEfetivoManager, requireEfetivoViewer } from '../../lib/efetivo/access.js';
import { requestEvidence } from '../../lib/efetivo/planning/plan-context.js';
import { listReviewParticipants, participationInputSchema, updateReviewParticipation } from '../../lib/efetivo/allocation-review/participation.js';
import { defineRoute } from '../../lib/api-contract/registry.js';

const participantSchema = z.object({
  id: z.string(), code: z.string(), name: z.string(), jobRole: z.string(),
  isActive: z.boolean(), rhStatus: z.string().nullable(),
  allocationReviewEnabled: z.boolean(), version: z.number().int().positive()
});

// Montado após requireAuth no roteador do Efetivo.
export function createReviewParticipationRouter({ database = prisma } = {}) {
  const router = Router();
  router.use(requireEfetivoViewer);
  defineRoute(router, { method: 'get', path: '/', summary: 'Colaboradores operacionais e participação na conferência',
    auth: 'session', tag: 'efetivo', responses: { 200: z.array(participantSchema) }, errors: [401, 403]
  }, asyncHandler(async (_req, res) => res.json(await listReviewParticipants(database))));
  defineRoute(router, { method: 'patch', path: '/:id', summary: 'Ativar ou desativar a participação na conferência',
    auth: 'session', tag: 'efetivo', body: participationInputSchema,
    params: z.object({ id: z.string().trim().min(1).max(100) }),
    responses: { 200: participantSchema }, errors: [400, 401, 403, 404, 409]
  }, requireEfetivoManager, asyncHandler(async (req, res) => {
    const id = z.string().trim().min(1).max(100).parse(req.params.id);
    res.json(await updateReviewParticipation(database, id, req.body, {
      actorUserId: req.auth.user.id, evidence: requestEvidence(req)
    }));
  }));
  return router;
}
