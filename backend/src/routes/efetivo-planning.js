import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../lib/async-handler.js';
import { getConectaCompliance } from '../lib/conecta-rh/service.js';
import { createEfetivoRhRouter } from './efetivo-rh.js';
import { requireEfetivoManager, requireEfetivoViewer } from '../lib/efetivo/access.js';
import {
  deleteHoliday,
  getPlanningSettings,
  listEfetivoRoleUsers,
  listHolidays,
  listPlanningActivity,
  saveHoliday,
  updateHoliday,
  updatePlanningJobRole,
  updatePlanningSettings
} from '../lib/efetivo/planning/administration.js';
import { listNotificationEmailSettings, setNotificationEmailSetting } from '../lib/efetivo/notification-email-settings.js';
import { makeNotificationEmailSettingSchema } from '../../../shared/schemas/notification-email-settings.js';
import {
  addMissionAllocation,
  listEligibleCollaborators,
  removeMissionAllocation,
  updateMissionAllocationPeriod
} from '../lib/efetivo/planning/allocations.js';
import { autoAllocateMission } from '../lib/efetivo/planning/auto-allocation.js';
import {
  createAllocationCycle,
  createMissionCycle,
  deleteAllocationCycle,
  initializeAllocationCycles,
  updateAllocationCycle,
  updateMissionCycle
} from '../lib/efetivo/planning/cycles.js';
import { getPlanningCalendar } from '../lib/efetivo/planning/calendar.js';
import { getPlanningAvailabilityPeriod } from '../lib/efetivo/planning/availability-period.js';
import {
  createPlanningCollaborator,
  updatePlanningCollaborator
} from '../lib/efetivo/planning/collaborators.js';
import {
  createWorkforceAbsence,
  deleteWorkforceAbsence,
  listWorkforceAbsences,
  updateWorkforceAbsence
} from '../lib/collaborators/availability-service.js';
import prisma from '../lib/prisma.js';
import { collaboratorsCache } from '../lib/resource-list-cache.js';
import {
  createMission,
  deleteMission,
  getMission,
  listMissions,
  moveMissionStage,
  updateMission
} from '../lib/efetivo/planning/mission-planning.js';
import { requestEvidence } from '../lib/efetivo/planning/plan-context.js';
import { getMissionExecutionComparison } from '../lib/efetivo/planning/execution-comparison.js';
import { deleteMissionWeeklyProgressTarget, getMissionWeeklyProgressTargets, saveMissionWeeklyProgressTarget } from '../lib/efetivo/planning/weekly-progress-targets.js';
import { computeProjectProgress } from '../lib/acompanhamento/avanco.js';
import {
  getPlanningOverview,
  listPendingMissionProjects,
  listPlanningCollaborators,
  listPlanningCoordinators,
  listPlanningJobRoles,
  listPlanningProjects
} from '../lib/efetivo/planning/read-model.js';
import {
  applyScenario,
  compareScenario,
  createScenario,
  discardScenario,
  listScenarios,
  saveScenarioHire
} from '../lib/efetivo/planning/scenarios.js';
import {
  absenceInputSchema,
  absenceUpdateSchema,
  allocationInputSchema,
  allocationPeriodInputSchema,
  collaboratorInputSchema,
  dateOnlySchema,
  datePositionQuerySchema,
  holidayInputSchema,
  idSchema,
  intervalQuerySchema,
  jobRolePlanningInputSchema,
  missionInputSchema,
  missionUpdateInputSchema,
  mobilizationCycleInputSchema,
  missionScheduleStatusSchema,
  missionStageSchema,
  plannedHireInputSchema,
  planningSettingsInputSchema,
  scenarioInputSchema,
  stageInputSchema
} from '../lib/efetivo/planning/schemas.js';
import { defineRoute } from '../lib/api-contract/registry.js';
import { EMPTY, efetivoRoute, jsonResponseSchema, libValidatedBodySchema } from '../lib/api-contract/domains/efetivo.js';

