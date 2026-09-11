import { recordEfetivoAudit } from './audit.js';
import { collectAllocationConflicts, ensureNoPlanningConflicts, loadCollaboratorConflictData, lockCollaborator } from './conflicts.js';
import { parseDateKey } from './date-only.js';
import { conflictError, notFound, planningError } from './errors.js';
import {
  allocationPeriods,
  allocationPeriodWithinMission,
  maximumConcurrentAllocationCount,
  missionCycles
} from './allocation-period.js';
import { resolveSelectedMissionTeam, syncSelectedMissionTeam } from './mission-team.js';
import { missionEndDate } from './mission-period.js';
import { efetivoProjectWhere } from '../project-visibility.js';
import {
  bumpPlanRevision,
  requireEditablePlan,
  resolvePlanningDatabase,
  runPlanningTransaction
} from './plan-context.js';

export const missionInclude = {
  project: { select: { id: true, code: true, name: true, clientName: true, location: true, mobilizationDate: true, demobilizationDate: true } },
  cycles: { orderBy: { mobilizationDate: 'asc' } },
  demands: { include: { jobRole: { select: { id: true, name: true, calendarColor: true } } }, orderBy: { jobRole: { order: 'asc' } } },
  allocations: {
    where: { deletedAt: null },
    include: {
      collaborator: { select: { id: true, name: true, isActive: true, jobRoleId: true, jobRole: { select: { id: true, name: true } } } },
      jobRole: { select: { id: true, name: true } },
      cycles: { orderBy: { mobilizationDate: 'asc' } }
    },
    orderBy: { createdAt: 'asc' }
  }
};

function missionWithCurrentRoles(mission) {
  if (!mission) return mission;
  return {
    ...mission,
    allocations: (mission.allocations || []).map(allocation => ({
      ...allocation,
      collaborator: allocation.collaborator
        ? { ...allocation.collaborator, role: allocation.collaborator.jobRole?.name || '' }
        : allocation.collaborator
    }))
  };
}

function dateValue(value) {
  return new Date(`${parseDateKey(value)}T00:00:00.000Z`);
}

export function validateMissionChronology(payload) {
  const values = [
    parseDateKey(payload.mobilizationDate),
    parseDateKey(payload.executionStartDate),
    parseDateKey(payload.executionEndDate)
  ];
  if (values.some((value, index) => index > 0 && value < values[index - 1])) {
    throw planningError('Use a ordem mobilização ≤ início da execução ≤ fim da execução.', {
      code: 'INVALID_MISSION_CHRONOLOGY'
    });
  }
  const demobilizationDate = payload.returnDate ? parseDateKey(payload.returnDate) : null;
  if (demobilizationDate && demobilizationDate < values[2]) {
    throw planningError('A desmobilização não pode ser anterior ao fim da execução.', {
      code: 'INVALID_MISSION_CHRONOLOGY'
    });
  }
  return [...values, demobilizationDate];
}

export function normalizeMissionDemands(demands = [], scheduleStatus = 'DRAFT') {
  const result = new Map();
  for (const demand of demands) {
    const count = Number(demand.requiredCount);
    if (!Number.isInteger(count) || count < 0) throw planningError('A demanda deve ser um inteiro não negativo.');
    if (result.has(demand.jobRoleId)) throw planningError('Cada função deve aparecer uma única vez na demanda.');
    if (count > 0) result.set(demand.jobRoleId, count);
  }
  if (scheduleStatus === 'CONFIRMED' && result.size === 0) {
    throw planningError('Uma missão confirmada precisa ter ao menos uma demanda positiva.', { code: 'MISSION_WITHOUT_DEMAND' });
  }
  return [...result].map(([jobRoleId, requiredCount]) => ({ jobRoleId, requiredCount }));
}

