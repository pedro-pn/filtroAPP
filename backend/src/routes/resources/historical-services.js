import { Router } from 'express';
import { z } from 'zod';
import prisma from '../../lib/prisma.js';
import asyncHandler from '../../lib/async-handler.js';
import { requireAuth, requireModuleRole } from '../../middleware/auth.js';
import { statisticsProjectsCache } from '../../lib/resource-list-cache.js';
import { HISTORICAL_CSV_TEMPLATE, historicalError } from '../../lib/reports/historical-services.js';
import {
  previewHistoricalImport, commitHistoricalImport, listHistoricalReports, updateHistoricalReport
} from '../../lib/reports/historical-services-store.js';

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
  router.get('/template', (_req, res) => {
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="servicos-historicos-modelo.csv"');
    res.send(HISTORICAL_CSV_TEMPLATE);
  });
  router.get('/:projectId', handle(async (req, res) => {
    res.json({ items: await listHistoricalReports(client, req.params.projectId) });
  }));
  router.post('/:projectId/preview', handle(async (req, res) => {
    const { csv } = input.parse(req.body);
    res.json(await previewHistoricalImport(client, req.params.projectId, csv));
  }));
  router.post('/:projectId/import', handle(async (req, res) => {
    const data = input.extend({ token: z.string().min(1), fileName: z.string().max(240).optional() }).parse(req.body);
    const result = await commitHistoricalImport(client, { ...data, projectId: req.params.projectId, userId: req.auth.user.id });
    statisticsProjectsCache.clear();
    res.status(result.created ? 201 : 200).json(result);
  }));
  router.put('/:projectId/:id', handle(async (req, res) => {
    const data = input.extend({ revision: z.number().int().positive() }).parse(req.body);
    const item = await updateHistoricalReport(client, { ...data, ...req.params, userId: req.auth.user.id });
    statisticsProjectsCache.clear();
    res.json(item);
  }));
  return router;
}

export default createHistoricalServicesRouter();
