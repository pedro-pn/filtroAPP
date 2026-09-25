import { Router } from 'express';
import { z } from 'zod';

import { makeProjectWorkflowSchemas } from '../../../shared/schemas/project-workflow.js';
import { makeProjectExecutionSchemas } from '../../../shared/schemas/project-execution.js';
import { makeProjectDocumentSchemas } from '../../../shared/schemas/project-documents.js';
import asyncHandler from '../lib/async-handler.js';
import { isEfetivoManager, requireEfetivoManager, requireEfetivoViewer } from '../lib/efetivo/access.js';
import {
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
    isManager: isEfetivoManager(req.auth?.user)
  };
}

router.get('/', requireEfetivoViewer, asyncHandler(async (req, res) => {
  res.json(await listProjectWorkflows(schemas.list.parse(req.query), context(req)));
}));

router.get('/leaders', requireEfetivoViewer, asyncHandler(async (_req, res) => {
  res.json(await listProjectWorkflowLeaders());
}));

router.get('/:projectId/legacy-summary/equipment', requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  res.json(await listProjectWorkflowLegacySummaryEquipment(projectId, context(req)));
}));

router.post('/:projectId/legacy-summary', requireEfetivoManager, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  res.status(201).json(await startLegacyProjectWorkflowSummary(projectId, schemas.startLegacySummary.parse(req.body), context(req)));
}));

router.get('/:projectId/documents', requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  res.json(await listProjectDocuments(projectId, documentSchemas.list.parse(req.query), context(req)));
}));

router.post('/:projectId/documents', requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  const result = await createProjectDocument(projectId, documentSchemas.create.parse(req.body), context(req));
  res.status(201).json(result);
}));

router.patch('/:projectId/documents/:documentId', requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  const documentId = documentSchemas.id.parse(req.params.documentId);
  res.json(await updateProjectDocument(projectId, documentId, documentSchemas.patch.parse(req.body), context(req)));
}));

router.get('/:projectId/documents/:documentId/versions', requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  const documentId = documentSchemas.id.parse(req.params.documentId);
  res.json(await listProjectDocumentVersions(projectId, documentId, context(req)));
}));

router.post('/:projectId/documents/:documentId/versions', requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  const documentId = documentSchemas.id.parse(req.params.documentId);
  const result = await addProjectDocumentVersion(projectId, documentId, documentSchemas.addVersion.parse(req.body), context(req));
  res.status(201).json(result);
}));

router.get('/:projectId/documents/:documentId/versions/:versionId/file', requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  const documentId = documentSchemas.id.parse(req.params.documentId);
  const versionId = documentSchemas.id.parse(req.params.versionId);
  const file = await resolveProjectDocumentFile(projectId, documentId, versionId, context(req));
  res.type(file.mimeType);
  res.setHeader('Content-Disposition', file.disposition);
  res.sendFile(file.targetPath);
}));

router.get('/:projectId/documents/:documentId/versions/:versionId/signed-file', requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  const documentId = documentSchemas.id.parse(req.params.documentId);
  const versionId = documentSchemas.id.parse(req.params.versionId);
  const file = await resolveSignedProjectDocumentFile(projectId, documentId, versionId, context(req));
  res.type(file.mimeType);
  res.setHeader('Content-Disposition', file.disposition);
  res.sendFile(file.targetPath);
}));

router.post('/:projectId/documents/:documentId/acceptance', requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  const documentId = documentSchemas.id.parse(req.params.documentId);
  res.json(await recordProjectDocumentAcceptance(projectId, documentId, documentSchemas.acceptance.parse(req.body), context(req)));
}));

router.post('/:projectId/documents/:documentId/signature', requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  const documentId = documentSchemas.id.parse(req.params.documentId);
  res.json(await prepareProjectDocumentSignature(projectId, documentId, documentSchemas.signature.parse(req.body), context(req)));
}));

router.post('/:projectId/documents/:documentId/archive', requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  const documentId = documentSchemas.id.parse(req.params.documentId);
  res.json(await archiveProjectDocument(projectId, documentId, documentSchemas.expected.parse(req.body), context(req)));
}));

router.post('/:projectId/documents/:documentId/restore', requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  const documentId = documentSchemas.id.parse(req.params.documentId);
  res.json(await restoreProjectDocument(projectId, documentId, documentSchemas.expected.parse(req.body), context(req)));
}));

router.get('/:projectId/execution', requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  res.json(await getProjectExecutionDashboard(projectId, context(req)));
}));

router.put('/:projectId/execution/weekly-review', requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  res.json(await saveProjectExecutionWeeklyReview(projectId, executionSchemas.weeklyReview.parse(req.body), context(req)));
}));

router.get('/:projectId/closeout', requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  res.json(await getProjectCloseoutDashboard(projectId, context(req)));
}));

router.put('/:projectId/execution/report-targets', requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  res.json(await updateProjectExecutionReportTargets(projectId, executionSchemas.reportTargets.parse(req.body), context(req)));
}));

router.post('/:projectId/execution/deviations', requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  const record = await createProjectExecutionDeviation(projectId, executionSchemas.deviationCreate.parse(req.body), context(req));
  res.status(201).json(record);
}));

router.patch('/:projectId/execution/deviations/:deviationId', requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  const deviationId = deviationIdSchema.parse(req.params.deviationId);
  res.json(await updateProjectExecutionDeviation(projectId, deviationId, executionSchemas.deviationStatus.parse(req.body), context(req)));
}));

router.get('/:projectId', requireEfetivoViewer, asyncHandler(async (req, res) => {
  res.json(await getProjectWorkflow(projectIdSchema.parse(req.params.projectId), context(req)));
}));

router.post('/:projectId', requireEfetivoManager, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  res.status(201).json(await startProjectWorkflow(projectId, schemas.start.parse(req.body), context(req)));
}));

router.patch('/:projectId', requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  res.json(await updateProjectWorkflow(projectId, schemas.patch.parse(req.body), context(req)));
}));

export default router;
