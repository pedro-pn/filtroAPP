import { collectAllocationConflicts, lockCollaborator } from './conflicts.js';
import { parseDateKey } from './date-only.js';
import { conflictError, notFound, planningError } from './errors.js';
import {
  allocationPeriods,
  allocationPeriodWithinMission,
  maximumConcurrentAllocationCount
} from './allocation-period.js';
import { missionEndsOnOrAfter } from './mission-period.js';

function dateValue(value) {
  return new Date(`${parseDateKey(value)}T00:00:00.000Z`);
}

export function deriveSelectedMissionTeam(collaborators = [], scheduleStatus = 'DRAFT') {
  if (scheduleStatus === 'CONFIRMED' && collaborators.length === 0) {
    throw planningError('Selecione ao menos um colaborador para confirmar a missão.', {
      code: 'MISSION_WITHOUT_COLLABORATORS'
    });
  }

  const counts = new Map();
  const allocations = collaborators.map(collaborator => {
    if (!collaborator.jobRoleId || !collaborator.jobRole?.isActive || !collaborator.jobRole?.isOperational) {
      throw planningError(`${collaborator.name || 'Colaborador'} não possui uma função operacional canônica ativa.`, {
        code: 'INVALID_COLLABORATOR_JOB_ROLE'
      });
    }
    counts.set(collaborator.jobRoleId, (counts.get(collaborator.jobRoleId) || 0) + 1);
    return {
      collaboratorId: collaborator.id,
      jobRoleId: collaborator.jobRoleId,
      jobRoleNameSnapshot: collaborator.jobRole.name
    };
  });

  return {
    demands: [...counts].map(([jobRoleId, requiredCount]) => ({ jobRoleId, requiredCount })),
    allocations
  };
}

export async function resolveSelectedMissionTeam(tx, payload, planId, ignoredMissionId = null, { mission = null } = {}) {
  const collaboratorIds = payload.collaboratorIds || [];
  const uniqueIds = [...new Set(collaboratorIds)];
  if (uniqueIds.length !== collaboratorIds.length) {
    throw planningError('Cada colaborador deve aparecer uma única vez na equipe.', {
      code: 'DUPLICATE_MISSION_COLLABORATOR'
    });
  }
  if (!uniqueIds.length) return deriveSelectedMissionTeam([], payload.scheduleStatus);

  const lockedIds = [...uniqueIds].sort();
  for (const collaboratorId of lockedIds) await lockCollaborator(tx, collaboratorId);

  const period = { startDate: parseDateKey(payload.mobilizationDate), endDate: parseDateKey(payload.returnDate || payload.executionEndDate) };
  const confirmedMissionOverlapIds = new Set(payload.confirmedMissionOverlapCollaboratorIds || []);
  const [collaborators, absences, allocations, currentAllocations] = await Promise.all([
    tx.collaborator.findMany({
      where: { id: { in: uniqueIds } },
      include: { jobRole: { select: { id: true, name: true, isActive: true, isOperational: true } } }
    }),
    tx.collaboratorAbsence.findMany({
      where: {
        collaboratorId: { in: uniqueIds },
        deletedAt: null,
        type: { in: ['FERIAS', 'FOLGA', 'AFASTAMENTO'] },
        startDate: { lte: dateValue(period.endDate) },
        endDate: { gte: dateValue(period.startDate) }
      }
    }),
    tx.efetivoMissionAllocation.findMany({
      where: {
        collaboratorId: { in: uniqueIds },
        deletedAt: null,
        mission: {
          planId,
          deletedAt: null,
          scheduleStatus: 'CONFIRMED',
          mobilizationDate: { lte: dateValue(period.endDate) },
          ...missionEndsOnOrAfter(dateValue(period.startDate))
        }
      },
      include: {
        cycles: { orderBy: { mobilizationDate: 'asc' } },
        mission: { include: { cycles: { orderBy: { mobilizationDate: 'asc' } } } }
      }
    }),
    ignoredMissionId
      ? tx.efetivoMissionAllocation.findMany({
        where: { missionId: ignoredMissionId, collaboratorId: { in: uniqueIds }, deletedAt: null },
        include: {
          cycles: { orderBy: { mobilizationDate: 'asc' } },
          mission: { include: { cycles: { orderBy: { mobilizationDate: 'asc' } } } }
        }
      })
      : Promise.resolve([])
  ]);
  const byId = new Map(collaborators.map(collaborator => [collaborator.id, collaborator]));
  const missing = uniqueIds.find(collaboratorId => !byId.has(collaboratorId));
  if (missing) throw notFound('Um colaborador selecionado não foi encontrado. Atualize a lista e tente novamente.');

  const ordered = uniqueIds.map(collaboratorId => byId.get(collaboratorId));
  const team = deriveSelectedMissionTeam(ordered, payload.scheduleStatus);
  const proposedMission = {
    id: ignoredMissionId,
    mobilizationDate: payload.mobilizationDate,
    executionEndDate: payload.executionEndDate,
    returnDate: payload.returnDate,
    cycles: mission?.cycles ?? currentAllocations[0]?.mission?.cycles ?? []
  };
  const requestedPeriodByCollaboratorId = new Map((payload.allocationPeriods || [])
    .map(item => [item.collaboratorId, item]));
  const existingByCollaboratorId = new Map(currentAllocations
    .map(allocation => [allocation.collaboratorId, allocation]));
  for (const allocation of team.allocations) {
    const existing = existingByCollaboratorId.get(allocation.collaboratorId);
    const requested = requestedPeriodByCollaboratorId.get(allocation.collaboratorId);
    allocation.cycles = existing?.cycles || [];
    if (requested) {
      allocation.mobilizationDate = parseDateKey(requested.mobilizationDate) === period.startDate
        ? null : dateValue(requested.mobilizationDate);
      allocation.demobilizationDate = parseDateKey(requested.demobilizationDate) === period.endDate
        ? null : dateValue(requested.demobilizationDate);
    } else if (existing) {
      allocation.mobilizationDate = existing.mobilizationDate;
      allocation.demobilizationDate = existing.demobilizationDate;
    }
    allocation.allowMissionOverlap = Boolean(
      existing?.allowMissionOverlap || confirmedMissionOverlapIds.has(allocation.collaboratorId)
    );
  }
  team.demands = [...new Set(team.allocations.map(item => item.jobRoleId))].map(jobRoleId => ({
    jobRoleId,
    requiredCount: maximumConcurrentAllocationCount(team.allocations
      .filter(item => item.jobRoleId === jobRoleId)
      .flatMap(item => allocationPeriods(item, proposedMission)))
  }));
  const conflicts = ordered.flatMap(collaborator => {
    const teamAllocation = team.allocations.find(item => item.collaboratorId === collaborator.id);
    return allocationPeriods(teamAllocation, proposedMission).flatMap(collaboratorPeriod => {
      if (!allocationPeriodWithinMission(collaboratorPeriod, proposedMission)) {
        throw planningError(`${collaborator.name} possui ciclo individual fora das novas datas da missão.`, {
          code: 'ALLOCATION_OUTSIDE_MISSION_PERIOD'
        });
      }
      return collectAllocationConflicts({
        collaborator,
        jobRoleId: collaborator.jobRoleId,
        period: collaboratorPeriod,
        absences: absences.filter(absence => absence.collaboratorId === collaborator.id),
        allocations: allocations.filter(allocation => allocation.collaboratorId === collaborator.id),
        ignoredMissionId,
        allowMissionOverlap: Boolean(teamAllocation?.allowMissionOverlap),
        allowInactiveCollaborator: (payload.confirmedInactiveCollaboratorIds || []).includes(collaborator.id),
        requireCandidateMissionOverlapConfirmation: true
      });
    });
  });
  if (conflicts.length) {
    const names = [...new Set(conflicts.map(conflict => conflict.collaboratorName))];
    const label = names.length > 2 ? `${names.slice(0, 2).join(', ')} e mais ${names.length - 2}` : names.join(' e ');
    throw conflictError(`Não foi possível salvar a equipe: ${label} possui conflito no período informado.`, conflicts);
  }
  return team;
}

