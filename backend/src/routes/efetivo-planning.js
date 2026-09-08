import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../lib/async-handler.js';
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
  mobilizationCycleInputSchema,
  missionScheduleStatusSchema,
  missionStageSchema,
  plannedHireInputSchema,
  planningSettingsInputSchema,
  scenarioInputSchema,
  stageInputSchema
} from '../lib/efetivo/planning/schemas.js';

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
const scenarioCompareSchema = datePositionQuerySchema;
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

router.get('/projects', requireEfetivoViewer, asyncHandler(async (req, res) => {
  res.json(await listPlanningProjects(listQuerySchema.parse(req.query)));
}));

router.get('/job-roles', requireEfetivoViewer, asyncHandler(async (_req, res) => {
  res.json(await listPlanningJobRoles());
}));

router.get('/coordinators', requireEfetivoViewer, asyncHandler(async (_req, res) => {
  res.json(await listPlanningCoordinators());
}));

router.get('/overview', requireEfetivoViewer, asyncHandler(async (req, res) => {
  res.json(await getPlanningOverview(datePositionQuerySchema.parse(req.query)));
}));

router.get('/calendar', requireEfetivoViewer, asyncHandler(async (req, res) => {
  res.json(await getPlanningCalendar(intervalQuerySchema.parse(req.query)));
}));

router.get('/collaborators', requireEfetivoViewer, asyncHandler(async (req, res) => {
  res.json(await listPlanningCollaborators(collaboratorListQuerySchema.parse(req.query)));
}));

router.post('/collaborators', requireEfetivoManager, asyncHandler(async (req, res) => {
  const collaborator = await createPlanningCollaborator(collaboratorInputSchema.parse(req.body), context(req));
  collaboratorsCache.clear();
  res.status(201).json(collaborator);
}));

router.patch('/collaborators/:collaboratorId', requireEfetivoManager, asyncHandler(async (req, res) => {
  const collaborator = await updatePlanningCollaborator(idSchema.parse(req.params.collaboratorId), collaboratorInputSchema.parse(req.body), context(req));
  collaboratorsCache.clear();
  res.json(collaborator);
}));

router.get('/absences', requireEfetivoViewer, asyncHandler(async (req, res) => {
  res.json(await listWorkforceAbsences(prisma, absenceListQuerySchema.parse(req.query)));
}));

router.post('/absences', requireEfetivoManager, asyncHandler(async (req, res) => {
  res.status(201).json(await createWorkforceAbsence(prisma, absenceInputSchema.parse(req.body), context(req)));
}));

router.patch('/absences/:absenceId', requireEfetivoManager, asyncHandler(async (req, res) => {
  const expectedVersion = z.coerce.number().int().min(1).parse(req.get('If-Match-Version'));
  res.json(await updateWorkforceAbsence(prisma, idSchema.parse(req.params.absenceId), absenceUpdateSchema.parse(req.body), { ...context(req), expectedVersion }));
}));

router.delete('/absences/:absenceId', requireEfetivoManager, asyncHandler(async (req, res) => {
  const expectedVersion = z.coerce.number().int().min(1).parse(req.get('If-Match-Version'));
  await deleteWorkforceAbsence(prisma, idSchema.parse(req.params.absenceId), { ...context(req), expectedVersion });
  res.status(204).end();
}));

router.get('/missions', requireEfetivoViewer, asyncHandler(async (req, res) => {
  res.json(await listMissions(missionListQuerySchema.parse(req.query)));
}));

router.post('/missions', requireEfetivoManager, asyncHandler(async (req, res) => {
  res.status(201).json(await createMission(missionInputSchema.parse(req.body), context(req)));
}));

router.get('/missions/pending', requireEfetivoViewer, asyncHandler(async (req, res) => {
  res.json(await listPendingMissionProjects(missionPendingQuerySchema.parse(req.query)));
}));

router.get('/missions/:missionId', requireEfetivoViewer, asyncHandler(async (req, res) => {
  res.json(await getMission(idSchema.parse(req.params.missionId)));
}));

