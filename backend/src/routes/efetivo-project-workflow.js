import { Router } from 'express';
import { z } from 'zod';

import { makeProjectWorkflowSchemas } from '../../../shared/schemas/project-workflow.js';
import asyncHandler from '../lib/async-handler.js';
import { isEfetivoManager, requireEfetivoManager, requireEfetivoViewer } from '../lib/efetivo/access.js';
import {
  getProjectWorkflow,
  listProjectWorkflowLeaders,
  listProjectWorkflows,
  startProjectWorkflow,
  updateProjectWorkflow
} from '../lib/efetivo/project-workflow/service.js';

const router = Router();
const schemas = makeProjectWorkflowSchemas(z);
const projectIdSchema = z.string().trim().min(1).max(100);

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