const router = Router();
const listQuerySchema = z.object({ search: z.string().trim().max(120).optional() });
const missionListQuerySchema = z.object({
  planId: idSchema.optional(),
  status: missionScheduleStatusSchema.optional(),
  stage: missionStageSchema.optional()
});
const missionPendingQuerySchema = z.object({ planId: idSchema.optional() });
const includeInactiveQuerySchema = z.enum(['true', 'false']).optional().transform(value => value === 'true');
const collaboratorListQuerySchema = datePositionQuerySchema.extend({
  search: z.string().trim().max(120).optional(),
  includeInactive: includeInactiveQuerySchema
});
const absenceListQuerySchema = z.object({
  collaboratorId: idSchema.optional(),
  startDate: dateOnlySchema.optional(),
  endDate: dateOnlySchema.optional()
});
const scenarioCompareSchema = z
  .object({
    date: dateOnlySchema.optional(),
    returnDate: dateOnlySchema.optional(),
    jobRoleId: idSchema.optional(),
  })
  .refine((value) => !value.date || !value.returnDate || value.returnDate >= value.date, {
    path: ['returnDate'],
    message: 'A data de retorno deve ser igual ou posterior à data de posição',
  });
const holidayListSchema = z.object({ startDate: dateOnlySchema.optional(), endDate: dateOnlySchema.optional() });
const activitySchema = z.object({ cursor: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(100).optional() });
const eligibleCollaboratorsQuerySchema = z.object({
  jobRoleId: idSchema,
  includeInactive: includeInactiveQuerySchema,
  mobilizationDate: dateOnlySchema.optional(),
  demobilizationDate: dateOnlySchema.optional()
}).refine(value => !value.mobilizationDate || !value.demobilizationDate || value.demobilizationDate >= value.mobilizationDate, {
  path: ['demobilizationDate'],
  message: 'A desmobilização individual não pode ser anterior à mobilização.'
});

function context(req) {
  return { actorUserId: req.auth?.user?.id || null, evidence: requestEvidence(req) };
}

defineRoute(router, efetivoRoute('GET /projects', { summary: 'Projetos disponíveis para o planejamento', tag: 'efetivo', query: listQuerySchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  res.json(await listPlanningProjects(listQuerySchema.parse(req.query)));
}));

