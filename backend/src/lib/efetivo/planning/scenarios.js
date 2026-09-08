import { recordEfetivoAudit } from './audit.js';
import { collaboratorIsEmployedForPeriod } from './conflicts.js';
import { parseDateKey, periodsOverlap } from './date-only.js';
import { conflictDescriptor, conflictError, notFound } from './errors.js';
import { allocationPeriods, maximumConcurrentAllocationCount } from './allocation-period.js';
import { normalizeMissionDemands, validateMissionChronology } from './mission-planning.js';
import { getActiveOfficialPlan, lockOfficialPlanningState, lockPlan, resolvePlanningDatabase, runPlanningTransaction } from './plan-context.js';
import { getPlanningOverview } from './read-model.js';
import { missionEndDate } from './mission-period.js';

function utcDate(value) {
  return new Date(`${parseDateKey(value)}T00:00:00.000Z`);
}

async function clonePlanGraph(tx, sourcePlanId, planData) {
  const source = await tx.efetivoPlan.findUnique({
    where: { id: sourcePlanId },
    include: {
      missions: {
        where: { deletedAt: null },
        include: {
          cycles: true,
          demands: true,
          allocations: { where: { deletedAt: null }, include: { cycles: true } }
        }
      },
      plannedHires: true
    }
  });
  if (!source) throw notFound('Plano de origem não encontrado.');
  const target = await tx.efetivoPlan.create({ data: planData });
  for (const mission of source.missions) {
    await tx.efetivoMissionPlan.create({
      data: {
        planId: target.id,
        projectId: mission.projectId,
        scheduleStatus: mission.scheduleStatus,
        stage: mission.stage,
        headquartersResponsibleUserId: mission.headquartersResponsibleUserId,
        headquartersResponsibleName: mission.headquartersResponsibleName,
        headquartersResponsibleRole: mission.headquartersResponsibleRole,
        headquartersResponsibleCollaboratorId: mission.headquartersResponsibleCollaboratorId,
        mobilizationDate: mission.mobilizationDate,
        executionStartDate: mission.executionStartDate,
        executionEndDate: mission.executionEndDate,
        returnDate: mission.returnDate,
        version: mission.version,
        kanbanOrder: mission.kanbanOrder,
        createdByUserId: planData.createdByUserId || mission.createdByUserId,
        updatedByUserId: planData.createdByUserId || mission.updatedByUserId,
        cycles: {
          create: (mission.cycles || []).map(item => ({
            mobilizationDate: item.mobilizationDate,
            demobilizationDate: item.demobilizationDate,
            createdByUserId: planData.createdByUserId || item.createdByUserId
          }))
        },
        demands: { create: mission.demands.map(item => ({ jobRoleId: item.jobRoleId, requiredCount: item.requiredCount })) },
        allocations: {
          create: mission.allocations.map(item => ({
            collaboratorId: item.collaboratorId,
            jobRoleId: item.jobRoleId,
            jobRoleNameSnapshot: item.jobRoleNameSnapshot,
            mobilizationDate: item.mobilizationDate,
            demobilizationDate: item.demobilizationDate,
            allowMissionOverlap: item.allowMissionOverlap,
            source: 'SCENARIO_COPY',
            createdByUserId: planData.createdByUserId || item.createdByUserId,
            cycles: {
              create: (item.cycles || []).map(cycle => ({
                mobilizationDate: cycle.mobilizationDate,
                demobilizationDate: cycle.demobilizationDate,
                createdByUserId: planData.createdByUserId || cycle.createdByUserId
              }))
            }
          }))
        }
      }
    });
  }
  if (source.plannedHires.length) {
    await tx.efetivoPlannedHire.createMany({ data: source.plannedHires.map(item => ({
      planId: target.id,
      jobRoleId: item.jobRoleId,
      quantity: item.quantity,
      availableFrom: item.availableFrom
    })) });
  }
  return target;
}

export async function listScenarios(dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  return database.efetivoPlan.findMany({
    where: { kind: 'SCENARIO' },
    include: { _count: { select: { missions: true, plannedHires: true } } },
    orderBy: { createdAt: 'desc' }
  });
}

