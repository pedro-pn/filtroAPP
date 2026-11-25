import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import prisma from '../../lib/prisma.js';
import { equipmentCache } from '../../lib/resource-list-cache.js';
import { requireAuth, requireInternalUser, requireManager } from '../../middleware/auth.js';

import { defineRoute } from '../../lib/api-contract/registry.js';
import { opsRoute, EMPTY, jsonResponseSchema, libValidatedBodySchema } from '../../lib/api-contract/domains/operacoes.js';
const router = Router();
router.use(requireAuth);

const schema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  serviceTags: z.array(z.string()).default([])
});

defineRoute(router, opsRoute('GET /', { tag: 'inventario-rdo', summary: 'Equipamentos do RDO: Listar registros', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), requireInternalUser, asyncHandler(async (_req, res) => {
  const items = await equipmentCache.get(() => prisma.equipment.findMany({ orderBy: { name: 'asc' } }));
  res.json(items);
}));

defineRoute(router, opsRoute('POST /', { tag: 'inventario-rdo', summary: 'Equipamentos do RDO: Criar registro', body: schema, responses: { 201: jsonResponseSchema }, errors: [400, 401, 403] }), requireManager, asyncHandler(async (req, res) => {
  const data = schema.parse(req.body);
  const existing = await prisma.equipment.findUnique({ where: { code: data.code } });
  if (existing && !existing.isActive) {
    const item = await prisma.equipment.update({ where: { id: existing.id }, data: { ...data, isActive: true } });
    equipmentCache.clear();
    return res.status(200).json(item);
  }
  const item = await prisma.equipment.create({ data });
  equipmentCache.clear();
  res.status(201).json(item);
}));

defineRoute(router, opsRoute('PUT /:id', { tag: 'inventario-rdo', summary: 'Equipamentos do RDO: Atualizar registro (por id)', body: libValidatedBodySchema, validatedBy: 'handler/serviço (corpo conferido fora do contrato)', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), requireManager, asyncHandler(async (req, res) => {
  const data = schema.partial().parse(req.body);
  const item = await prisma.equipment.update({ where: { id: req.params.id }, data });
  equipmentCache.clear();
  res.json(item);
}));

defineRoute(router, opsRoute('DELETE /:id', { tag: 'inventario-rdo', summary: 'Equipamentos do RDO: Excluir registro (por id)', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 204: EMPTY }, errors: [401, 403] }), requireManager, asyncHandler(async (req, res) => {
  await prisma.equipment.update({ where: { id: req.params.id }, data: { isActive: false } });
  equipmentCache.clear();
  res.status(204).end();
}));

export default router;
