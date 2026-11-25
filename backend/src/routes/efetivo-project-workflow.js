import { Router } from 'express';
import { z } from 'zod';

import { makeProjectWorkflowSchemas } from '../../../shared/schemas/project-workflow.js';
import { makeProjectExecutionSchemas } from '../../../shared/schemas/project-execution.js';
import { makeProjectDocumentSchemas } from '../../../shared/schemas/project-documents.js';
import asyncHandler from '../lib/async-handler.js';
import { signatureEvidenceFromRequest } from '../lib/internal-report-signatures.js';
import { requireHubAdmin } from '../middleware/auth.js';
import { getProjectRomaneios } from '../lib/acompanhamento/project-romaneios.js';
import { isEfetivoManager, requireEfetivoManager, requireEfetivoViewer } from '../lib/efetivo/access.js';
import { efetivoProjectWhere } from '../lib/efetivo/project-visibility.js';
import {
  convertProjectWorkflowToLegacySummary,
  getProjectWorkflow,
  listProjectWorkflowLeaders,
  listProjectWorkflowLegacySummaryEquipment,
  listProjectWorkflows,
  startLegacyProjectWorkflowSummary,
  startProjectWorkflow,
  updateProjectWorkflow
} from '../lib/efetivo/project-workflow/service.js';
import {
  createProjectExecutionDeviation,
  getProjectExecutionDashboard,
  saveProjectExecutionWeeklyReview,
  updateProjectExecutionDeviation,
  updateProjectExecutionReportTargets
} from '../lib/efetivo/project-workflow/execution-dashboard.js';
import { getProjectCloseoutDashboard } from '../lib/efetivo/project-workflow/closeout-dashboard.js';
import {
  addProjectDocumentVersion,
  archiveProjectDocument,
  createProjectDocument,
  listProjectDocuments,
  listProjectDocumentVersions,
  prepareProjectDocumentSignature,
  recordProjectDocumentAcceptance,
  resolveProjectDocumentFile,
  resolveSignedProjectDocumentFile,
  restoreProjectDocument,
  updateProjectDocument
} from '../lib/efetivo/project-workflow/documents.js';
import { defineRoute } from '../lib/api-contract/registry.js';
import { FILE, efetivoRoute, jsonResponseSchema } from '../lib/api-contract/domains/efetivo.js';

const router = Router();
const schemas = makeProjectWorkflowSchemas(z);
const executionSchemas = makeProjectExecutionSchemas(z);
const documentSchemas = makeProjectDocumentSchemas(z);
const projectIdSchema = z.string().trim().min(1).max(100);
const deviationIdSchema = z.string().trim().min(1).max(100);

function context(req) {
  return {
    actorUserId: req.auth?.user?.id || null,
    user: req.auth?.user || null,
    evidence: signatureEvidenceFromRequest(req),
    isManager: isEfetivoManager(req.auth?.user)
  };
}

defineRoute(router, efetivoRoute('GET /', { summary: 'Fluxos de gestão dos projetos', tag: 'efetivo-fluxo-projeto', query: schemas.list, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  res.json(await listProjectWorkflows(schemas.list.parse(req.query), context(req)));
}));