router.get('/missions/:missionId/execution', requireEfetivoViewer, asyncHandler(async (req, res) => {
  res.json(await getMissionExecutionComparison(idSchema.parse(req.params.missionId), {
    loadProgress: computeProjectProgress
  }));
}));

router.patch('/missions/:missionId', requireEfetivoManager, asyncHandler(async (req, res) => {
  const version = z.coerce.number().int().min(1).parse(req.get('If-Match-Version'));
  res.json(await updateMission(idSchema.parse(req.params.missionId), missionInputSchema.parse(req.body), { ...context(req), version }));
}));

router.delete('/missions/:missionId', requireEfetivoManager, asyncHandler(async (req, res) => {
  await deleteMission(idSchema.parse(req.params.missionId), context(req));
  res.status(204).end();
}));

router.post('/missions/:missionId/cycles', requireEfetivoManager, asyncHandler(async (req, res) => {
  res.status(201).json(await createMissionCycle(
    idSchema.parse(req.params.missionId),
    mobilizationCycleInputSchema.parse(req.body),
    context(req)
  ));
}));

router.patch('/missions/:missionId/cycles/:cycleId', requireEfetivoManager, asyncHandler(async (req, res) => {
  res.json(await updateMissionCycle(
    idSchema.parse(req.params.missionId),
    idSchema.parse(req.params.cycleId),
    mobilizationCycleInputSchema.parse(req.body),
    context(req)
  ));
}));

router.get('/missions/:missionId/eligible-collaborators', requireEfetivoViewer, asyncHandler(async (req, res) => {
  const filters = eligibleCollaboratorsQuerySchema.parse(req.query);
  res.json(await listEligibleCollaborators(idSchema.parse(req.params.missionId), filters.jobRoleId, filters));
}));

router.post('/missions/:missionId/allocations', requireEfetivoManager, asyncHandler(async (req, res) => {
  res.status(201).json(await addMissionAllocation(idSchema.parse(req.params.missionId), allocationInputSchema.parse(req.body), context(req)));
}));

router.patch('/missions/:missionId/allocations/:allocationId', requireEfetivoManager, asyncHandler(async (req, res) => {
  res.json(await updateMissionAllocationPeriod(
    idSchema.parse(req.params.missionId),
    idSchema.parse(req.params.allocationId),
    allocationPeriodInputSchema.parse(req.body),
    context(req)
  ));
}));

router.post('/missions/:missionId/allocations/:allocationId/cycles', requireEfetivoManager, asyncHandler(async (req, res) => {
  res.status(201).json(await createAllocationCycle(
    idSchema.parse(req.params.missionId),
    idSchema.parse(req.params.allocationId),
    mobilizationCycleInputSchema.parse(req.body),
    context(req)
  ));
}));

router.post('/missions/:missionId/allocations/:allocationId/cycles/inherit', requireEfetivoManager, asyncHandler(async (req, res) => {
  res.status(201).json(await initializeAllocationCycles(
    idSchema.parse(req.params.missionId),
    idSchema.parse(req.params.allocationId),
    context(req)
  ));
}));

router.patch('/missions/:missionId/allocations/:allocationId/cycles/:cycleId', requireEfetivoManager, asyncHandler(async (req, res) => {
  res.json(await updateAllocationCycle(
    idSchema.parse(req.params.missionId),
    idSchema.parse(req.params.allocationId),
    idSchema.parse(req.params.cycleId),
    mobilizationCycleInputSchema.parse(req.body),
    context(req)
  ));
}));

router.delete('/missions/:missionId/allocations/:allocationId/cycles/:cycleId', requireEfetivoManager, asyncHandler(async (req, res) => {
  await deleteAllocationCycle(
    idSchema.parse(req.params.missionId),
    idSchema.parse(req.params.allocationId),
    idSchema.parse(req.params.cycleId),
    context(req)
  );
  res.status(204).end();
}));

