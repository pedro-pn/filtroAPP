import { recordEfetivoAudit } from './audit.js';
import {
  allocationPeriodWithinMission,
  allocationPeriods,
  maximumConcurrentAllocationCount,
  missionCycles
} from './allocation-period.js';
import {
  collectAllocationConflicts,
  ensureNoPlanningConflicts,
  loadCollaboratorConflictData,
  lockCollaborator
} from './conflicts.js';
import { parseDateKey, periodsOverlap } from './date-only.js';
import { conflictError, notFound, planningError } from './errors.js';
import { missionPeriod } from './mission-period.js';
import { missionInclude } from './mission-planning.js';
import { bumpPlanRevision, requireEditablePlan, resolvePlanningDatabase, runPlanningTransaction } from './plan-context.js';

function utcDate(value) {
  return value ? new Date(`${parseDateKey(value)}T00:00:00.000Z`) : null;
}

function cyclePeriod(payload, mission) {
  const bounds = missionPeriod(mission);
  const startDate = parseDateKey(payload.mobilizationDate);
  const endDate = payload.demobilizationDate
    ? parseDateKey(payload.demobilizationDate)
    : bounds.endDate;
  const period = { startDate, endDate };
  if (!allocationPeriodWithinMission(period, mission)) {
    throw planningError('O ciclo deve ficar dentro das datas gerais da missão.', {
      code: 'CYCLE_OUTSIDE_MISSION_PERIOD'
    });
  }
  return period;
}

function storedCycle(payload) {
  return {
    mobilizationDate: utcDate(payload.mobilizationDate),
    demobilizationDate: utcDate(payload.demobilizationDate)
  };
}

function openCycleError(label, cycle) {
  const date = parseDateKey(cycle.mobilizationDate);
  throw conflictError(
    `${label} ainda possui uma mobilização aberta desde ${date}. Registre a desmobilização desse ciclo antes de criar uma nova mobilização.`,
    [],
    'OPEN_MOBILIZATION_CYCLE'
  );
}

export function validateNewCycle(cycles, payload, mission, label) {
  const openCycle = cycles.find(cycle => !cycle.demobilizationDate);
  if (openCycle) openCycleError(label, openCycle);
  const period = cyclePeriod(payload, mission);
  const overlapping = cycles.find(cycle => periodsOverlap(period, {
    startDate: parseDateKey(cycle.mobilizationDate),
    endDate: parseDateKey(cycle.demobilizationDate || missionPeriod(mission).endDate)
  }));
  if (overlapping) {
    throw conflictError('O novo ciclo se sobrepõe a uma mobilização já registrada.', [], 'OVERLAPPING_MOBILIZATION_CYCLE');
  }
  return period;
}

function validateUpdatedCycle(cycles, existing, payload, mission, label) {
  if (!payload.demobilizationDate) {
    const otherOpen = cycles.find(cycle => cycle.id !== existing.id && !cycle.demobilizationDate);
    if (otherOpen) openCycleError(label, otherOpen);
  }
  const period = cyclePeriod(payload, mission);
  const overlapping = cycles.find(cycle => cycle.id !== existing.id && periodsOverlap(period, {
    startDate: parseDateKey(cycle.mobilizationDate),
    endDate: parseDateKey(cycle.demobilizationDate || missionPeriod(mission).endDate)
  }));
  if (overlapping) {
    throw conflictError('O ciclo informado se sobrepõe a outra mobilização já registrada.', [], 'OVERLAPPING_MOBILIZATION_CYCLE');
  }
  return period;
}

async function requireCycleMission(tx, missionId) {
  const mission = await tx.efetivoMissionPlan.findUnique({
    where: { id: missionId },
    include: {
      ...missionInclude,
      plan: true
    }
  });
  if (!mission || mission.deletedAt) throw notFound('Missão operacional não encontrada.');
  return mission;
}

function ensureInsideProjectCycle(mission, period) {
  const inside = missionCycles(mission).some(cycle => (
    period.startDate >= cycle.startDate && period.endDate <= cycle.endDate
  ));
  if (!inside) {
    throw planningError('O ciclo individual deve ficar dentro de um único ciclo ativo do projeto.', {
      code: 'ALLOCATION_CYCLE_OUTSIDE_PROJECT_CYCLE'
    });
  }
}

function ensureRoleCapacity(mission, allocation, period, ignoredCycleId = null) {
  const demand = mission.demands.find(item => item.jobRoleId === allocation.jobRoleId);
  if (!demand) throw conflictError('A função não faz parte da demanda da missão.', [], 'JOB_ROLE_NOT_DEMANDED');
  const periods = mission.allocations
    .filter(item => !item.deletedAt && item.jobRoleId === allocation.jobRoleId)
    .flatMap(item => {
      if (item.id !== allocation.id) return allocationPeriods(item, mission);
      const remainingCycles = (item.cycles || []).filter(cycle => cycle.id !== ignoredCycleId);
      return remainingCycles.length ? allocationPeriods({ ...item, cycles: remainingCycles }, mission) : [];
    });
  if (maximumConcurrentAllocationCount([...periods, period]) > demand.requiredCount) {
    throw conflictError('A demanda desta função já está completa neste período.', [], 'DEMAND_FULL');
  }
}

