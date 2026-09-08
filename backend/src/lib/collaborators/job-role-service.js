import { allocationPeriod } from '../efetivo/planning/allocation-period.js';
import { missionEndsOnOrAfter } from '../efetivo/planning/mission-period.js';
import { collaboratorJobRoleHistoryInclude } from './job-role-history.js';

export function normalizeJobRoleKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ');
}

export function indexJobRolesByNormalizedKey(jobRoles = []) {
  const index = new Map();
  for (const jobRole of jobRoles) {
    const key = normalizeJobRoleKey(jobRole.normalizedKey || jobRole.name);
    if (!key) continue;
    const matches = index.get(key) || [];
    matches.push(jobRole);
    index.set(key, matches);
  }
  return index;
}

export function planCanonicalJobRoleBackfill(collaborators = [], jobRoles = []) {
  const roleIndex = indexJobRolesByNormalizedKey(jobRoles);
  const matches = [];
  const unresolved = [];

  for (const collaborator of collaborators) {
    if (collaborator.jobRoleId) continue;
    const roleName = collaborator.role ?? collaborator.legacyRole;
    const candidates = roleIndex.get(normalizeJobRoleKey(roleName)) || [];
    if (candidates.length === 1) {
      matches.push({
        collaboratorId: collaborator.id,
        jobRoleId: candidates[0].id,
        jobRoleName: candidates[0].name
      });
      continue;
    }
    unresolved.push({
      collaboratorId: collaborator.id,
      collaboratorName: collaborator.name || null,
      legacyRole: roleName || null,
      reason: candidates.length > 1 ? 'AMBIGUOUS' : 'NOT_FOUND',
      candidateIds: candidates.map(candidate => candidate.id)
    });
  }

  return { matches, unresolved };
}

export function collaboratorCurrentRoleName(collaborator) {
  return String(collaborator?.jobRole?.name || '').trim();
}

export const collaboratorJobRoleSelect = Object.freeze({
  id: true,
  name: true,
  jobRoleId: true,
  jobRole: { select: { id: true, name: true, isActive: true, isOperational: true } }
});

export function withCurrentJobRole(collaborator) {
  if (!collaborator) return collaborator;
  return {
    ...collaborator,
    currentRoleName: collaboratorCurrentRoleName(collaborator),
    // Alias somente de DTO para clientes existentes; não é campo persistido nem aceito em escrita.
    role: collaboratorCurrentRoleName(collaborator)
  };
}

export async function listCollaboratorsWithCurrentJobRole(database, prepareCollaborator = async item => item) {
  const items = await database.collaborator.findMany({
    include: {
      jobRole: true,
      jobRoleHistory: {
        include: collaboratorJobRoleHistoryInclude,
        orderBy: { effectiveDate: 'desc' }
      }
    },
    orderBy: { name: 'asc' }
  });
  const result = [];
  for (const item of items) {
    const prepared = await prepareCollaborator(item);
    result.push(withCurrentJobRole({ ...prepared, jobRole: item.jobRole }));
  }
  return result;
}

function jobRoleError(message, code) {
  const error = new Error(message);
  error.status = 400;
  error.statusCode = 400;
  error.code = code;
  return error;
}

export async function requireCanonicalJobRole(database, jobRoleId, options = {}) {
  const role = await database.jobRole.findUnique({ where: { id: jobRoleId } });
  if (!role) throw jobRoleError('Cargo não encontrado.', 'JOB_ROLE_NOT_FOUND');
  if (options.requireActive !== false && !role.isActive) {
    throw jobRoleError('O cargo selecionado está inativo.', 'JOB_ROLE_INACTIVE');
  }
  if (options.requireOperational && !role.isOperational) {
    throw jobRoleError('O cargo selecionado não é operacional.', 'JOB_ROLE_NOT_OPERATIONAL');
  }
  return role;
}

export async function markFutureAllocationsForReplanning(database, collaboratorId, jobRoleId) {
  const allocations = await database.efetivoMissionAllocation.findMany({
    where: {
      collaboratorId,
      deletedAt: null,
      jobRoleId: { not: jobRoleId },
      mission: {
        deletedAt: null,
        scheduleStatus: { not: 'CANCELLED' },
        ...missionEndsOnOrAfter(new Date())
      }
    },
    select: {
      missionId: true,
      mobilizationDate: true,
      demobilizationDate: true,
      mission: { select: { planId: true, mobilizationDate: true, executionEndDate: true, returnDate: true } }
    }
  });
  const today = new Date().toISOString().slice(0, 10);
  const futureAllocations = allocations.filter(item => allocationPeriod(item, item.mission).endDate >= today);
  const missionIds = [...new Set(futureAllocations.map(item => item.missionId))];
  const planIds = [...new Set(futureAllocations.map(item => item.mission.planId))];

  if (missionIds.length) {
    await database.efetivoMissionPlan.updateMany({
      where: { id: { in: missionIds } },
      data: {
        needsReplanning: true,
        replanningReason: 'Cargo canônico do colaborador foi alterado.',
        version: { increment: 1 }
      }
    });
  }
  if (planIds.length) {
    await database.efetivoPlan.updateMany({
      where: { id: { in: planIds } },
      data: { revision: { increment: 1 } }
    });
  }
  return missionIds;
}

export async function setCollaboratorCanonicalJobRole(database, collaboratorId, jobRoleId, options = {}) {
  const role = await requireCanonicalJobRole(database, jobRoleId, options);
  const existing = await database.collaborator.findUnique({
    where: { id: collaboratorId },
    select: { id: true, jobRoleId: true }
  });
  if (!existing) {
    const error = new Error('Colaborador não encontrado.');
    error.status = 404;
    error.statusCode = 404;
    throw error;
  }

  const collaborator = existing.jobRoleId === role.id
    ? await database.collaborator.findUnique({ where: { id: collaboratorId }, include: { jobRole: true } })
    : await database.collaborator.update({
      where: { id: collaboratorId },
      data: { jobRoleId: role.id },
      include: { jobRole: true }
    });
  const affectedMissionIds = existing.jobRoleId === role.id
    ? []
    : await markFutureAllocationsForReplanning(database, collaboratorId, role.id);

  return { collaborator, affectedMissionIds };
}