export async function createScenario(payload, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  return runPlanningTransaction(database, async tx => {
    await lockOfficialPlanningState(tx);
    const official = await getActiveOfficialPlan(tx, { create: true, actorUserId: context.actorUserId });
    await lockPlan(tx, official.id);
    const calendarState = await tx.workforceCalendarState.findUnique({ where: { id: 'global' } });
    const scenario = await clonePlanGraph(tx, official.id, {
      kind: 'SCENARIO',
      status: 'DRAFT',
      name: payload.name.trim(),
      objective: String(payload.objective || '').trim() || null,
      revision: 1,
      basePlanId: official.id,
      baseOfficialRevision: official.revision,
      baseCalendarRevision: calendarState?.revision || 1,
      createdByUserId: context.actorUserId || null
    });
    await recordEfetivoAudit(tx, {
      planId: scenario.id, actorUserId: context.actorUserId, action: 'SCENARIO_CREATE', entityType: 'SCENARIO', entityId: scenario.id,
      summary: `Cenário ${scenario.name} criado.`, afterData: scenario, evidence: context.evidence
    });
    if (payload.initialHire && payload.initialHire.quantity > 0) {
      await createScenarioHire(tx, scenario, payload.initialHire, context);
    }
    return scenario;
  }, { required: true });
}

async function createScenarioHire(tx, scenario, payload, context) {
  const role = await tx.jobRole.findFirst({ where: { id: payload.jobRoleId, isActive: true, isOperational: true } });
  if (!role) throw notFound('Função operacional não encontrada.');
  const hire = await tx.efetivoPlannedHire.upsert({
    where: { planId_jobRoleId_availableFrom: { planId: scenario.id, jobRoleId: payload.jobRoleId, availableFrom: utcDate(payload.availableFrom) } },
    create: { planId: scenario.id, jobRoleId: payload.jobRoleId, quantity: payload.quantity, availableFrom: utcDate(payload.availableFrom) },
    update: { quantity: payload.quantity }
  });
  await recordEfetivoAudit(tx, {
    planId: scenario.id,
    actorUserId: context.actorUserId,
    action: 'SCENARIO_HIRE_UPDATE',
    entityType: 'PLANNED_HIRE',
    entityId: hire.id,
    summary: `Contratação hipotética de ${role.name} atualizada.`,
    afterData: hire,
    evidence: context.evidence
  });
  return hire;
}

export async function saveScenarioHire(scenarioId, payload, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  return runPlanningTransaction(database, async tx => {
    const scenario = await tx.efetivoPlan.findUnique({ where: { id: scenarioId } });
    if (!scenario || scenario.kind !== 'SCENARIO') throw notFound('Cenário não encontrado.');
    await lockPlan(tx, scenario.id);
    if (scenario.status !== 'DRAFT') throw conflictError('O cenário está em estado somente leitura.', [], 'SCENARIO_READ_ONLY');
    const hire = await createScenarioHire(tx, scenario, payload, context);
    await tx.efetivoPlan.update({ where: { id: scenario.id }, data: { revision: { increment: 1 } } });
    return hire;
  }, { required: true });
}

export async function compareScenario(scenarioId, filters, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  const scenario = await database.efetivoPlan.findUnique({ where: { id: scenarioId } });
  if (!scenario || scenario.kind !== 'SCENARIO') throw notFound('Cenário não encontrado.');
  const official = await getActiveOfficialPlan(database, { create: true });
  const [officialOverview, scenarioOverview, calendarState] = await Promise.all([
    getPlanningOverview({ date: filters.date, jobRoleId: filters.jobRoleId, planId: official.id }, { database }),
    getPlanningOverview({ date: filters.date, jobRoleId: filters.jobRoleId, planId: scenario.id }, { database }),
    database.workforceCalendarState.findUnique({ where: { id: 'global' } })
  ]);
  const projectedCapacity = plannedHireCapacityOn(scenarioOverview.plannedHires, filters.date);
  return {
    official: officialOverview,
    scenario: { ...scenarioOverview, projectedHireCapacity: projectedCapacity },
    isStale: scenario.basePlanId !== official.id
      || scenario.baseOfficialRevision !== official.revision
      || scenario.baseCalendarRevision !== (calendarState?.revision || 1)
  };
}

