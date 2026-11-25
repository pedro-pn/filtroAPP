import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import { normalizeJobRoleKey } from '../../lib/collaborators/job-role-service.js';
import { setRoleClassification } from '../../lib/collaborators/workforce-classification.js';
import { requireJobRolePatchAccess } from '../../lib/efetivo/access.js';
import { sortJobRolesByName } from '../../lib/job-roles/index.js';
import prisma from '../../lib/prisma.js';
import { clearCollaboratorDerivedCaches } from '../../lib/resource-list-cache.js';
import { RDO_INTERNAL_ROLES, requireAuth, requireManager, requireModuleRole } from '../../middleware/auth.js';

import { defineRoute } from '../../lib/api-contract/registry.js';
import { opsRoute, EMPTY, jsonResponseSchema, libValidatedBodySchema } from '../../lib/api-contract/domains/operacoes.js';
const router = Router();
const requireRdoInternal = requireModuleRole(...RDO_INTERNAL_ROLES);

const schema = z.object({
  name: z.string().min(1),
  order: z.number().int().optional(),
  isActive: z.boolean().optional(),
  isOperational: z.boolean().optional()
});

defineRoute(router, opsRoute('GET /', { tag: 'cadastros-rdo', summary: 'Cargos: Listar cargos', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), requireAuth, requireRdoInternal, asyncHandler(async (req, res) => {
  const includeInactive = req.query.all === 'true';
  const items = await prisma.jobRole.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: { name: 'asc' }
  });
  res.json(sortJobRolesByName(items));
}));

defineRoute(router, opsRoute('POST /', { tag: 'cadastros-rdo', summary: 'Cargos: Criar cargo', body: schema, responses: { 201: jsonResponseSchema }, errors: [400, 401, 403] }), requireAuth, requireRdoInternal, requireManager, asyncHandler(async (req, res) => {
  const data = schema.parse(req.body);
  const item = await prisma.jobRole.create({
    data: {
      name: data.name.trim(),
      normalizedKey: normalizeJobRoleKey(data.name),
      order: data.order ?? 0,
      isActive: data.isActive ?? true,
      isOperational: data.isOperational === true,
      workforceClassification: data.isOperational === undefined ? 'PENDING' : data.isOperational ? 'OPERATIONAL' : 'NON_OPERATIONAL',
      classificationManagedLocally: data.isOperational !== undefined
    }
  });
  clearCollaboratorDerivedCaches();
  res.status(201).json(item);
}));

defineRoute(router, opsRoute('PATCH /:id', { tag: 'cadastros-rdo', summary: 'Cargos: Atualizar cargo', body: libValidatedBodySchema, validatedBy: 'handler/serviço (corpo conferido fora do contrato)', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), requireAuth, requireRdoInternal, requireJobRolePatchAccess, asyncHandler(async (req, res) => {
  const data = schema.partial().parse(req.body);
  const write = async tx => {
    if (data.isOperational !== undefined) {
      await setRoleClassification(tx, req.params.id, data.isOperational ? 'OPERATIONAL' : 'NON_OPERATIONAL', { actorUserId: req.auth.user.id });
    }
    return tx.jobRole.update({
      where: { id: req.params.id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.name !== undefined ? { normalizedKey: normalizeJobRoleKey(data.name) } : {}),
        ...(data.order !== undefined ? { order: data.order } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {})
      }
    });
  };
  const item = data.isOperational === undefined ? await write(prisma) : await prisma.$transaction(write);
  clearCollaboratorDerivedCaches();
  res.json(item);
}));

defineRoute(router, opsRoute('DELETE /:id', { tag: 'cadastros-rdo', summary: 'Cargos: Excluir cargo', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 204: EMPTY }, errors: [401, 403] }), requireAuth, requireRdoInternal, requireManager, asyncHandler(async (req, res) => {
  await prisma.jobRole.update({ where: { id: req.params.id }, data: { isActive: false } });
  clearCollaboratorDerivedCaches();
  res.status(204).end();
}));

export default router;
