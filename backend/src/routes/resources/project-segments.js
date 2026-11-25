import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import prisma from '../../lib/prisma.js';
import { RDO_INTERNAL_ROLES, requireAuth, requireManager, requireModuleRole } from '../../middleware/auth.js';

import { defineRoute } from '../../lib/api-contract/registry.js';
import { opsRoute, jsonResponseSchema } from '../../lib/api-contract/domains/operacoes.js';
const router = Router();
const requireRdoInternal = requireModuleRole(...RDO_INTERNAL_ROLES);

const schema = z.object({
  label: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9_]+$/),
  isActive: z.boolean().default(true),
  order: z.number().int().default(0)
});

defineRoute(router, opsRoute('GET /', { tag: 'cadastros-rdo', summary: 'Segmentos de projeto: Listar segmentos', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), requireAuth, requireRdoInternal, asyncHandler(async (_req, res) => {
  const items = await prisma.clientSegment.findMany({
    where: { isActive: true },
    orderBy: [{ order: 'asc' }, { label: 'asc' }]
  });
  res.json(items);
}));

defineRoute(router, opsRoute('POST /', { tag: 'cadastros-rdo', summary: 'Segmentos de projeto: Criar segmento', body: schema, responses: { 201: jsonResponseSchema }, errors: [400, 401, 403] }), requireAuth, requireRdoInternal, requireManager, asyncHandler(async (req, res) => {
  const data = schema.parse(req.body);
  const item = await prisma.clientSegment.create({ data });
  res.status(201).json(item);
}));

export default router;