function missionData(payload, actorUserId, demands, responsible, stage, currentReturnDate = null) {
  return {
    projectId: payload.projectId,
    scheduleStatus: payload.scheduleStatus,
    stage,
    headquartersResponsibleName: responsible.name,
    headquartersResponsibleRole: responsible.role,
    headquartersResponsibleCollaboratorId: responsible.collaboratorId,
    headquartersResponsibleUserId: responsible.userId,
    mobilizationDate: dateValue(payload.mobilizationDate),
    executionStartDate: dateValue(payload.executionStartDate),
    executionEndDate: dateValue(payload.executionEndDate),
    returnDate: payload.returnDate === undefined
      ? currentReturnDate
      : payload.returnDate ? dateValue(payload.returnDate) : null,
    updatedByUserId: actorUserId || null,
    demands: { create: demands }
  };
}

export async function syncMissionDemobilization(tx, project, returnDate) {
  if (returnDate === undefined) return;
  if (returnDate) {
    if (!project.mobilizationDate) {
      throw planningError('Informe a mobilização no cronograma do Planejamento antes da desmobilização.', {
        code: 'PROJECT_MOBILIZATION_REQUIRED'
      });
    }
    if (parseDateKey(returnDate) < parseDateKey(project.mobilizationDate)) {
      throw planningError('A desmobilização não pode ser anterior à mobilização registrada no cronograma.', {
        code: 'INVALID_PROJECT_DEMOBILIZATION'
      });
    }
  }
  await tx.project.update({
    where: { id: project.id },
    data: { demobilizationDate: returnDate ? dateValue(returnDate) : null }
  });
}

export async function resolveMissionResponsible(tx, payload) {
  if (!payload.headquartersResponsibleUserId) {
    throw planningError('Selecione uma conta ativa para vincular o líder da missão.', {
      code: 'INVALID_MISSION_COORDINATOR'
    });
  }
  const coordinator = await tx.user.findFirst({
    where: {
      id: payload.headquartersResponsibleUserId,
      isActive: true,
      OR: [
        { role: 'COORDINATOR' },
        { moduleRoles: { some: { role: 'RDO_COORDINATOR' } } }
      ]
    },
    select: {
      id: true,
      name: true,
      collaborator: { select: { id: true, name: true, isActive: true, jobRole: { select: { name: true } } } }
    }
  });
  if (!coordinator) {
    throw planningError('Selecione uma conta ativa para vincular o líder da missão.', {
      code: 'INVALID_MISSION_COORDINATOR'
    });
  }
  const linkedCollaborator = coordinator.collaborator;
  if (!linkedCollaborator?.isActive || !linkedCollaborator.jobRole?.name) {
    throw planningError('A conta selecionada precisa estar vinculada a um colaborador ativo com cargo.', {
      code: 'INVALID_MISSION_LEADER'
    });
  }
  return {
    name: linkedCollaborator.name || coordinator.name,
    role: linkedCollaborator.jobRole.name,
    collaboratorId: linkedCollaborator.id,
    userId: coordinator.id
  };
}

export function missionMovePendencies(mission) {
  const pendencies = [];
  const required = (mission.demands || []).reduce((sum, demand) => sum + Number(demand.requiredCount || 0), 0);
  const covered = (mission.demands || []).reduce((sum, demand) => {
    const rolePeriods = (mission.allocations || [])
      .filter(allocation => !allocation.deletedAt && allocation.jobRoleId === demand.jobRoleId)
      .flatMap(allocation => allocationPeriods(allocation, mission));
    return sum + Math.min(Number(demand.requiredCount || 0), maximumConcurrentAllocationCount(rolePeriods));
  }, 0);
  if (!mission.headquartersResponsibleUserId || !mission.headquartersResponsibleName || !mission.headquartersResponsibleRole) {
    pendencies.push('vincular o líder');
  }
  if (![mission.mobilizationDate, mission.executionStartDate, mission.executionEndDate].every(Boolean)) {
    pendencies.push('preencher as datas obrigatórias');
  }
  if (!required) pendencies.push('selecionar a equipe');
  else if (covered < required) pendencies.push('completar a equipe');
  if (mission.scheduleStatus !== 'CONFIRMED') pendencies.push('confirmar a programação');
  return pendencies;
}

