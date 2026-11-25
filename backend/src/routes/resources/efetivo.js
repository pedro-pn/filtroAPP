import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import { requireEfetivoManager, requireEfetivoViewer } from '../../lib/efetivo/access.js';
import {
  efetivoStatus,
  getEfetivoCollaboratorProductivity,
  getEfetivoProductivity,
  listEfetivoCollaborators,
  listEfetivoAbsences
} from '../../lib/efetivo/service.js';
import {
  createWorkforceAbsence,
  deleteWorkforceAbsence,
  updateWorkforceAbsence
} from '../../lib/collaborators/availability-service.js';
import prisma from '../../lib/prisma.js';
import { requestEvidence } from '../../lib/efetivo/planning/plan-context.js';
import {
  getEfetivoReferenceSetting,
  setEfetivoReferenceSetting
} from '../../lib/efetivo/settings.js';
import { requireAuth } from '../../middleware/auth.js';
import efetivoPlanningRouter from '../efetivo-planning.js';
import efetivoProjectWorkflowRouter from '../efetivo-project-workflow.js';
import { createReviewParticipationRouter } from './efetivo-review-participation.js';
import { defineRoute } from '../../lib/api-contract/registry.js';
import { EMPTY, efetivoRoute, jsonResponseSchema } from '../../lib/api-contract/domains/efetivo.js';

const router = Router();

function planningContext(req) {
  return { actorUserId: req.auth?.user?.id || null, evidence: requestEvidence(req) };
}

const currentYear = new Date().getUTCFullYear();
const productivityQuerySchema = z.object({
  ano: z.coerce.number().int().min(2000).max(currentYear + 1),
  ateMes: z.coerce.number().int().min(1).max(12)
});
const collaboratorIdSchema = z.string().trim().min(1).max(100);
const referenceSchema = z.object({
  referenciaMensalHH: z.coerce.number().positive().max(744)
});
const dateOnlySchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD.')
  .refine(value => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Informe uma data válida.');
const absenceQuerySchema = z.object({
  ano: z.coerce.number().int().min(2000).max(currentYear + 1),
  colaborador: z.string().trim().min(1).max(100).optional()
});
const absenceCreateSchema = z.object({
  collaboratorId: collaboratorIdSchema,
  type: z.enum(['FERIAS', 'FOLGA', 'AFASTAMENTO', 'FADIGA_OFFSHORE']).default('FERIAS'),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema,
  note: z.string().trim().max(500).nullable().optional()
});
const absenceUpdateSchema = z.object({
  type: z.enum(['FERIAS', 'FOLGA', 'AFASTAMENTO', 'FADIGA_OFFSHORE']).optional(),
  startDate: dateOnlySchema.optional(),
  endDate: dateOnlySchema.optional(),
  note: z.string().trim().max(500).nullable().optional()
}).refine(value => Object.keys(value).length > 0, 'Informe ao menos uma alteração.');

router.use(requireAuth);
router.use('/planning', efetivoPlanningRouter);
router.use('/project-workflow', efetivoProjectWorkflowRouter);
router.use('/administracao/conferencia/colaboradores', createReviewParticipationRouter());

defineRoute(router, efetivoRoute('GET /status', { summary: 'Disponibilidade do módulo Efetivo', tag: 'efetivo', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), requireEfetivoViewer, (_req, res) => {
  res.json(efetivoStatus());
});

defineRoute(router, efetivoRoute('GET /produtividade', { summary: 'Produtividade individual da equipe', tag: 'efetivo', query: productivityQuerySchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  const filters = productivityQuerySchema.parse(req.query);
  res.json(await getEfetivoProductivity(filters));
}));

defineRoute(router, efetivoRoute('GET /produtividade/:collaboratorId', { summary: 'Produtividade de um colaborador', tag: 'efetivo', query: productivityQuerySchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  const filters = productivityQuerySchema.parse(req.query);
  const collaboratorId = collaboratorIdSchema.parse(req.params.collaboratorId);
  const detail = await getEfetivoCollaboratorProductivity(collaboratorId, filters);
  if (!detail) return res.status(404).json({ error: 'Colaborador não encontrado no período.' });
  res.json(detail);
}));

defineRoute(router, efetivoRoute('GET /parametros', { summary: 'Parâmetros de referência da produtividade', tag: 'efetivo', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), requireEfetivoViewer, asyncHandler(async (_req, res) => {
  res.json(await getEfetivoReferenceSetting());
}));

defineRoute(router, efetivoRoute('PUT /parametros', { summary: 'Atualizar parâmetros de referência da produtividade', tag: 'efetivo', body: referenceSchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), requireEfetivoManager, asyncHandler(async (req, res) => {
  const payload = referenceSchema.parse(req.body);
  res.json(await setEfetivoReferenceSetting(payload.referenciaMensalHH, req.auth.user.id));
}));

defineRoute(router, efetivoRoute('GET /colaboradores', { summary: 'Colaboradores do Efetivo', tag: 'efetivo', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), requireEfetivoManager, asyncHandler(async (_req, res) => {
  res.json(await listEfetivoCollaborators());
}));

defineRoute(router, efetivoRoute('GET /ausencias', { summary: 'Ausências do Efetivo', tag: 'efetivo', query: absenceQuerySchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  const query = absenceQuerySchema.parse(req.query);
  res.json(await listEfetivoAbsences({ ano: query.ano, collaboratorId: query.colaborador }));
}));

defineRoute(router, efetivoRoute('POST /ausencias', { summary: 'Registrar ausência pelo Efetivo', tag: 'efetivo', body: absenceCreateSchema, responses: { 201: jsonResponseSchema }, errors: [400, 401, 403] }), requireEfetivoManager, asyncHandler(async (req, res) => {
  const payload = absenceCreateSchema.parse(req.body);
  res.status(201).json(await createWorkforceAbsence(prisma, payload, planningContext(req)));
}));

defineRoute(router, efetivoRoute('PATCH /ausencias/:id', { summary: 'Atualizar ausência pelo Efetivo', tag: 'efetivo', body: absenceUpdateSchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404, 409] }), requireEfetivoManager, asyncHandler(async (req, res) => {
  const id = collaboratorIdSchema.parse(req.params.id);
  const payload = absenceUpdateSchema.parse(req.body);
  const expectedVersion = z.coerce.number().int().min(1).parse(req.get('If-Match-Version'));
  res.json(await updateWorkforceAbsence(prisma, id, payload, { ...planningContext(req), expectedVersion }));
}));

defineRoute(router, efetivoRoute('DELETE /ausencias/:id', { summary: 'Excluir ausência pelo Efetivo', tag: 'efetivo', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 204: EMPTY }, errors: [400, 401, 403, 404, 409] }), requireEfetivoManager, asyncHandler(async (req, res) => {
  const id = collaboratorIdSchema.parse(req.params.id);
  const expectedVersion = z.coerce.number().int().min(1).parse(req.get('If-Match-Version'));
  await deleteWorkforceAbsence(prisma, id, { ...planningContext(req), expectedVersion });
  res.status(204).end();
}));

export default router;