export function plannedHireCapacityOn(plannedHires = [], date) {
  const position = parseDateKey(date);
  return plannedHires.reduce((sum, item) => parseDateKey(item.availableFrom) <= position ? sum + Number(item.quantity || 0) : sum, 0);
}

async function validateScenarioGraph(tx, scenario) {
  const missions = await tx.efetivoMissionPlan.findMany({
    where: { planId: scenario.id, deletedAt: null },
    include: {
      cycles: true,
      demands: true,
      allocations: {
        where: { deletedAt: null },
        include: { collaborator: true, cycles: true }
      }
    }
  });
  const absences = await tx.collaboratorAbsence.findMany({ where: { deletedAt: null } });
  const byCollaborator = new Map();
  const conflicts = [];
  for (const mission of missions) {
    validateMissionChronology(mission);
    normalizeMissionDemands(mission.demands, mission.scheduleStatus);
    if (mission.scheduleStatus !== 'CONFIRMED') continue;
    const periodsByRole = new Map();
    for (const allocation of mission.allocations) {
      for (const period of allocationPeriods(allocation, mission)) {
        const rolePeriods = periodsByRole.get(allocation.jobRoleId) || [];
        rolePeriods.push(period);
        periodsByRole.set(allocation.jobRoleId, rolePeriods);
        if (!collaboratorIsEmployedForPeriod(allocation.collaborator, period) || (allocation.collaborator.jobRoleId && allocation.collaborator.jobRoleId !== allocation.jobRoleId)) {
          conflicts.push(conflictDescriptor({ collaborator: allocation.collaborator, startDate: period.startDate, endDate: period.endDate, sourceType: 'EMPLOYMENT', sourceId: mission.id, entityPath: `/efetivo?section=simulacoes&cenario=${scenario.id}&missao=${mission.id}`, code: 'INVALID_COLLABORATOR' }));
        }
        for (const absence of absences.filter(item => item.collaboratorId === allocation.collaboratorId)) {
          if (periodsOverlap(period, absence)) conflicts.push(conflictDescriptor({ collaborator: allocation.collaborator, startDate: parseDateKey(absence.startDate), endDate: parseDateKey(absence.endDate), sourceType: 'ABSENCE', sourceId: absence.id, entityPath: `/efetivo?section=colaboradores&colaborador=${allocation.collaboratorId}&ausencia=${absence.id}`, code: 'ABSENCE_OVERLAP' }));
        }
        const intervals = byCollaborator.get(allocation.collaboratorId) || [];
        for (const other of intervals) {
          if (periodsOverlap(period, other.period) && !allocation.allowMissionOverlap && !other.allowMissionOverlap) {
            conflicts.push(conflictDescriptor({ collaborator: allocation.collaborator, startDate: parseDateKey(other.period.startDate), endDate: parseDateKey(other.period.endDate), sourceType: 'MISSION', sourceId: other.missionId, entityPath: `/efetivo?section=simulacoes&cenario=${scenario.id}&missao=${other.missionId}`, code: 'MISSION_OVERLAP' }));
          }
        }
        intervals.push({ missionId: mission.id, period, allowMissionOverlap: allocation.allowMissionOverlap });
        byCollaborator.set(allocation.collaboratorId, intervals);
      }
    }
    for (const [jobRoleId, periods] of periodsByRole) {
      const demand = mission.demands.find(item => item.jobRoleId === jobRoleId)?.requiredCount || 0;
      if (maximumConcurrentAllocationCount(periods) > demand) conflicts.push({ code: 'DEMAND_EXCEEDED', sourceType: 'DEMAND', sourceId: mission.id, startDate: parseDateKey(mission.mobilizationDate), endDate: missionEndDate(mission), entityPath: `/efetivo?section=simulacoes&cenario=${scenario.id}&missao=${mission.id}` });
    }
  }
  if (conflicts.length) throw conflictError('O cenário contém conflitos e não pode ser aplicado.', conflicts, 'SCENARIO_VALIDATION_FAILED');
}