export async function syncSelectedMissionTeam(tx, missionId, team, context = {}) {
  const selectedIds = team.allocations.map(item => item.collaboratorId);
  await tx.efetivoMissionAllocation.updateMany({
    where: {
      missionId,
      deletedAt: null,
      ...(selectedIds.length ? { collaboratorId: { notIn: selectedIds } } : {})
    },
    data: { deletedAt: new Date() }
  });

  const missionBounds = tx.efetivoMissionPlan
    ? await tx.efetivoMissionPlan.findUnique({
      where: { id: missionId },
      select: { mobilizationDate: true, executionEndDate: true, returnDate: true }
    })
    : null;
  const stored = [];
  for (const allocation of team.allocations) {
    const { cycles: _cycles, ...allocationData } = allocation;
    const saved = await tx.efetivoMissionAllocation.upsert({
      where: { missionId_collaboratorId: { missionId, collaboratorId: allocation.collaboratorId } },
      create: {
        missionId,
        ...allocationData,
        source: 'MANUAL',
        createdByUserId: context.actorUserId || null
      },
      update: {
        jobRoleId: allocation.jobRoleId,
        jobRoleNameSnapshot: allocation.jobRoleNameSnapshot,
        mobilizationDate: allocation.mobilizationDate || null,
        demobilizationDate: allocation.demobilizationDate || null,
        allowMissionOverlap: Boolean(allocation.allowMissionOverlap),
        source: 'MANUAL',
        deletedAt: null
      }
    });
    stored.push(saved);
    if (tx.efetivoAllocationCycle && (allocation.mobilizationDate || allocation.demobilizationDate)) {
      const existingCycle = await tx.efetivoAllocationCycle.findFirst({ where: { allocationId: saved.id } });
      if (!existingCycle) {
        await tx.efetivoAllocationCycle.create({
          data: {
            allocationId: saved.id,
            mobilizationDate: allocation.mobilizationDate || missionBounds?.mobilizationDate,
            demobilizationDate: allocation.demobilizationDate || missionBounds?.returnDate || missionBounds?.executionEndDate,
            createdByUserId: context.actorUserId || null
          }
        });
      }
    }
  }
  return stored;
}
