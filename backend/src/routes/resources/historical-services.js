import { Router } from 'express';
import { z } from 'zod';
import prisma from '../../lib/prisma.js';
import asyncHandler from '../../lib/async-handler.js';
import { requireAuth, requireModuleRole } from '../../middleware/auth.js';
import { clearProjectDerivedCaches } from '../../lib/resource-list-cache.js';
import { HISTORICAL_CSV_TEMPLATE, historicalError } from '../../lib/reports/historical-services.js';
import {
  previewHistoricalImport, commitHistoricalImport, listHistoricalReports, updateHistoricalReport, linkHistoricalMeasurement
} from '../../lib/reports/historical-services-store.js';
import { defineRoute } from '../../lib/api-contract/registry.js';
import { rdoRoute, jsonObjectSchema, FILE } from '../../lib/api-contract/domains/rdo.js';

export function createHistoricalServicesRouter(client = prisma) {
  const router = Router();
  router.use(requireAuth, requireModuleRole('rdo:manager'));
  const input = z.object({ csv: z.string().min(1).max(500_000) });
  const handle = callback => asyncHandler(async (req, res) => {
    try { await callback(req, res); }
    catch (error) {
      if (error.code === 'P2002') throw historicalError('Este relatório já foi cadastrado. Atualize a prévia ou edite o lançamento existente.', 409);
      if (error.code === 'P2034') throw historicalError('Outra alteração ocorreu ao mesmo tempo. Atualize a prévia e tente novamente.', 409);
      throw error;
    }
  });
  defineRoute(router, rdoRoute('GET /template', { summary: 'Modelo CSV de serviços históricos', tag: 'rdo-historico', responses: { 200: FILE } }), (_req, res) => {
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="servicos-historicos-modelo.csv"');
    res.send(HISTORICAL_CSV_TEMPLATE);
  });
  defineRoute(router, rdoRoute('GET /:projectId', { summary: 'Serviços históricos do projeto', tag: 'rdo-historico', responses: { 200: z.looseObject({ items: z.array(z.unknown()) }) }, errors: [401, 403, 404] }), handle(async (req, res) => {
    res.json({ items: await listHistoricalReports(client, req.params.projectId) });
  }));
  defineRoute(router, rdoRoute('POST /:projectId/preview', { summary: 'Pré-visualizar a importação de serviços históricos', tag: 'rdo-historico', responses: { 200: jsonObjectSchema }, errors: [400, 401, 403, 404], body: input }), handle(async (req, res) => {
    const { csv } = input.parse(req.body);
    res.json(await previewHistoricalImport(client, req.params.projectId, csv));
  }));
  defineRoute(router, rdoRoute('POST /:projectId/import', { summary: 'Importar serviços históricos', tag: 'rdo-historico', responses: { 200: jsonObjectSchema, 201: jsonObjectSchema }, errors: [400, 401, 403, 404, 409], body: input.extend({ token: z.string().min(1), fileName: z.string().max(240).optional() }) }), handle(async (req, res) => {
    const data = input.extend({ token: z.string().min(1), fileName: z.string().max(240).optional() }).parse(req.body);
    const result = await commitHistoricalImport(client, { ...data, projectId: req.params.projectId, userId: req.auth.user.id });
    clearProjectDerivedCaches();
    res.status(result.created ? 201 : 200).json(result);
  }));
  defineRoute(router, rdoRoute('PUT /:projectId/:id', { summary: 'Editar um serviço histórico', tag: 'rdo-historico', responses: { 200: jsonObjectSchema }, errors: [400, 401, 403, 404, 409], body: input.extend({ revision: z.number().int().positive() }) }), handle(async (req, res) => {
    const data = input.extend({ revision: z.number().int().positive() }).parse(req.body);
    const item = await updateHistoricalReport(client, { ...data, ...req.params, userId: req.auth.user.id });
    clearProjectDerivedCaches();
    res.json(item);
  }));
  defineRoute(router, rdoRoute('PUT /:projectId/:id/items/:itemIndex/system', { summary: 'Vincular o sistema de um item histórico', tag: 'rdo-historico', body: z.object({ projectSystemId: z.string().max(100).nullable(), revision: z.number().int().positive() }), responses: { 200: jsonObjectSchema }, errors: [400, 401, 403, 404, 409] }), handle(async (req, res) => {
    const { projectSystemId, revision } = z.object({ projectSystemId: z.string().max(100).nullable(), revision: z.number().int().positive() }).parse(req.body);
    const itemIndex = z.coerce.number().int().nonnegative().max(1999).parse(req.params.itemIndex);
    const item = await linkHistoricalMeasurement(client, { ...req.params, itemIndex, projectSystemId, revision, userId: req.auth.user.id });
    clearProjectDerivedCaches();
    res.json(item);
  }));
  return router;
}

export default createHistoricalServicesRouter();
