import { Router } from 'express';
import { z } from 'zod';

import { makeQualidadeSchemas } from '../../../../shared/schemas/qualidade.js';
import { buildQualityRecordsXlsx } from '../../lib/qualidade/export-xlsx.js';
import {
  QualidadeError,
  createNature,
  createRecord,
  deleteNature,
  deleteRecord,
  getRecord,
  listNatures,
  listQualityProjects,
  listProjectDeviations,
  listRecords,
  listRecordsForExport,
  renameNature,
  reorderNatures,
  setNatureActive,
  updateRecord
} from '../../lib/qualidade/service.js';
import asyncHandler from '../../lib/async-handler.js';
import prisma from '../../lib/prisma.js';
import {
  requireAuth,
  requireQualidadeAccess,
  requireQualidadeManager
} from '../../middleware/auth.js';

const router = Router();
const schemas = makeQualidadeSchemas(z);

router.use(requireAuth);
router.use(requireQualidadeAccess);

function handleQualidadeError(error, res) {
  if (error instanceof QualidadeError) {
    res.status(error.statusCode || 400).json({ error: error.message });
    return true;
  }
  return false;
}

router.get('/naturezas', asyncHandler(async (req, res) => {
  res.json(await listNatures(prisma, req.query));
}));

router.get('/projetos', asyncHandler(async (_req, res) => {
  res.json(await listQualityProjects(prisma));
}));

router.post('/naturezas', requireQualidadeManager, asyncHandler(async (req, res) => {
  try {
    const data = schemas.natureCreate.parse(req.body);
    res.status(201).json(await createNature(prisma, data));
  } catch (error) {
    if (handleQualidadeError(error, res)) return;
    throw error;
  }
}));

router.patch('/naturezas/ordem', requireQualidadeManager, asyncHandler(async (req, res) => {
  try {
    const data = schemas.natureOrder.parse(req.body);
    res.json(await reorderNatures(prisma, data.ids));
  } catch (error) {
    if (handleQualidadeError(error, res)) return;
    throw error;
  }
}));

router.put('/naturezas/:id', requireQualidadeManager, asyncHandler(async (req, res) => {
  try {
    const data = schemas.natureUpdate.parse(req.body);
    res.json(await renameNature(prisma, req.params.id, data));
  } catch (error) {
    if (handleQualidadeError(error, res)) return;
    throw error;
  }
}));

router.patch('/naturezas/:id/ativo', requireQualidadeManager, asyncHandler(async (req, res) => {
  try {
    const data = schemas.activePatch.parse(req.body);
    res.json(await setNatureActive(prisma, req.params.id, data.isActive));
  } catch (error) {
    if (handleQualidadeError(error, res)) return;
    throw error;
  }
}));

router.delete('/naturezas/:id', requireQualidadeManager, asyncHandler(async (req, res) => {
  try {
    await deleteNature(prisma, req.params.id);
    res.status(204).end();
  } catch (error) {
    if (handleQualidadeError(error, res)) return;
    throw error;
  }
}));

router.get('/registros/export', asyncHandler(async (req, res) => {
  const records = await listRecordsForExport(prisma, req.query);
  const buffer = buildQualityRecordsXlsx(records);
  const today = new Date().toISOString().slice(0, 10);
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="registros-qualidade-${today}.xlsx"`);
  res.send(buffer);
}));

router.get('/registros/projeto/:projectId/desvios', asyncHandler(async (req, res) => {
  res.json(await listProjectDeviations(prisma, req.params.projectId));
}));

router.get('/registros', asyncHandler(async (req, res) => {
  res.json(await listRecords(prisma, req.query));
}));

router.post('/registros', requireQualidadeManager, asyncHandler(async (req, res) => {
  try {
    const data = schemas.recordCreate.parse(req.body);
    const record = await createRecord(prisma, { data, userId: req.auth?.user?.id || null });
    res.status(201).json(record);
  } catch (error) {
    if (handleQualidadeError(error, res)) return;
    throw error;
  }
}));

router.get('/registros/:id', asyncHandler(async (req, res) => {
  try {
    res.json(await getRecord(prisma, req.params.id));
  } catch (error) {
    if (handleQualidadeError(error, res)) return;
    throw error;
  }
}));

router.put('/registros/:id', requireQualidadeManager, asyncHandler(async (req, res) => {
  try {
    const existing = await prisma.qualityRecord.findFirst({
      where: { id: req.params.id, deletedAt: null },
      select: { type: true }
    });
    if (!existing) throw new QualidadeError('Registro de qualidade não encontrado.', 404);
    const data = schemas.recordUpdateForType(existing.type).parse(req.body);
    res.json(await updateRecord(prisma, req.params.id, { data, userId: req.auth?.user?.id || null }));
  } catch (error) {
    if (handleQualidadeError(error, res)) return;
    throw error;
  }
}));

router.delete('/registros/:id', requireQualidadeManager, asyncHandler(async (req, res) => {
  try {
    await deleteRecord(prisma, req.params.id, { userId: req.auth?.user?.id || null });
    res.status(204).end();
  } catch (error) {
    if (handleQualidadeError(error, res)) return;
    throw error;
  }
}));

export default router;