async function validateCollaboratorPeriod(tx, mission, allocation, period, allowInactiveCollaborator = false) {
  await lockCollaborator(tx, allocation.collaboratorId);
  const data = await loadCollaboratorConflictData(tx, allocation.collaboratorId, period, mission.planId);
  if (!data.collaborator) throw notFound('Colaborador não encontrado.');
  ensureNoPlanningConflicts(collectAllocationConflicts({
    ...data,
    collaborator: data.collaborator,
    jobRoleId: allocation.jobRoleId,
    period,
    ignoredMissionId: mission.id,
    allowMissionOverlap: allocation.allowMissionOverlap,
    allowInactiveCollaborator
  }));
}

function ensureIndividualCyclesInsideProject(mission, proposedCycles) {
  const projectPeriods = missionCycles({ ...mission, cycles: proposedCycles });
  for (const allocation of mission.allocations || []) {
    if (!allocation.cycles?.length) continue;
    for (const period of allocationPeriods(allocation, mission)) {
      if (!projectPeriods.some(projectPeriod => (
        period.startDate >= projectPeriod.startDate && period.endDate <= projectPeriod.endDate
      ))) {
        throw conflictError(
          `${allocation.collaborator?.name || 'Um colaborador'} possui ciclo individual fora dos novos ciclos do projeto. Ajuste o ciclo individual primeiro.`,
          [],
          'ALLOCATION_CYCLE_OUTSIDE_PROJECT_CYCLE'
        );
      }
    }
  }
}

async function validateInheritedAllocationsForPeriod(tx, mission, period, allowInactiveCollaborator = false) {
  for (const allocation of mission.allocations || []) {
    if (allocation.deletedAt || allocation.cycles?.length) continue;
    await validateCollaboratorPeriod(tx, mission, allocation, period, allowInactiveCollaborator);
  }
}

async function finishCycleMutation(tx, mission, context, audit) {
  const plan = await requireEditablePlan(tx, mission.planId, { actorUserId: context.actorUserId });
  await bumpPlanRevision(tx, plan);
  await recordEfetivoAudit(tx, {
    planId: plan.id,
    actorUserId: context.actorUserId,
    entityType: audit.entityType,
    entityId: audit.entityId,
    action: audit.action,
    summary: audit.summary,
    beforeData: audit.beforeData,
    afterData: audit.afterData,
    evidence: context.evidence
  });
}

export async function createMissionCycle(missionId, payload, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  return runPlanningTransaction(database, async tx => {
    const mission = await requireCycleMission(tx, missionId);
    await requireEditablePlan(tx, mission.planId, { actorUserId: context.actorUserId });
    const period = validateNewCycle(mission.cycles || [], payload, mission, `O projeto ${mission.project.code}`);
    await validateInheritedAllocationsForPeriod(tx, mission, period, payload.allowInactiveCollaborator === true);
    const cycle = await tx.efetivoMissionCycle.create({
      data: { missionId, ...storedCycle(payload), createdByUserId: context.actorUserId || null }
    });
    await finishCycleMutation(tx, mission, context, {
      action: 'MISSION_CYCLE_CREATE', entityType: 'MISSION_CYCLE', entityId: cycle.id,
      summary: `Novo ciclo de mobilização criado para ${mission.project.code}.`, afterData: { ...cycle, inactiveCollaboratorConfirmed: payload.allowInactiveCollaborator === true }
    });
    return cycle;
  });
}

export async function updateMissionCycle(missionId, cycleId, payload, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  return runPlanningTransaction(database, async tx => {
    const mission = await requireCycleMission(tx, missionId);
    await requireEditablePlan(tx, mission.planId, { actorUserId: context.actorUserId });
    const existing = mission.cycles.find(cycle => cycle.id === cycleId);
    if (!existing) throw notFound('Ciclo da missão não encontrado.');
    const period = validateUpdatedCycle(mission.cycles, existing, payload, mission, `O projeto ${mission.project.code}`);
    const proposedCycles = mission.cycles.map(cycle => cycle.id === cycleId ? { ...cycle, ...storedCycle(payload) } : cycle);
    ensureIndividualCyclesInsideProject(mission, proposedCycles);
    await validateInheritedAllocationsForPeriod(tx, mission, period, payload.allowInactiveCollaborator === true);
    const cycle = await tx.efetivoMissionCycle.update({ where: { id: cycleId }, data: storedCycle(payload) });
    await finishCycleMutation(tx, mission, context, {
      action: 'MISSION_CYCLE_UPDATE', entityType: 'MISSION_CYCLE', entityId: cycle.id,
      summary: `Ciclo de mobilização atualizado para ${mission.project.code}.`, beforeData: existing, afterData: { ...cycle, inactiveCollaboratorConfirmed: payload.allowInactiveCollaborator === true }
    });
    return cycle;
  });
}