async function validateDemandRoles(tx, demands) {
  const ids = demands.map(item => item.jobRoleId);
  if (!ids.length) return;
  const roles = await tx.jobRole.findMany({ where: { id: { in: ids }, isActive: true, isOperational: true }, select: { id: true } });
  if (roles.length !== new Set(ids).size) throw planningError('A demanda contém função inexistente, inativa ou não operacional.', { code: 'INVALID_JOB_ROLE' });
}

async function validateExistingAllocations(tx, mission, payload, demands) {
  const proposedMission = { ...mission, ...payload };
  for (const cycle of missionCycles(proposedMission)) {
    if (!allocationPeriodWithinMission(cycle, proposedMission)) {
      throw conflictError('A nova programação deixa um ciclo do projeto fora das datas gerais da missão.', [], 'MISSION_CYCLE_OUTSIDE_MISSION_PERIOD');
    }
  }
  const allocationsByRole = new Map();
  for (const allocation of mission.allocations || []) {
    const allocationCyclePeriods = allocationPeriods(allocation, proposedMission);
    for (const period of allocationCyclePeriods) {
      if (!allocationPeriodWithinMission(period, proposedMission)) {
        throw conflictError(
          'A nova programação deixa um ciclo individual fora das datas da missão.',
          [],
          'ALLOCATION_OUTSIDE_MISSION_PERIOD'
        );
      }
    }
    const periods = allocationsByRole.get(allocation.jobRoleId) || [];
    periods.push(...allocationCyclePeriods);
    allocationsByRole.set(allocation.jobRoleId, periods);
  }
  for (const demand of demands) {
    if (maximumConcurrentAllocationCount(allocationsByRole.get(demand.jobRoleId) || []) > demand.requiredCount) {
      throw conflictError('A nova demanda é menor que a equipe já alocada.', [], 'DEMAND_BELOW_ALLOCATION');
    }
  }
  if ([...allocationsByRole].some(([jobRoleId]) => !demands.some(item => item.jobRoleId === jobRoleId))) {
    throw conflictError('Remova ou realoque pessoas antes de retirar a função da demanda.', [], 'ALLOCATED_ROLE_REMOVED');
  }
  if (payload.scheduleStatus !== 'CONFIRMED') return;
  for (const allocation of mission.allocations || []) {
    for (const period of allocationPeriods(allocation, proposedMission)) {
      await lockCollaborator(tx, allocation.collaboratorId);
      const data = await loadCollaboratorConflictData(tx, allocation.collaboratorId, period, mission.planId);
      if (!data.collaborator) throw notFound('Colaborador alocado não encontrado.');
      ensureNoPlanningConflicts(collectAllocationConflicts({
        ...data,
        collaborator: data.collaborator,
        jobRoleId: allocation.jobRoleId,
        period,
        ignoredMissionId: mission.id,
        allowMissionOverlap: allocation.allowMissionOverlap,
        allowInactiveCollaborator: (payload.confirmedInactiveCollaboratorIds || []).includes(allocation.collaboratorId)
      }));
    }
  }
}

export async function listMissions(filters = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  const plan = filters.planId
    ? await database.efetivoPlan.findUnique({ where: { id: filters.planId } })
    : await database.efetivoPlan.findFirst({ where: { kind: 'OFFICIAL', status: 'ACTIVE' } });
  if (!plan) return [];
  const missions = await database.efetivoMissionPlan.findMany({
    where: {
      planId: plan.id,
      deletedAt: null,
      project: efetivoProjectWhere(),
      ...(filters.status ? { scheduleStatus: filters.status } : {}),
      ...(filters.stage ? { stage: filters.stage } : {})
    },
    include: missionInclude,
    orderBy: [{ stage: 'asc' }, { kanbanOrder: 'asc' }, { mobilizationDate: 'asc' }]
  });
  return missions.map(missionWithCurrentRoles);
}

