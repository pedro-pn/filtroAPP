import { Router } from 'express';
import prisma from '../../lib/prisma.js';
import asyncHandler from '../../lib/async-handler.js';
import { requireAuth } from '../../middleware/auth.js';
import { createUnloading, assertUnloadingUser } from '../../lib/logistica/unloading.js';
import { importCte } from '../../lib/logistica/cte.js';
import { omieCall } from '../../lib/omie/client.js';

import { defineRoute } from '../../lib/api-contract/registry.js';
import { opsRoute, jsonResponseSchema, libValidatedBodySchema } from '../../lib/api-contract/domains/operacoes.js';
export function createLogisticsRouter({ prismaClient = prisma, call = omieCall } = {}) {
  const router = Router();
  router.use(requireAuth);
  defineRoute(router, opsRoute('GET /romaneios/:id', { tag: 'logistica', summary: 'Logística: Consultar romaneios (por id)', responses: { 200: jsonResponseSchema }, errors: [401, 403, 404] }), asyncHandler(async (req, res) => {
    const row = await prismaClient.romaneio.findFirst({ where: { id: req.params.id, project: { deletedAt: null } }, select: { projectId: true } });
    if (!row) return res.status(404).json({ error: 'Romaneio não encontrado.' });
    await assertUnloadingUser(prismaClient, row.projectId, req.auth.user.email || '', req.auth.user.id);
    const [history, ctes] = await Promise.all([
      prismaClient.logisticsUnloading.findMany({ where: { romaneioId: req.params.id }, orderBy: { confirmadaEm: 'asc' },
        select: { id: true, tipo: true, confirmadaEm: true, confirmadaPorEmail: true } }),
      prismaClient.logisticsCte.findMany({ where: { romaneioId: req.params.id },
        select: { id: true, numero: true, emissao: true, transportadora: true, invoiceId: true } })
    ]);
    res.json({ history, ctes });
  }));
  defineRoute(router, opsRoute('POST /descargas', { tag: 'logistica', summary: 'Logística: Criar descargas', body: libValidatedBodySchema, validatedBy: 'handler/serviço (corpo conferido fora do contrato)', responses: { 201: jsonResponseSchema }, errors: [400, 401, 403] }), asyncHandler(async (req, res) => {
    const context = { scopes: new Set(['logistica.descargas.create']), projectAccessMode: 'ALL', sessionUserId: req.auth.user.id };
    const result = await createUnloading(prismaClient, { ...req.body, confirmadaPorEmail: req.auth.user.email || '' }, req.headers['idempotency-key'], context);
    res.status(201).json(result);
  }));
  defineRoute(router, opsRoute('POST /romaneios/:id/cte', { tag: 'logistica', summary: 'Logística: Criar romaneios › cte', body: libValidatedBodySchema, validatedBy: 'handler/serviço (corpo conferido fora do contrato)', responses: { 201: jsonResponseSchema }, errors: [400, 401, 403] }), asyncHandler(async (req, res) => {
    res.status(201).json(await importCte(prismaClient, req.params.id, req.body, req.auth.user, call));
  }));
  return router;
}
export default createLogisticsRouter();