defineRoute(router, efetivoRoute('GET /job-roles', { summary: 'Cargos usados no planejamento', tag: 'efetivo', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), requireEfetivoViewer, asyncHandler(async (_req, res) => {
  res.json(await listPlanningJobRoles());
}));

defineRoute(router, efetivoRoute('GET /coordinators', { summary: 'Coordenadores disponíveis para missões', tag: 'efetivo', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), requireEfetivoViewer, asyncHandler(async (_req, res) => {
  res.json(await listPlanningCoordinators());
}));

defineRoute(router, efetivoRoute('GET /overview', { summary: 'Visão geral do efetivo numa data', tag: 'efetivo', query: datePositionQuerySchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  res.json(await getPlanningOverview(datePositionQuerySchema.parse(req.query)));
}));

defineRoute(router, efetivoRoute('GET /calendar', { summary: 'Calendário do planejamento no intervalo', tag: 'efetivo', query: intervalQuerySchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  res.json(await getPlanningCalendar(intervalQuerySchema.parse(req.query)));
}));

defineRoute(router, efetivoRoute('GET /availability', { summary: 'Disponibilidade dos colaboradores no intervalo', tag: 'efetivo', query: intervalQuerySchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  res.json(await getPlanningAvailabilityPeriod(intervalQuerySchema.parse(req.query)));
}));

defineRoute(router, efetivoRoute('GET /collaborators', { summary: 'Colaboradores do planejamento', tag: 'efetivo', query: collaboratorListQuerySchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  res.json(await listPlanningCollaborators(collaboratorListQuerySchema.parse(req.query)));
}));

router.use('/collaborators', createEfetivoRhRouter());

defineRoute(router, efetivoRoute('GET /collaborators/:collaboratorId/rh', { summary: 'Situação de documentos e exames (Conecta RH) do colaborador numa data', tag: 'efetivo', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  const id = idSchema.parse(req.params.collaboratorId);
  const date = dateOnlySchema.parse(req.query.date);
  const items = await getConectaCompliance(prisma, id, date);
  res.setHeader('Cache-Control', 'no-store');
  res.json(items.map(({ id, category, typeCode, title, status, issuedOn, expiresOn, hasNoExpiry }) => ({ id, category, typeCode, title, status, issuedOn, expiresOn, hasNoExpiry })));
}));

defineRoute(router, efetivoRoute('POST /collaborators', { summary: 'Cadastrar colaborador pelo planejamento', tag: 'efetivo', body: collaboratorInputSchema, responses: { 201: jsonResponseSchema }, errors: [400, 401, 403] }), requireEfetivoManager, asyncHandler(async (req, res) => {
  const collaborator = await createPlanningCollaborator(collaboratorInputSchema.parse(req.body), context(req));
  collaboratorsCache.clear();
  res.status(201).json(collaborator);
}));

defineRoute(router, efetivoRoute('PATCH /collaborators/:collaboratorId', { summary: 'Atualizar colaborador pelo planejamento', tag: 'efetivo', body: collaboratorInputSchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoManager, asyncHandler(async (req, res) => {
  const collaborator = await updatePlanningCollaborator(idSchema.parse(req.params.collaboratorId), collaboratorInputSchema.parse(req.body), context(req));
  collaboratorsCache.clear();
  res.json(collaborator);
}));

defineRoute(router, efetivoRoute('GET /absences', { summary: 'Ausências no planejamento', tag: 'efetivo', query: absenceListQuerySchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  res.json(await listWorkforceAbsences(prisma, absenceListQuerySchema.parse(req.query)));
}));

defineRoute(router, efetivoRoute('POST /absences', { summary: 'Registrar ausência', tag: 'efetivo', body: absenceInputSchema, responses: { 201: jsonResponseSchema }, errors: [400, 401, 403] }), requireEfetivoManager, asyncHandler(async (req, res) => {
  res.status(201).json(await createWorkforceAbsence(prisma, absenceInputSchema.parse(req.body), context(req)));
}));

defineRoute(router, efetivoRoute('PATCH /absences/:absenceId', { summary: 'Atualizar ausência (exige If-Match-Version)', tag: 'efetivo', body: absenceUpdateSchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404, 409] }), requireEfetivoManager, asyncHandler(async (req, res) => {
  const expectedVersion = z.coerce.number().int().min(1).parse(req.get('If-Match-Version'));
  res.json(await updateWorkforceAbsence(prisma, idSchema.parse(req.params.absenceId), absenceUpdateSchema.parse(req.body), { ...context(req), expectedVersion }));
}));

defineRoute(router, efetivoRoute('DELETE /absences/:absenceId', { summary: 'Excluir ausência (exige If-Match-Version)', tag: 'efetivo', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 204: EMPTY }, errors: [400, 401, 403, 404, 409] }), requireEfetivoManager, asyncHandler(async (req, res) => {
  const expectedVersion = z.coerce.number().int().min(1).parse(req.get('If-Match-Version'));
  await deleteWorkforceAbsence(prisma, idSchema.parse(req.params.absenceId), { ...context(req), expectedVersion });
  res.status(204).end();
}));

defineRoute(router, efetivoRoute('GET /missions', { summary: 'Missões do planejamento', tag: 'efetivo', query: missionListQuerySchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  res.json(await listMissions(missionListQuerySchema.parse(req.query)));
}));

defineRoute(router, efetivoRoute('POST /missions', { summary: 'Criar missão', tag: 'efetivo', body: missionInputSchema, responses: { 201: jsonResponseSchema }, errors: [400, 401, 403] }), requireEfetivoManager, asyncHandler(async (req, res) => {
  res.status(201).json(await createMission(missionInputSchema.parse(req.body), context(req)));
}));

defineRoute(router, efetivoRoute('GET /missions/pending', { summary: 'Projetos com missão pendente', tag: 'efetivo', query: missionPendingQuerySchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  res.json(await listPendingMissionProjects(missionPendingQuerySchema.parse(req.query)));
}));

defineRoute(router, efetivoRoute('GET /missions/:missionId', { summary: 'Detalhe da missão', tag: 'efetivo', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  res.json(await getMission(idSchema.parse(req.params.missionId)));
}));

defineRoute(router, efetivoRoute('GET /missions/:missionId/execution', { summary: 'Comparação entre planejado e executado da missão', tag: 'efetivo', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  res.json(await getMissionExecutionComparison(idSchema.parse(req.params.missionId), {
    loadProgress: computeProjectProgress
  }));
}));

defineRoute(router, efetivoRoute('GET /missions/:missionId/weekly-targets', { summary: 'Metas semanais da missão', tag: 'efetivo', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  res.json(await getMissionWeeklyProgressTargets(idSchema.parse(req.params.missionId), { includeServices: req.query.services === 'true' }));
}));

defineRoute(router, efetivoRoute('PUT /missions/:missionId/weekly-targets', { summary: 'Salvar meta semanal da missão', tag: 'efetivo', body: libValidatedBodySchema, validatedBy: 'serviço (lib) chamado pelo handler', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoManager, asyncHandler(async (req, res) => {
  res.json(await saveMissionWeeklyProgressTarget(idSchema.parse(req.params.missionId), req.body, {
    userId: req.auth.user.id, userName: req.auth.user.name
  }));
}));

defineRoute(router, efetivoRoute('DELETE /missions/:missionId/weekly-targets', { summary: 'Excluir meta semanal da missão', tag: 'efetivo', body: libValidatedBodySchema, validatedBy: 'serviço (lib) chamado pelo handler', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoManager, asyncHandler(async (req, res) => {
  res.json(await deleteMissionWeeklyProgressTarget(idSchema.parse(req.params.missionId), req.body, {
    userId: req.auth.user.id, userName: req.auth.user.name
  }));
}));

defineRoute(router, efetivoRoute('PATCH /missions/:missionId', { summary: 'Atualizar missão', tag: 'efetivo', body: missionUpdateInputSchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404, 409] }), requireEfetivoManager, asyncHandler(async (req, res) => {
  const version = z.coerce.number().int().min(1).parse(req.get('If-Match-Version'));
  res.json(await updateMission(idSchema.parse(req.params.missionId), missionUpdateInputSchema.parse(req.body), { ...context(req), version }));
}));

defineRoute(router, efetivoRoute('DELETE /missions/:missionId', { summary: 'Excluir missão', tag: 'efetivo', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 204: EMPTY }, errors: [400, 401, 403, 404] }), requireEfetivoManager, asyncHandler(async (req, res) => {
  await deleteMission(idSchema.parse(req.params.missionId), context(req));
  res.status(204).end();
}));

defineRoute(router, efetivoRoute('POST /missions/:missionId/cycles', { summary: 'Criar ciclo de mobilização da missão', tag: 'efetivo', body: mobilizationCycleInputSchema, responses: { 201: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoManager, asyncHandler(async (req, res) => {
  res.status(201).json(await createMissionCycle(
    idSchema.parse(req.params.missionId),
    mobilizationCycleInputSchema.parse(req.body),
    context(req)
  ));
}));

defineRoute(router, efetivoRoute('PATCH /missions/:missionId/cycles/:cycleId', { summary: 'Atualizar ciclo de mobilização da missão', tag: 'efetivo', body: mobilizationCycleInputSchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoManager, asyncHandler(async (req, res) => {
  res.json(await updateMissionCycle(
    idSchema.parse(req.params.missionId),
    idSchema.parse(req.params.cycleId),
    mobilizationCycleInputSchema.parse(req.body),
    context(req)
  ));
}));

defineRoute(router, efetivoRoute('GET /missions/:missionId/eligible-collaborators', { summary: 'Colaboradores elegíveis para a missão', tag: 'efetivo', query: eligibleCollaboratorsQuerySchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  const filters = eligibleCollaboratorsQuerySchema.parse(req.query);
  res.json(await listEligibleCollaborators(idSchema.parse(req.params.missionId), filters.jobRoleId, filters));
}));

defineRoute(router, efetivoRoute('POST /missions/:missionId/allocations', { summary: 'Alocar colaborador na missão', tag: 'efetivo', body: allocationInputSchema, responses: { 201: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoManager, asyncHandler(async (req, res) => {
  res.status(201).json(await addMissionAllocation(idSchema.parse(req.params.missionId), allocationInputSchema.parse(req.body), context(req)));
}));

defineRoute(router, efetivoRoute('PATCH /missions/:missionId/allocations/:allocationId', { summary: 'Alterar o período da alocação', tag: 'efetivo', body: allocationPeriodInputSchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoManager, asyncHandler(async (req, res) => {
  res.json(await updateMissionAllocationPeriod(
    idSchema.parse(req.params.missionId),
    idSchema.parse(req.params.allocationId),
    allocationPeriodInputSchema.parse(req.body),
    context(req)
  ));
}));

defineRoute(router, efetivoRoute('POST /missions/:missionId/allocations/:allocationId/cycles', { summary: 'Criar ciclo individual da alocação', tag: 'efetivo', body: mobilizationCycleInputSchema, responses: { 201: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoManager, asyncHandler(async (req, res) => {
  res.status(201).json(await createAllocationCycle(
    idSchema.parse(req.params.missionId),
    idSchema.parse(req.params.allocationId),
    mobilizationCycleInputSchema.parse(req.body),
    context(req)
  ));
}));

defineRoute(router, efetivoRoute('POST /missions/:missionId/allocations/:allocationId/cycles/inherit', { summary: 'Herdar os ciclos da missão na alocação', tag: 'efetivo', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 201: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoManager, asyncHandler(async (req, res) => {
  res.status(201).json(await initializeAllocationCycles(
    idSchema.parse(req.params.missionId),
    idSchema.parse(req.params.allocationId),
    context(req)
  ));
}));

defineRoute(router, efetivoRoute('PATCH /missions/:missionId/allocations/:allocationId/cycles/:cycleId', { summary: 'Atualizar ciclo individual da alocação', tag: 'efetivo', body: mobilizationCycleInputSchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoManager, asyncHandler(async (req, res) => {
  res.json(await updateAllocationCycle(
    idSchema.parse(req.params.missionId),
    idSchema.parse(req.params.allocationId),
    idSchema.parse(req.params.cycleId),
    mobilizationCycleInputSchema.parse(req.body),
    context(req)
  ));
}));

defineRoute(router, efetivoRoute('DELETE /missions/:missionId/allocations/:allocationId/cycles/:cycleId', { summary: 'Excluir ciclo individual da alocação', tag: 'efetivo', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 204: EMPTY }, errors: [400, 401, 403, 404] }), requireEfetivoManager, asyncHandler(async (req, res) => {
  await deleteAllocationCycle(
    idSchema.parse(req.params.missionId),
    idSchema.parse(req.params.allocationId),
    idSchema.parse(req.params.cycleId),
    context(req)
  );
  res.status(204).end();
}));

defineRoute(router, efetivoRoute('DELETE /missions/:missionId/allocations/:allocationId', { summary: 'Remover colaborador da missão', tag: 'efetivo', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 204: EMPTY }, errors: [400, 401, 403, 404] }), requireEfetivoManager, asyncHandler(async (req, res) => {
  await removeMissionAllocation(idSchema.parse(req.params.missionId), idSchema.parse(req.params.allocationId), context(req));
  res.status(204).end();
}));

defineRoute(router, efetivoRoute('POST /missions/:missionId/auto-allocate', { summary: 'Alocar automaticamente a equipe da missão', tag: 'efetivo', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoManager, asyncHandler(async (req, res) => {
  res.json(await autoAllocateMission(idSchema.parse(req.params.missionId), context(req)));
}));

defineRoute(router, efetivoRoute('PATCH /missions/:missionId/stage', { summary: 'Mover a missão de etapa', tag: 'efetivo', body: stageInputSchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404, 409] }), requireEfetivoManager, asyncHandler(async (req, res) => {
  const version = z.coerce.number().int().min(1).parse(req.get('If-Match-Version'));
  res.json(await moveMissionStage(idSchema.parse(req.params.missionId), stageInputSchema.parse(req.body), { ...context(req), version }));
}));

defineRoute(router, efetivoRoute('GET /scenarios', { summary: 'Cenários de planejamento', tag: 'efetivo', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), requireEfetivoViewer, asyncHandler(async (_req, res) => {
  res.json(await listScenarios());
}));

defineRoute(router, efetivoRoute('POST /scenarios', { summary: 'Criar cenário', tag: 'efetivo', body: scenarioInputSchema, responses: { 201: jsonResponseSchema }, errors: [400, 401, 403] }), requireEfetivoManager, asyncHandler(async (req, res) => {
  res.status(201).json(await createScenario(scenarioInputSchema.parse(req.body), context(req)));
}));

defineRoute(router, efetivoRoute('GET /scenarios/:scenarioId/compare', { summary: 'Comparar cenário com o planejamento atual', tag: 'efetivo', query: scenarioCompareSchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  res.json(await compareScenario(idSchema.parse(req.params.scenarioId), scenarioCompareSchema.parse(req.query)));
}));

defineRoute(router, efetivoRoute('POST /scenarios/:scenarioId/hires', { summary: 'Registrar contratação prevista no cenário', tag: 'efetivo', body: plannedHireInputSchema, responses: { 201: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoManager, asyncHandler(async (req, res) => {
  res.status(201).json(await saveScenarioHire(idSchema.parse(req.params.scenarioId), plannedHireInputSchema.parse(req.body), context(req)));
}));

defineRoute(router, efetivoRoute('POST /scenarios/:scenarioId/apply', { summary: 'Aplicar cenário ao planejamento', tag: 'efetivo', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoManager, asyncHandler(async (req, res) => {
  res.json(await applyScenario(idSchema.parse(req.params.scenarioId), context(req)));
}));

defineRoute(router, efetivoRoute('POST /scenarios/:scenarioId/discard', { summary: 'Descartar cenário', tag: 'efetivo', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoManager, asyncHandler(async (req, res) => {
  res.json(await discardScenario(idSchema.parse(req.params.scenarioId), context(req)));
}));

defineRoute(router, efetivoRoute('PATCH /admin/job-roles/:jobRoleId', { summary: 'Configurar cargo no planejamento', tag: 'efetivo', body: jobRolePlanningInputSchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoManager, asyncHandler(async (req, res) => {
  res.json(await updatePlanningJobRole(idSchema.parse(req.params.jobRoleId), jobRolePlanningInputSchema.parse(req.body), context(req)));
}));

defineRoute(router, efetivoRoute('GET /admin/holidays', { summary: 'Feriados do planejamento', tag: 'efetivo', query: holidayListSchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  res.json(await listHolidays(holidayListSchema.parse(req.query)));
}));

defineRoute(router, efetivoRoute('POST /admin/holidays', { summary: 'Cadastrar feriado', tag: 'efetivo', body: holidayInputSchema, responses: { 201: jsonResponseSchema }, errors: [400, 401, 403] }), requireEfetivoManager, asyncHandler(async (req, res) => {
  res.status(201).json(await saveHoliday(holidayInputSchema.parse(req.body), context(req)));
}));

defineRoute(router, efetivoRoute('PATCH /admin/holidays/:holidayId', { summary: 'Atualizar feriado', tag: 'efetivo', body: holidayInputSchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEfetivoManager, asyncHandler(async (req, res) => {
  res.json(await updateHoliday(idSchema.parse(req.params.holidayId), holidayInputSchema.parse(req.body), context(req)));
}));

defineRoute(router, efetivoRoute('DELETE /admin/holidays/:holidayId', { summary: 'Excluir feriado', tag: 'efetivo', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 204: EMPTY }, errors: [400, 401, 403, 404] }), requireEfetivoManager, asyncHandler(async (req, res) => {
  await deleteHoliday(idSchema.parse(req.params.holidayId), context(req));
  res.status(204).end();
}));

defineRoute(router, efetivoRoute('GET /admin/settings', { summary: 'Parâmetros do planejamento', tag: 'efetivo', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), requireEfetivoViewer, asyncHandler(async (_req, res) => {
  res.json(await getPlanningSettings());
}));

defineRoute(router, efetivoRoute('PATCH /admin/settings', { summary: 'Atualizar parâmetros do planejamento', tag: 'efetivo', body: planningSettingsInputSchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), requireEfetivoManager, asyncHandler(async (req, res) => {
  res.json(await updatePlanningSettings(planningSettingsInputSchema.parse(req.body), context(req)));
}));

const notificationEmailSettingSchema = makeNotificationEmailSettingSchema(z);

defineRoute(router, efetivoRoute('GET /admin/notification-emails', { summary: 'Configuração dos e-mails de notificação do Efetivo', tag: 'efetivo', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), requireEfetivoViewer, asyncHandler(async (_req, res) => {
  res.json(await listNotificationEmailSettings());
}));

defineRoute(router, efetivoRoute('PATCH /admin/notification-emails', { summary: 'Ativar ou desativar e-mail de notificação do Efetivo', tag: 'efetivo', body: notificationEmailSettingSchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), requireEfetivoManager, asyncHandler(async (req, res) => {
  const payload = notificationEmailSettingSchema.parse(req.body);
  res.json(await setNotificationEmailSetting(payload.purpose, payload.email, context(req).actorUserId));
}));

defineRoute(router, efetivoRoute('GET /admin/activity', { summary: 'Histórico de atividades do planejamento', tag: 'efetivo', query: activitySchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), requireEfetivoViewer, asyncHandler(async (req, res) => {
  res.json(await listPlanningActivity(activitySchema.parse(req.query)));
}));

defineRoute(router, efetivoRoute('GET /admin/users', { summary: 'Usuários com papel no Efetivo', tag: 'efetivo', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), requireEfetivoViewer, asyncHandler(async (_req, res) => {
  res.json(await listEfetivoRoleUsers());
}));

export default router;