export async function getMission(missionId, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  const mission = await database.efetivoMissionPlan.findUnique({
    where: { id: missionId, project: efetivoProjectWhere() },
    include: missionInclude
  });
  if (!mission || mission.deletedAt) throw notFound('Missão operacional não encontrada.');
  return missionWithCurrentRoles(mission);
}

export async function createMission(payload, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  validateMissionChronology(payload);
  return runPlanningTransaction(database, async tx => {
    const plan = await requireEditablePlan(tx, payload.planId, { actorUserId: context.actorUserId });
    const project = await tx.project.findFirst({
      where: { id: payload.projectId, isActive: true, deletedAt: null, ...efetivoProjectWhere() }
    });
    if (!project) throw notFound('Projeto não encontrado ou inativo.');
    if (plan.kind === 'OFFICIAL') await syncMissionDemobilization(tx, project, payload.returnDate);
    const responsible = await resolveMissionResponsible(tx, payload);
    const team = Array.isArray(payload.collaboratorIds)
      ? await resolveSelectedMissionTeam(tx, payload, plan.id)
      : null;
    const demands = team?.demands || normalizeMissionDemands(payload.demands, payload.scheduleStatus);
    await validateDemandRoles(tx, demands);
    const stage = 'STANDBY';
    const maxOrder = await tx.efetivoMissionPlan.aggregate({ where: { planId: plan.id, stage, deletedAt: null }, _max: { kanbanOrder: true } });
    const existing = await tx.efetivoMissionPlan.findUnique({
      where: { planId_projectId: { planId: plan.id, projectId: payload.projectId } }
    });
    if (existing && !existing.deletedAt) {
      throw conflictError('Este projeto já possui programação neste plano.', [], 'MISSION_PROJECT_ALREADY_PLANNED');
    }
    const kanbanOrder = (maxOrder._max.kanbanOrder ?? -1) + 1;
    let mission;
    if (existing) {
      const removedAt = new Date();
      await Promise.all([
        tx.efetivoMissionDemand.deleteMany({ where: { missionId: existing.id } }),
        ...(tx.efetivoMissionCycle ? [tx.efetivoMissionCycle.deleteMany({ where: { missionId: existing.id } })] : []),
        tx.efetivoMissionAllocation.updateMany({
          where: { missionId: existing.id, deletedAt: null },
          data: { deletedAt: removedAt }
        })
      ]);
      mission = await tx.efetivoMissionPlan.update({
        where: { id: existing.id },
        data: {
          ...missionData(payload, context.actorUserId, demands, responsible, stage),
          deletedAt: null,
          version: { increment: 1 },
          kanbanOrder
        },
        include: missionInclude
      });
    } else {
      mission = await tx.efetivoMissionPlan.create({
        data: {
          ...missionData(payload, context.actorUserId, demands, responsible, stage),
          planId: plan.id,
          createdByUserId: context.actorUserId || null,
          kanbanOrder
        },
        include: missionInclude
      });
    }
    if (tx.efetivoMissionCycle) {
      await tx.efetivoMissionCycle.create({
        data: {
          missionId: mission.id,
          mobilizationDate: dateValue(payload.mobilizationDate),
          demobilizationDate: dateValue(payload.returnDate || payload.executionEndDate),
          createdByUserId: context.actorUserId || null
        }
      });
    }
    if (team) {
      await syncSelectedMissionTeam(tx, mission.id, team, context);
    }
    if (team || tx.efetivoMissionCycle) {
      mission = await tx.efetivoMissionPlan.findUnique({ where: { id: mission.id }, include: missionInclude });
    }
    await bumpPlanRevision(tx, plan);
    await recordEfetivoAudit(tx, {
      planId: plan.id,
      actorUserId: context.actorUserId,
      action: existing ? 'MISSION_RESTORE' : 'MISSION_CREATE',
      entityType: 'MISSION',
      entityId: mission.id,
      summary: existing
        ? `Programação restaurada para ${project.name}.`
        : `Programação criada para ${project.name}.`,
      beforeData: existing,
      afterData: { ...mission, confirmedInactiveCollaboratorIds: payload.confirmedInactiveCollaboratorIds || [] },
      evidence: context.evidence
    });
    return missionWithCurrentRoles(mission);
  });
}

