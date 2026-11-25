import { Router } from 'express';
import { z } from 'zod';
import prisma from '../../lib/prisma.js';
import asyncHandler from '../../lib/async-handler.js';
import { requireAuth, requireAcompanhamentoAccess, requireAcompanhamentoManager } from '../../middleware/auth.js';
import { getSystemReconciliation, linkReconciledMeasurement, linkReconciledMeasurements } from '../../lib/acompanhamento/system-reconciliation.js';
import { historicalError } from '../../lib/reports/historical-services.js';
import { clearProjectDerivedCaches } from '../../lib/resource-list-cache.js';

import { defineRoute } from '../../lib/api-contract/registry.js';
import { opsRoute, jsonResponseSchema, libValidatedBodySchema } from '../../lib/api-contract/domains/operacoes.js';
export function createSystemReconciliationRouter(client = prisma) {
  const router = Router({ mergeParams: true });
  router.use(requireAuth, requireAcompanhamentoAccess);
  defineRoute(router, opsRoute('GET /', { tag: 'acompanhamento-comercial', summary: 'Conciliação de sistemas: Listar sistemas do projeto', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), asyncHandler(async (req, res) => {
    res.json(await getSystemReconciliation(client, req.params.projectId));
  }));
  defineRoute(router, opsRoute('PUT /measurements', { tag: 'acompanhamento-comercial', summary: 'Conciliação de sistemas: Salvar medições', body: libValidatedBodySchema, validatedBy: 'handler/serviço (corpo conferido fora do contrato)', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), requireAcompanhamentoManager, asyncHandler(async (req, res) => {
    const data = z.object({
      projectSystemId: z.string().min(1).max(100).nullable(),
      measurements: z.array(z.object({
        source: z.enum(['HISTORICAL', 'REPORT']), reportId: z.string().min(1).max(100),
        measurementKey: z.string().min(1).max(100), revision: z.union([z.string().min(1).max(100), z.number().int().positive()])
      })).min(1).max(200)
    }).parse(req.body);
    try {
      const result = await linkReconciledMeasurements(client, { ...data, projectId: req.params.projectId, userId: req.auth.user.id });
      clearProjectDerivedCaches();
      res.json(result);
    } catch (error) {
      if (['P2034', 'P2002'].includes(error.code)) throw historicalError('Outra alteração ocorreu. Atualize a lista e tente novamente.', 409);
      throw error;
    }
  }));
  defineRoute(router, opsRoute('PUT /:id/items/:itemIndex/system', { tag: 'acompanhamento-comercial', summary: 'Conciliação de sistemas: Vincular item a um sistema', body: libValidatedBodySchema, validatedBy: 'handler/serviço (corpo conferido fora do contrato)', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), requireAcompanhamentoManager, asyncHandler(async (req, res) => {
    const data = z.object({ projectSystemId: z.string().min(1).max(100).nullable(), revision: z.number().int().positive() }).parse(req.body);
    const itemIndex = z.coerce.number().int().nonnegative().max(1999).parse(req.params.itemIndex);
    try {
      await linkReconciledMeasurement(client, { ...data, ...req.params, itemIndex, userId: req.auth.user.id });
    } catch (error) {
      if (error.code === 'P2034') throw historicalError('Outra alteração ocorreu. Atualize a lista e tente novamente.', 409);
      throw error;
    }
    clearProjectDerivedCaches();
    res.json({ saved: true });
  }));
  return router;
}
