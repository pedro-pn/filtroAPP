import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import { getCollaboratorProductivityReport } from '../../lib/acompanhamento/collaborator-productivity.js';
import { requireAcompanhamentoManager, requireAuth } from '../../middleware/auth.js';

const router = Router();

const optionalBooleanSchema = z.preprocess(value => {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return value;
}, z.boolean().optional());

const querySchema = z.object({
  year: z.preprocess(value => {
    if (value === undefined || value === null || value === '') return undefined;
    return Number(value);
  }, z.number().int().min(2000).max(2100).optional()),
  q: z.string().trim().max(100).optional(),
  disponivel: optionalBooleanSchema
});

export function parseCollaboratorsQuery(query, now = new Date()) {
  const parsed = querySchema.parse(query);
  return {
    year: parsed.year ?? now.getFullYear(),
    q: parsed.q || undefined,
    disponivel: parsed.disponivel
  };
}

router.get('/', requireAuth, requireAcompanhamentoManager, asyncHandler(async (req, res) => {
  const params = parseCollaboratorsQuery(req.query);
  res.json(await getCollaboratorProductivityReport(params));
}));

export default router;