export async function applyScenario(scenarioId, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  const result = await runPlanningTransaction(database, async tx => {
    let scenario = await tx.efetivoPlan.findUnique({ where: { id: scenarioId } });
    if (!scenario || scenario.kind !== 'SCENARIO') throw notFound('Cenário não encontrado.');
    await lockPlan(tx, scenario.id);
    scenario = await tx.efetivoPlan.findUnique({ where: { id: scenarioId } });
    if (scenario.status === 'APPLIED' && scenario.appliedPlanId) {
      const applied = await tx.efetivoPlan.findUnique({ where: { id: scenario.appliedPlanId } });
      return { scenarioId, officialPlanId: scenario.appliedPlanId, revision: applied?.revision || scenario.revision, idempotentRetry: true };
    }
    if (scenario.status !== 'DRAFT') throw conflictError('O cenário não pode mais ser aplicado.', [], 'SCENARIO_READ_ONLY');
    await lockOfficialPlanningState(tx);
    const official = await getActiveOfficialPlan(tx, { create: true, actorUserId: context.actorUserId });
    await lockPlan(tx, official.id);
    const calendarState = await tx.workforceCalendarState.findUnique({ where: { id: 'global' } });
    if (scenario.basePlanId !== official.id
      || scenario.baseOfficialRevision !== official.revision
      || scenario.baseCalendarRevision !== (calendarState?.revision || 1)) {
      await tx.efetivoPlan.update({ where: { id: scenario.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
      return { stale: true, officialRevision: official.revision };
    }
    await validateScenarioGraph(tx, scenario);
    await tx.efetivoPlan.update({ where: { id: official.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
    const newOfficial = await clonePlanGraph(tx, scenario.id, {
      kind: 'OFFICIAL', status: 'ACTIVE', name: 'Planejamento oficial', revision: official.revision + 1,
      basePlanId: official.id, baseOfficialRevision: official.revision,
      baseCalendarRevision: calendarState?.revision || 1,
      createdByUserId: context.actorUserId || null
    });
    await tx.efetivoPlan.update({
      where: { id: scenario.id },
      data: { status: 'APPLIED', appliedPlanId: newOfficial.id, appliedByUserId: context.actorUserId || null, appliedAt: new Date() }
    });
    await recordEfetivoAudit(tx, {
      planId: newOfficial.id, actorUserId: context.actorUserId, action: 'SCENARIO_APPLY', entityType: 'SCENARIO', entityId: scenario.id,
      summary: `Cenário ${scenario.name} aplicado ao planejamento oficial.`, beforeData: { officialPlanId: official.id, revision: official.revision }, afterData: { officialPlanId: newOfficial.id, revision: newOfficial.revision }, evidence: context.evidence
    });
    return { scenarioId, officialPlanId: newOfficial.id, revision: newOfficial.revision, idempotentRetry: false };
  }, { required: true });
  if (result.stale) throw conflictError(`O planejamento oficial avançou para a revisão ${result.officialRevision}. Compare o cenário novamente.`, [], 'SCENARIO_STALE');
  return result;
}

export async function discardScenario(scenarioId, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  return runPlanningTransaction(database, async tx => {
    const scenario = await tx.efetivoPlan.findUnique({ where: { id: scenarioId } });
    if (!scenario || scenario.kind !== 'SCENARIO') throw notFound('Cenário não encontrado.');
    await lockPlan(tx, scenario.id);
    if (scenario.status === 'DISCARDED') return scenario;
    if (scenario.status !== 'DRAFT') throw conflictError('Somente cenário em rascunho pode ser descartado.', [], 'SCENARIO_READ_ONLY');
    const discarded = await tx.efetivoPlan.update({ where: { id: scenario.id }, data: { status: 'DISCARDED', discardedAt: new Date() } });
    await recordEfetivoAudit(tx, { planId: scenario.id, actorUserId: context.actorUserId, action: 'SCENARIO_DISCARD', entityType: 'SCENARIO', entityId: scenario.id, summary: `Cenário ${scenario.name} descartado.`, beforeData: scenario, afterData: discarded, evidence: context.evidence });
    return discarded;
  }, { required: true });
}
