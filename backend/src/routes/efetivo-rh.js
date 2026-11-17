import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import env from '../config/env.js';
import asyncHandler from '../lib/async-handler.js';
import { requireEfetivoViewer } from '../lib/efetivo/access.js';
import { getConectaComplianceBatch, resolveConectaEvidence } from '../lib/conecta-rh/compliance.js';

const id = z.string().trim().min(1).max(80);
const query = z.object({
  ids: z.string().max(8_100).transform(value => value.split(',')).pipe(z.array(id).min(1).max(100)),
  date: z.iso.date(), endDate: z.iso.date().optional()
}).strict().refine(value => !value.endDate || value.endDate >= value.date, { path: ['endDate'], message: 'O fim do período deve ser igual ou posterior à mobilização.' });

export function createEfetivoRhRouter({ database = prisma, config = env, fetchImpl = fetch } = {}) {
  const router = Router();
  router.use(requireEfetivoViewer);
  router.get('/rh', asyncHandler(async (req, res) => {
    const { ids, date, endDate } = query.parse(req.query);
    const result = await getConectaComplianceBatch(database, { collaboratorIds: ids, date, endDate }, { companyId: config.conectaRhCompanyId });
    res.setHeader('Cache-Control', 'no-store');
    res.json(result);
  }));
  router.get('/:collaboratorId/rh/:itemId/evidence', asyncHandler(async (req, res) => {
    const { collaboratorId, itemId } = z.object({ collaboratorId: id, itemId: z.uuid() }).parse(req.params);
    const { revision } = z.object({ revision: z.coerce.number().int().positive() }).strict().parse(req.query);
    const result = await resolveConectaEvidence(database, { collaboratorId, itemId, revision }, { config, fetchImpl });
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.json(result);
  }));
  return router;
}
