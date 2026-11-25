import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import { sortJobRolesByName } from '../../lib/job-roles/index.js';
import prisma from '../../lib/prisma.js';
import { RDO_INTERNAL_ROLES, requireAuth, requireModuleRole } from '../../middleware/auth.js';

import { defineRoute } from '../../lib/api-contract/registry.js';
import { opsRoute, EMPTY, jsonResponseSchema, libValidatedBodySchema } from '../../lib/api-contract/domains/operacoes.js';
const router = Router();
const requireRdoInternal = requireModuleRole(...RDO_INTERNAL_ROLES);
// Coordenadores também gerenciam os temas de DDS (diferente de job-roles, restrito a gestor).
const requireDdsThemeWriter = requireModuleRole('rdo:manager', 'rdo:coordinator');

const schema = z.object({
  name: z.string().min(1),
  order: z.number().int().optional(),
  isActive: z.boolean().optional()
});

defineRoute(router, opsRoute('GET /', { tag: 'cadastros-rdo', summary: 'Temas de DDS: Listar temas', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), requireAuth, requireRdoInternal, asyncHandler(async (req, res) => {
  const includeInactive = req.query.all === 'true';
  const items = await prisma.ddsTheme.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: { name: 'asc' }
  });
  res.json(sortJobRolesByName(items));
}));

defineRoute(router, opsRoute('POST /', { tag: 'cadastros-rdo', summary: 'Temas de DDS: Criar tema', body: schema, responses: { 201: jsonResponseSchema }, errors: [400, 401, 403] }), requireAuth, requireRdoInternal, requireDdsThemeWriter, asyncHandler(async (req, res) => {
  const data = schema.parse(req.body);
  const item = await prisma.ddsTheme.create({
    data: { name: data.name.trim(), order: data.order ?? 0, isActive: data.isActive ?? true }
  });
  res.status(201).json(item);
}));

defineRoute(router, opsRoute('PATCH /:id', { tag: 'cadastros-rdo', summary: 'Temas de DDS: Atualizar tema', body: libValidatedBodySchema, validatedBy: 'handler/serviço (corpo conferido fora do contrato)', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), requireAuth, requireRdoInternal, requireDdsThemeWriter, asyncHandler(async (req, res) => {
  const data = schema.partial().parse(req.body);
  const item = await prisma.ddsTheme.update({
    where: { id: req.params.id },
    data: {
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.order !== undefined ? { order: data.order } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {})
    }
  });
  res.json(item);
}));

defineRoute(router, opsRoute('DELETE /:id', { tag: 'cadastros-rdo', summary: 'Temas de DDS: Excluir tema', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 204: EMPTY }, errors: [401, 403] }), requireAuth, requireRdoInternal, requireDdsThemeWriter, asyncHandler(async (req, res) => {
  await prisma.ddsTheme.update({ where: { id: req.params.id }, data: { isActive: false } });
  res.status(204).end();
}));

export default router;