defineRoute(router, efetivoRoute('GET /leaders', { summary: 'Líderes disponíveis para o fluxo do projeto', tag: 'efetivo-fluxo-projeto', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), requireEfetivoViewer, asyncHandler(async (_req, res) => {
  res.json(await listProjectWorkflowLeaders());
}));

defineRoute(router, efetivoRoute('GET /:projectId/romaneios', { summary: 'Romaneios do projeto no fluxo de gestão', tag: 'efetivo-fluxo-projeto', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  const result = await getProjectRomaneios(projectId, {
    projectWhere: { isActive: true, ...efetivoProjectWhere() }
  });
  if (!result) return res.status(404).json({ error: 'Projeto não encontrado ou indisponível no Efetivo.' });
  return res.json(result);
}));

defineRoute(router, efetivoRoute('GET /:projectId/legacy-summary/equipment', { summary: 'Equipamentos do resumo de projeto legado', tag: 'efetivo-fluxo-projeto', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  res.json(await listProjectWorkflowLegacySummaryEquipment(projectId, context(req)));
}));

defineRoute(router, efetivoRoute('POST /:projectId/legacy-summary', { summary: 'Iniciar resumo de projeto legado', tag: 'efetivo-fluxo-projeto', body: schemas.startLegacySummary, responses: { 201: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoManager, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  res.status(201).json(await startLegacyProjectWorkflowSummary(projectId, schemas.startLegacySummary.parse(req.body), context(req)));
}));

defineRoute(router, efetivoRoute('POST /:projectId/legacy-summary/convert', { summary: 'Converter fluxo em resumo de projeto legado', tag: 'efetivo-fluxo-projeto', body: schemas.convertLegacySummary, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireHubAdmin, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  res.json(await convertProjectWorkflowToLegacySummary(projectId, schemas.convertLegacySummary.parse(req.body), context(req)));
}));

defineRoute(router, efetivoRoute('GET /:projectId/documents', { summary: 'Documentos do projeto', tag: 'efetivo-fluxo-projeto', query: documentSchemas.list, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  res.json(await listProjectDocuments(projectId, documentSchemas.list.parse(req.query), context(req)));
}));

defineRoute(router, efetivoRoute('POST /:projectId/documents', { summary: 'Criar documento do projeto', tag: 'efetivo-fluxo-projeto', body: documentSchemas.create, responses: { 201: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  const result = await createProjectDocument(projectId, documentSchemas.create.parse(req.body), context(req));
  res.status(201).json(result);
}));

defineRoute(router, efetivoRoute('PATCH /:projectId/documents/:documentId', { summary: 'Atualizar documento do projeto', tag: 'efetivo-fluxo-projeto', body: documentSchemas.patch, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  const documentId = documentSchemas.id.parse(req.params.documentId);
  res.json(await updateProjectDocument(projectId, documentId, documentSchemas.patch.parse(req.body), context(req)));
}));

defineRoute(router, efetivoRoute('GET /:projectId/documents/:documentId/versions', { summary: 'Versões do documento do projeto', tag: 'efetivo-fluxo-projeto', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  const documentId = documentSchemas.id.parse(req.params.documentId);
  res.json(await listProjectDocumentVersions(projectId, documentId, context(req)));
}));

defineRoute(router, efetivoRoute('POST /:projectId/documents/:documentId/versions', { summary: 'Adicionar versão ao documento do projeto', tag: 'efetivo-fluxo-projeto', body: documentSchemas.addVersion, responses: { 201: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  const documentId = documentSchemas.id.parse(req.params.documentId);
  const result = await addProjectDocumentVersion(projectId, documentId, documentSchemas.addVersion.parse(req.body), context(req));
  res.status(201).json(result);
}));

defineRoute(router, efetivoRoute('GET /:projectId/documents/:documentId/versions/:versionId/file', { summary: 'Arquivo da versão do documento', tag: 'efetivo-fluxo-projeto', responses: { 200: FILE }, errors: [400, 401, 403, 404] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  const documentId = documentSchemas.id.parse(req.params.documentId);
  const versionId = documentSchemas.id.parse(req.params.versionId);
  const file = await resolveProjectDocumentFile(projectId, documentId, versionId, context(req));
  res.type(file.mimeType);
  res.setHeader('Content-Disposition', file.disposition);
  res.sendFile(file.targetPath);
}));

defineRoute(router, efetivoRoute('GET /:projectId/documents/:documentId/versions/:versionId/signed-file', { summary: 'Arquivo assinado da versão do documento', tag: 'efetivo-fluxo-projeto', responses: { 200: FILE }, errors: [400, 401, 403, 404] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  const documentId = documentSchemas.id.parse(req.params.documentId);
  const versionId = documentSchemas.id.parse(req.params.versionId);
  const file = await resolveSignedProjectDocumentFile(projectId, documentId, versionId, context(req));
  res.type(file.mimeType);
  res.setHeader('Content-Disposition', file.disposition);
  res.sendFile(file.targetPath);
}));

defineRoute(router, efetivoRoute('POST /:projectId/documents/:documentId/acceptance', { summary: 'Registrar aceite do documento', tag: 'efetivo-fluxo-projeto', body: documentSchemas.acceptance, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  const documentId = documentSchemas.id.parse(req.params.documentId);
  res.json(await recordProjectDocumentAcceptance(projectId, documentId, documentSchemas.acceptance.parse(req.body), context(req)));
}));

defineRoute(router, efetivoRoute('POST /:projectId/documents/:documentId/signature', { summary: 'Preparar assinatura do documento', tag: 'efetivo-fluxo-projeto', body: documentSchemas.signature, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  const documentId = documentSchemas.id.parse(req.params.documentId);
  res.json(await prepareProjectDocumentSignature(projectId, documentId, documentSchemas.signature.parse(req.body), context(req)));
}));

defineRoute(router, efetivoRoute('POST /:projectId/documents/:documentId/archive', { summary: 'Arquivar documento do projeto', tag: 'efetivo-fluxo-projeto', body: documentSchemas.expected, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  const documentId = documentSchemas.id.parse(req.params.documentId);
  res.json(await archiveProjectDocument(projectId, documentId, documentSchemas.expected.parse(req.body), context(req)));
}));

defineRoute(router, efetivoRoute('POST /:projectId/documents/:documentId/restore', { summary: 'Restaurar documento arquivado', tag: 'efetivo-fluxo-projeto', body: documentSchemas.expected, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  const documentId = documentSchemas.id.parse(req.params.documentId);
  res.json(await restoreProjectDocument(projectId, documentId, documentSchemas.expected.parse(req.body), context(req)));
}));

defineRoute(router, efetivoRoute('GET /:projectId/execution', { summary: 'Painel de execução do projeto', tag: 'efetivo-fluxo-projeto', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  res.json(await getProjectExecutionDashboard(projectId, context(req)));
}));

defineRoute(router, efetivoRoute('PUT /:projectId/execution/weekly-review', { summary: 'Salvar revisão semanal da execução', tag: 'efetivo-fluxo-projeto', body: executionSchemas.weeklyReview, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  res.json(await saveProjectExecutionWeeklyReview(projectId, executionSchemas.weeklyReview.parse(req.body), context(req)));
}));

defineRoute(router, efetivoRoute('GET /:projectId/closeout', { summary: 'Painel de encerramento do projeto', tag: 'efetivo-fluxo-projeto', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  res.json(await getProjectCloseoutDashboard(projectId, context(req)));
}));

defineRoute(router, efetivoRoute('PUT /:projectId/execution/report-targets', { summary: 'Atualizar destinatários dos relatórios da execução', tag: 'efetivo-fluxo-projeto', body: executionSchemas.reportTargets, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  res.json(await updateProjectExecutionReportTargets(projectId, executionSchemas.reportTargets.parse(req.body), context(req)));
}));

defineRoute(router, efetivoRoute('POST /:projectId/execution/deviations', { summary: 'Registrar desvio da execução', tag: 'efetivo-fluxo-projeto', body: executionSchemas.deviationCreate, responses: { 201: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  const record = await createProjectExecutionDeviation(projectId, executionSchemas.deviationCreate.parse(req.body), context(req));
  res.status(201).json(record);
}));

defineRoute(router, efetivoRoute('PATCH /:projectId/execution/deviations/:deviationId', { summary: 'Atualizar situação do desvio da execução', tag: 'efetivo-fluxo-projeto', body: executionSchemas.deviationStatus, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  const deviationId = deviationIdSchema.parse(req.params.deviationId);
  res.json(await updateProjectExecutionDeviation(projectId, deviationId, executionSchemas.deviationStatus.parse(req.body), context(req)));
}));

defineRoute(router, efetivoRoute('GET /:projectId', { summary: 'Fluxo de gestão do projeto', tag: 'efetivo-fluxo-projeto', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  res.json(await getProjectWorkflow(projectIdSchema.parse(req.params.projectId), context(req)));
}));

defineRoute(router, efetivoRoute('POST /:projectId', { summary: 'Iniciar fluxo de gestão do projeto', tag: 'efetivo-fluxo-projeto', body: schemas.start, responses: { 201: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoManager, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  res.status(201).json(await startProjectWorkflow(projectId, schemas.start.parse(req.body), context(req)));
}));

defineRoute(router, efetivoRoute('PATCH /:projectId', { summary: 'Atualizar fluxo de gestão do projeto', tag: 'efetivo-fluxo-projeto', body: schemas.patch, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  res.json(await updateProjectWorkflow(projectId, schemas.patch.parse(req.body), context(req)));
}));

export default router;