export async function updateMission(missionId, payload, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  validateMissionChronology(payload);
  return runPlanningTransaction(database, async tx => {
    const existing = await tx.efetivoMissionPlan.findUnique({ where: { id: missionId }, include: { ...missionInclude, plan: true } });
    if (!existing || existing.deletedAt) throw notFound('Missão operacional não encontrada.');
    const plan = await requireEditablePlan(tx, existing.planId, { actorUserId: context.actorUserId });
    if (context.version && existing.version !== context.version) throw conflictError('A missão foi alterada por outra pessoa.', [], 'MISSION_VERSION_CONFLICT');
    if (payload.projectId !== existing.projectId) throw conflictError('O projeto da programação não pode ser substituído.', [], 'MISSION_PROJECT_IMMUTABLE');
    if (plan.kind === 'OFFICIAL') await syncMissionDemobilization(tx, existing.project, payload.returnDate);
    const existingBounds = {
      startDate: parseDateKey(existing.mobilizationDate),
      endDate: missionEndDate(existing)
    };
    const defaultCycle = existing.cycles?.length === 1
      && parseDateKey(existing.cycles[0].mobilizationDate) === existingBounds.startDate
      && parseDateKey(existing.cycles[0].demobilizationDate || existingBounds.endDate) === existingBounds.endDate;
    const missionForValidation = defaultCycle ? { ...existing, cycles: [] } : existing;
    if (!defaultCycle) {
      const proposedMission = { ...existing, ...payload };
      for (const cycle of missionCycles(proposedMission)) {
        if (!allocationPeriodWithinMission(cycle, proposedMission)) {
          throw conflictError('As datas gerais precisam abranger todos os ciclos já registrados. Para ajustar uma remobilização, use “Gerenciar equipe”.', [], 'MISSION_CYCLE_OUTSIDE_MISSION_PERIOD');
        }
      }
    }
    const responsible = await resolveMissionResponsible(tx, payload);
    const team = Array.isArray(payload.collaboratorIds)
      ? await resolveSelectedMissionTeam(tx, payload, existing.planId, existing.id, { mission: missionForValidation })
      : null;
    const demands = team?.demands || normalizeMissionDemands(payload.demands, payload.scheduleStatus);
    await validateDemandRoles(tx, demands);
    if (!team) await validateExistingAllocations(tx, missionForValidation, payload, demands);
    await tx.efetivoMissionDemand.deleteMany({ where: { missionId } });
    let updated = await tx.efetivoMissionPlan.update({
      where: { id: missionId },
      data: {
        ...missionData(payload, context.actorUserId, demands, responsible, existing.stage, existing.returnDate),
        version: { increment: 1 }
      },
      include: missionInclude
    });
    if (defaultCycle) {
      await tx.efetivoMissionCycle.update({
        where: { id: existing.cycles[0].id },
        data: {
          mobilizationDate: dateValue(payload.mobilizationDate),
          demobilizationDate: dateValue(payload.returnDate || payload.executionEndDate)
        }
      });
    }
    if (team) {
      await syncSelectedMissionTeam(tx, missionId, team, context);
    }
    updated = await tx.efetivoMissionPlan.findUnique({ where: { id: missionId }, include: missionInclude });
    await bumpPlanRevision(tx, plan);
    await recordEfetivoAudit(tx, {
      planId: plan.id,
      actorUserId: context.actorUserId,
      action: 'MISSION_UPDATE', entityType: 'MISSION', entityId: missionId,
      summary: `Programação de ${updated.project.name} atualizada.`,
      beforeData: existing, afterData: { ...updated, confirmedInactiveCollaboratorIds: payload.confirmedInactiveCollaboratorIds || [] }, evidence: context.evidence
    });
    return missionWithCurrentRoles(updated);
  });
}

