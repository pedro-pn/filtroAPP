import { Router } from 'express';
import { z } from 'zod';

import { makeProjectWorkflowSchemas } from '../../../shared/schemas/project-workflow.js';
import { makeProjectExecutionSchemas } from '../../../shared/schemas/project-execution.js';
import asyncHandler from '../lib/async-handler.js';
import { isEfetivoManager, requireEfetivoManager, requireEfetivoViewer } from '../lib/efetivo/access.js';
import {
  getProjectWorkflow,
  listProjectWorkflowLeaders,
  listProjectWorkflows,
  startProjectWorkflow,
  updateProjectWorkflow
} from '../lib/efetivo/project-workflow/service.js';
import {
  createProjectExecutionDeviation,
  getProjectExecutionDashboard,
  updateProjectExecutionDeviation,
  updateProjectExecutionReportTargets
} from '../lib/efetivo/project-workflow/execution-dashboard.js';
import { getProjectCloseoutDashboard } from '../lib/efetivo/project-workflow/closeout-dashboard.js';

const router = Router();
const schemas = makeProjectWorkflowSchemas(z);
const executionSchemas = makeProjectExecutionSchemas(z);
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

router.get('/:projectId/execution', requireEfetivoViewer, asyncHandler(async (req, res) => {
  const projectId = projectIdSchema.parse(req.params.projectId);
  res.json(await getProjectExecutionDashboard(projectId, context(req)));
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
