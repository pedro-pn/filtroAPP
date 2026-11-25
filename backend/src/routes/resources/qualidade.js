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
import { expensiveRouteLimit } from '../../lib/rate-limit.js';

import { defineRoute } from '../../lib/api-contract/registry.js';
import { opsRoute, EMPTY, FILE, jsonResponseSchema, libValidatedBodySchema } from '../../lib/api-contract/domains/operacoes.js';
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

defineRoute(router, opsRoute('GET /naturezas', { tag: 'qualidade', summary: 'Qualidade: Listar naturezas', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), asyncHandler(async (req, res) => {
  res.json(await listNatures(prisma, req.query));
}));

defineRoute(router, opsRoute('GET /projetos', { tag: 'qualidade', summary: 'Qualidade: Listar projetos', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), asyncHandler(async (_req, res) => {
  res.json(await listQualityProjects(prisma));
}));

defineRoute(router, opsRoute('POST /naturezas', { tag: 'qualidade', summary: 'Qualidade: Criar naturezas', body: libValidatedBodySchema, validatedBy: 'handler/serviço (corpo conferido fora do contrato)', responses: { 201: jsonResponseSchema }, errors: [400, 401, 403] }), requireQualidadeManager, asyncHandler(async (req, res) => {
  try {
    const data = schemas.natureCreate.parse(req.body);
    res.status(201).json(await createNature(prisma, data));
  } catch (error) {
    if (handleQualidadeError(error, res)) return;
    throw error;
  }
}));

defineRoute(router, opsRoute('PATCH /naturezas/ordem', { tag: 'qualidade', summary: 'Qualidade: Atualizar naturezas › ordem', body: libValidatedBodySchema, validatedBy: 'handler/serviço (corpo conferido fora do contrato)', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), requireQualidadeManager, asyncHandler(async (req, res) => {
  try {
    const data = schemas.natureOrder.parse(req.body);
    res.json(await reorderNatures(prisma, data.ids));
  } catch (error) {
    if (handleQualidadeError(error, res)) return;
    throw error;
  }
}));

defineRoute(router, opsRoute('PUT /naturezas/:id', { tag: 'qualidade', summary: 'Qualidade: Atualizar naturezas (por id)', body: libValidatedBodySchema, validatedBy: 'handler/serviço (corpo conferido fora do contrato)', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), requireQualidadeManager, asyncHandler(async (req, res) => {
  try {
    const data = schemas.natureUpdate.parse(req.body);
    res.json(await renameNature(prisma, req.params.id, data));
  } catch (error) {
    if (handleQualidadeError(error, res)) return;
    throw error;
  }
}));

defineRoute(router, opsRoute('PATCH /naturezas/:id/ativo', { tag: 'qualidade', summary: 'Qualidade: Atualizar naturezas › ativo', body: libValidatedBodySchema, validatedBy: 'handler/serviço (corpo conferido fora do contrato)', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), requireQualidadeManager, asyncHandler(async (req, res) => {
  try {
    const data = schemas.activePatch.parse(req.body);
    res.json(await setNatureActive(prisma, req.params.id, data.isActive));
  } catch (error) {
    if (handleQualidadeError(error, res)) return;
    throw error;
  }
}));

defineRoute(router, opsRoute('DELETE /naturezas/:id', { tag: 'qualidade', summary: 'Qualidade: Excluir naturezas (por id)', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 204: EMPTY }, errors: [401, 403] }), requireQualidadeManager, asyncHandler(async (req, res) => {
  try {
    await deleteNature(prisma, req.params.id);
    res.status(204).end();
  } catch (error) {
    if (handleQualidadeError(error, res)) return;
    throw error;
  }
}));

defineRoute(router, opsRoute('GET /registros/export', { tag: 'qualidade', summary: 'Qualidade: Exportar registros', responses: { 200: FILE }, errors: [401, 403, 429] }), ...expensiveRouteLimit('export'), asyncHandler(async (req, res) => {
  const records = await listRecordsForExport(prisma, req.query);
  const buffer = buildQualityRecordsXlsx(records);
  const today = new Date().toISOString().slice(0, 10);
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="registros-qualidade-${today}.xlsx"`);
  res.send(buffer);
}));

defineRoute(router, opsRoute('GET /registros/projeto/:projectId/desvios', { tag: 'qualidade', summary: 'Qualidade: Listar registros › projeto › desvios', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), asyncHandler(async (req, res) => {
  res.json(await listProjectDeviations(prisma, req.params.projectId));
}));

defineRoute(router, opsRoute('GET /registros', { tag: 'qualidade', summary: 'Qualidade: Listar registros', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), asyncHandler(async (req, res) => {
  res.json(await listRecords(prisma, req.query));
}));

defineRoute(router, opsRoute('POST /registros', { tag: 'qualidade', summary: 'Qualidade: Criar registros', body: libValidatedBodySchema, validatedBy: 'handler/serviço (corpo conferido fora do contrato)', responses: { 201: jsonResponseSchema }, errors: [400, 401, 403] }), requireQualidadeManager, asyncHandler(async (req, res) => {
  try {
    const data = schemas.recordCreate.parse(req.body);
    const record = await createRecord(prisma, { data, userId: req.auth?.user?.id || null });
    res.status(201).json(record);
  } catch (error) {
    if (handleQualidadeError(error, res)) return;
    throw error;
  }
}));

defineRoute(router, opsRoute('GET /registros/:id', { tag: 'qualidade', summary: 'Qualidade: Consultar registros (por id)', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), asyncHandler(async (req, res) => {
  try {
    res.json(await getRecord(prisma, req.params.id));
  } catch (error) {
    if (handleQualidadeError(error, res)) return;
    throw error;
  }
}));

defineRoute(router, opsRoute('PUT /registros/:id', { tag: 'qualidade', summary: 'Qualidade: Atualizar registros (por id)', body: libValidatedBodySchema, validatedBy: 'handler/serviço (corpo conferido fora do contrato)', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), requireQualidadeManager, asyncHandler(async (req, res) => {
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

defineRoute(router, opsRoute('DELETE /registros/:id', { tag: 'qualidade', summary: 'Qualidade: Excluir registros (por id)', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 204: EMPTY }, errors: [401, 403] }), requireQualidadeManager, asyncHandler(async (req, res) => {
  try {
    await deleteRecord(prisma, req.params.id, { userId: req.auth?.user?.id || null });
    res.status(204).end();
  } catch (error) {
    if (handleQualidadeError(error, res)) return;
    throw error;
  }
}));

export default router;