export async function deleteMission(missionId, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  return runPlanningTransaction(database, async tx => {
    const existing = await tx.efetivoMissionPlan.findUnique({ where: { id: missionId }, include: { plan: true, project: true } });
    if (!existing || existing.deletedAt) throw notFound('Missão operacional não encontrada.');
    const plan = await requireEditablePlan(tx, existing.planId, { actorUserId: context.actorUserId });
    const deleted = await tx.efetivoMissionPlan.update({ where: { id: missionId }, data: { deletedAt: new Date(), version: { increment: 1 }, updatedByUserId: context.actorUserId || null } });
    await bumpPlanRevision(tx, plan);
    await recordEfetivoAudit(tx, {
      planId: plan.id, actorUserId: context.actorUserId, action: 'MISSION_DELETE', entityType: 'MISSION', entityId: missionId,
      summary: `Programação de ${existing.project.name} removida.`, beforeData: existing, afterData: deleted, evidence: context.evidence
    });
    return deleted;
  });
}

export async function moveMissionStage(missionId, payload, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  return runPlanningTransaction(database, async tx => {
    const existing = await tx.efetivoMissionPlan.findUnique({ where: { id: missionId }, include: { ...missionInclude, plan: true } });
    if (!existing || existing.deletedAt) throw notFound('Missão operacional não encontrada.');
    const plan = await requireEditablePlan(tx, existing.planId, { actorUserId: context.actorUserId });
    if (context.version && existing.version !== context.version) throw conflictError('A posição da missão ficou desatualizada.', [], 'MISSION_VERSION_CONFLICT');
    const pendencies = missionMovePendencies(existing);
    if (pendencies.length) {
      throw planningError(`Complete os dados obrigatórios antes de mover a missão: ${pendencies.join(', ')}.`, {
        code: 'MISSION_INCOMPLETE_FOR_KANBAN',
        issues: pendencies.map(message => ({ message }))
      });
    }
    const updatesDemobilization = payload.stage === 'FINISHED' && payload.returnDate !== undefined;
    if (updatesDemobilization) {
      validateMissionChronology({ ...existing, returnDate: payload.returnDate });
      if (plan.kind === 'OFFICIAL') await syncMissionDemobilization(tx, existing.project, payload.returnDate);
    }
    const target = await tx.efetivoMissionPlan.findMany({
      where: { planId: plan.id, stage: payload.stage, deletedAt: null, id: { not: missionId } },
      orderBy: { kanbanOrder: 'asc' }, select: { id: true }
    });
    const index = Math.min(payload.order, target.length);
    target.splice(index, 0, { id: missionId });
    const source = existing.stage === payload.stage ? [] : await tx.efetivoMissionPlan.findMany({
      where: { planId: plan.id, stage: existing.stage, deletedAt: null, id: { not: missionId } },
      orderBy: { kanbanOrder: 'asc' }, select: { id: true }
    });
    await Promise.all([
      ...source.map((item, order) => tx.efetivoMissionPlan.update({ where: { id: item.id }, data: { kanbanOrder: order } })),
      ...target.map((item, order) => tx.efetivoMissionPlan.update({ where: { id: item.id }, data: { stage: payload.stage, kanbanOrder: order } }))
    ]);
    const moved = await tx.efetivoMissionPlan.update({
      where: { id: missionId },
      data: {
        ...(updatesDemobilization ? { returnDate: payload.returnDate ? dateValue(payload.returnDate) : null } : {}),
        version: { increment: 1 },
        updatedByUserId: context.actorUserId || null
      },
      include: missionInclude
    });
    await bumpPlanRevision(tx, plan);
    await recordEfetivoAudit(tx, {
      planId: plan.id, actorUserId: context.actorUserId, action: 'MISSION_STAGE_CHANGE', entityType: 'MISSION', entityId: missionId,
      summary: `${existing.project.name} movida para ${payload.stage}.`, beforeData: { stage: existing.stage, order: existing.kanbanOrder }, afterData: { stage: payload.stage, order: index }, evidence: context.evidence
    });
    return missionWithCurrentRoles(moved);
  });
}