export async function createAllocationCycle(missionId, allocationId, payload, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  return runPlanningTransaction(database, async tx => {
    const mission = await requireCycleMission(tx, missionId);
    await requireEditablePlan(tx, mission.planId, { actorUserId: context.actorUserId });
    const allocation = mission.allocations.find(item => item.id === allocationId && !item.deletedAt);
    if (!allocation) throw notFound('Alocação não encontrada.');
    const label = allocation.collaborator?.name || 'O colaborador';
    const period = validateNewCycle(allocation.cycles || [], payload, mission, label);
    ensureInsideProjectCycle(mission, period);
    ensureRoleCapacity(mission, allocation, period);
    await validateCollaboratorPeriod(tx, mission, allocation, period, payload.allowInactiveCollaborator === true);
    const cycle = await tx.efetivoAllocationCycle.create({
      data: { allocationId, ...storedCycle(payload), createdByUserId: context.actorUserId || null }
    });
    await finishCycleMutation(tx, mission, context, {
      action: 'ALLOCATION_CYCLE_CREATE', entityType: 'ALLOCATION_CYCLE', entityId: cycle.id,
      summary: `Novo ciclo individual criado para ${label}.`, afterData: { ...cycle, inactiveCollaboratorConfirmed: payload.allowInactiveCollaborator === true }
    });
    return cycle;
  });
}

export async function initializeAllocationCycles(missionId, allocationId, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  return runPlanningTransaction(database, async tx => {
    const mission = await requireCycleMission(tx, missionId);
    await requireEditablePlan(tx, mission.planId, { actorUserId: context.actorUserId });
    const allocation = mission.allocations.find(item => item.id === allocationId && !item.deletedAt);
    if (!allocation) throw notFound('Alocação não encontrada.');
    if (allocation.cycles?.length) return allocation.cycles;
    const cycles = [];
    for (const inherited of mission.cycles || []) {
      cycles.push(await tx.efetivoAllocationCycle.create({
        data: {
          allocationId,
          mobilizationDate: inherited.mobilizationDate,
          demobilizationDate: inherited.demobilizationDate,
          createdByUserId: context.actorUserId || null
        }
      }));
    }
    await finishCycleMutation(tx, mission, context, {
      action: 'ALLOCATION_CYCLES_INITIALIZE', entityType: 'ALLOCATION', entityId: allocation.id,
      summary: `Ciclos individuais habilitados para ${allocation.collaborator?.name || 'o colaborador'}.`,
      afterData: { cycles }
    });
    return cycles;
  });
}

export async function updateAllocationCycle(missionId, allocationId, cycleId, payload, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  return runPlanningTransaction(database, async tx => {
    const mission = await requireCycleMission(tx, missionId);
    await requireEditablePlan(tx, mission.planId, { actorUserId: context.actorUserId });
    const allocation = mission.allocations.find(item => item.id === allocationId && !item.deletedAt);
    if (!allocation) throw notFound('Alocação não encontrada.');
    const existing = (allocation.cycles || []).find(cycle => cycle.id === cycleId);
    if (!existing) throw notFound('Ciclo individual não encontrado.');
    const label = allocation.collaborator?.name || 'O colaborador';
    const period = validateUpdatedCycle(allocation.cycles, existing, payload, mission, label);
    ensureInsideProjectCycle(mission, period);
    ensureRoleCapacity(mission, allocation, period, cycleId);
    await validateCollaboratorPeriod(tx, mission, allocation, period, payload.allowInactiveCollaborator === true);
    const cycle = await tx.efetivoAllocationCycle.update({ where: { id: cycleId }, data: storedCycle(payload) });
    await finishCycleMutation(tx, mission, context, {
      action: 'ALLOCATION_CYCLE_UPDATE', entityType: 'ALLOCATION_CYCLE', entityId: cycle.id,
      summary: `Ciclo individual atualizado para ${label}.`, beforeData: existing, afterData: { ...cycle, inactiveCollaboratorConfirmed: payload.allowInactiveCollaborator === true }
    });
    return cycle;
  });
}

export async function deleteAllocationCycle(missionId, allocationId, cycleId, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  return runPlanningTransaction(database, async tx => {
    const mission = await requireCycleMission(tx, missionId);
    await requireEditablePlan(tx, mission.planId, { actorUserId: context.actorUserId });
    const allocation = mission.allocations.find(item => item.id === allocationId && !item.deletedAt);
    if (!allocation) throw notFound('Alocação não encontrada.');
    const existing = (allocation.cycles || []).find(cycle => cycle.id === cycleId);
    if (!existing) throw notFound('Ciclo individual não encontrado.');
    await tx.efetivoAllocationCycle.delete({ where: { id: cycleId } });
    await finishCycleMutation(tx, mission, context, {
      action: 'ALLOCATION_CYCLE_DELETE', entityType: 'ALLOCATION_CYCLE', entityId: cycleId,
      summary: `Ciclo individual removido de ${allocation.collaborator?.name || 'um colaborador'}.`,
      beforeData: existing
    });
    return existing;
  });
}