router.delete('/missions/:missionId/allocations/:allocationId', requireEfetivoManager, asyncHandler(async (req, res) => {
  await removeMissionAllocation(idSchema.parse(req.params.missionId), idSchema.parse(req.params.allocationId), context(req));
  res.status(204).end();
}));

router.post('/missions/:missionId/auto-allocate', requireEfetivoManager, asyncHandler(async (req, res) => {
  res.json(await autoAllocateMission(idSchema.parse(req.params.missionId), context(req)));
}));

router.patch('/missions/:missionId/stage', requireEfetivoManager, asyncHandler(async (req, res) => {
  const version = z.coerce.number().int().min(1).parse(req.get('If-Match-Version'));
  res.json(await moveMissionStage(idSchema.parse(req.params.missionId), stageInputSchema.parse(req.body), { ...context(req), version }));
}));

router.get('/scenarios', requireEfetivoViewer, asyncHandler(async (_req, res) => {
  res.json(await listScenarios());
}));

router.post('/scenarios', requireEfetivoManager, asyncHandler(async (req, res) => {
  res.status(201).json(await createScenario(scenarioInputSchema.parse(req.body), context(req)));
}));

router.get('/scenarios/:scenarioId/compare', requireEfetivoViewer, asyncHandler(async (req, res) => {
  res.json(await compareScenario(idSchema.parse(req.params.scenarioId), scenarioCompareSchema.parse(req.query)));
}));

router.post('/scenarios/:scenarioId/hires', requireEfetivoManager, asyncHandler(async (req, res) => {
  res.status(201).json(await saveScenarioHire(idSchema.parse(req.params.scenarioId), plannedHireInputSchema.parse(req.body), context(req)));
}));

router.post('/scenarios/:scenarioId/apply', requireEfetivoManager, asyncHandler(async (req, res) => {
  res.json(await applyScenario(idSchema.parse(req.params.scenarioId), context(req)));
}));

router.post('/scenarios/:scenarioId/discard', requireEfetivoManager, asyncHandler(async (req, res) => {
  res.json(await discardScenario(idSchema.parse(req.params.scenarioId), context(req)));
}));

router.patch('/admin/job-roles/:jobRoleId', requireEfetivoManager, asyncHandler(async (req, res) => {
  res.json(await updatePlanningJobRole(idSchema.parse(req.params.jobRoleId), jobRolePlanningInputSchema.parse(req.body), context(req)));
}));

router.get('/admin/holidays', requireEfetivoViewer, asyncHandler(async (req, res) => {
  res.json(await listHolidays(holidayListSchema.parse(req.query)));
}));

router.post('/admin/holidays', requireEfetivoManager, asyncHandler(async (req, res) => {
  res.status(201).json(await saveHoliday(holidayInputSchema.parse(req.body), context(req)));
}));

router.patch('/admin/holidays/:holidayId', requireEfetivoManager, asyncHandler(async (req, res) => {
  res.json(await updateHoliday(idSchema.parse(req.params.holidayId), holidayInputSchema.parse(req.body), context(req)));
}));

router.delete('/admin/holidays/:holidayId', requireEfetivoManager, asyncHandler(async (req, res) => {
  await deleteHoliday(idSchema.parse(req.params.holidayId), context(req));
  res.status(204).end();
}));

router.get('/admin/settings', requireEfetivoViewer, asyncHandler(async (_req, res) => {
  res.json(await getPlanningSettings());
}));

router.patch('/admin/settings', requireEfetivoManager, asyncHandler(async (req, res) => {
  res.json(await updatePlanningSettings(planningSettingsInputSchema.parse(req.body), context(req)));
}));

router.get('/admin/activity', requireEfetivoViewer, asyncHandler(async (req, res) => {
  res.json(await listPlanningActivity(activitySchema.parse(req.query)));
}));

router.get('/admin/users', requireEfetivoViewer, asyncHandler(async (_req, res) => {
  res.json(await listEfetivoRoleUsers());
}));

export default router;
