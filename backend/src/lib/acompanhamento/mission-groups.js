import { hasSameClient, sameClientName } from './client-identity.js';

const ACTIVE = 'ACTIVE';
const DISSOLVED = 'DISSOLVED';
const VISUAL_ONLY = 'VISUAL_ONLY';
const SHARED_EXECUTION = 'SHARED_EXECUTION';
const CONSOLIDATE_PRIMARY = 'CONSOLIDATE_PRIMARY';
const LABOR_ALLOCATION_MODES = new Set([VISUAL_ONLY, SHARED_EXECUTION, CONSOLIDATE_PRIMARY]);
let prismaClient = null;

async function getDb(db) {
  if (db) return db;
  if (!prismaClient) {
    prismaClient = (await import('../prisma.js')).default;
  }
  return prismaClient;
}

const projectSelect = {
  id: true,
  code: true,
  name: true,
  clientName: true,
  clientCnpj: true,
  deletedAt: true,
  isActive: true
};

const groupInclude = {
  members: {
    orderBy: { order: 'asc' },
    include: { project: { select: projectSelect } }
  }
};

const visibleGroupInclude = {
  members: {
    ...groupInclude.members,
    where: { project: { managerOnly: false } }
  }
};

const visibleGroupWhere = { members: { some: { project: { managerOnly: false } } } };

export class MissionGroupError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MissionGroupError';
    this.code = code;
  }
}

function trimName(name) {
  const value = typeof name === 'string' ? name.trim() : '';
  return value || null;
}

function distinctProjectIds(projectIds) {
  return Array.from(new Set((projectIds ?? []).map(id => String(id || '').trim()).filter(Boolean)));
}

function commonClient(projects) {
  return hasSameClient(projects) ? sameClientName(projects) : null;
}

function generatedName(projects) {
  const sorted = projects.slice().sort((a, b) => String(a.code).localeCompare(String(b.code), 'pt-BR'));
  const codes = sorted.map(project => project.code).filter(Boolean).join(' + ');
  const client = commonClient(sorted);
  return client ? `${client} — ${codes}` : `Missões ${codes}`;
}

function groupWarning(projects) {
  return hasSameClient(projects) ? null : 'As missões selecionadas têm clientes diferentes.';
}

export function serializeMissionGroup(group, { warning = null } = {}) {
  const members = (group.members ?? [])
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(member => ({
      projectId: member.projectId,
      code: member.project?.code ?? '',
      name: member.project?.name ?? '',
      clientName: member.project?.clientName ?? '',
      clientCnpj: member.project?.clientCnpj ?? '',
      order: member.order ?? 0
    }));

  return {
    id: group.id,
    name: group.name,
    status: group.status,
    laborAllocationMode: LABOR_ALLOCATION_MODES.has(group.laborAllocationMode)
      ? group.laborAllocationMode
      : VISUAL_ONLY,
    primaryLaborProjectId: group.primaryLaborProjectId ?? null,
    createdAt: group.createdAt instanceof Date ? group.createdAt.toISOString() : group.createdAt,
    updatedAt: group.updatedAt instanceof Date ? group.updatedAt.toISOString() : group.updatedAt,
    dissolvedAt: group.dissolvedAt instanceof Date ? group.dissolvedAt.toISOString() : (group.dissolvedAt ?? null),
    members,
    ...(warning ? { warning } : {})
  };
}

export async function listMissionGroups({ status = ACTIVE, db = null } = {}) {
  db = await getDb(db);
  const where = status === 'ALL' ? {} : { status };
  const groups = await db.acompanhamentoMissionGroup.findMany({
    where: { ...where, ...visibleGroupWhere },
    orderBy: { createdAt: 'desc' },
    include: visibleGroupInclude
  });
  return groups.map(group => serializeMissionGroup(group));
}

export async function loadActiveMissionGroups({ db = null } = {}) {
  db = await getDb(db);
  return db.acompanhamentoMissionGroup.findMany({
    where: { status: ACTIVE, ...visibleGroupWhere },
    orderBy: { createdAt: 'asc' },
    include: visibleGroupInclude
  });
}

export async function getActiveMissionGroup({ groupId, db = null } = {}) {
  db = await getDb(db);
  const group = await db.acompanhamentoMissionGroup.findUnique({
    where: { id: groupId },
    include: visibleGroupInclude
  });
  if (!group || group.members.length === 0) {
    throw new MissionGroupError('GROUP_NOT_FOUND', 'Agrupamento não encontrado.');
  }
  if (group.status !== ACTIVE) {
    throw new MissionGroupError('GROUP_NOT_ACTIVE', 'Agrupamento não encontrado ou já desmesclado.');
  }
  return group;
}

export async function createMissionGroup({ name, projectIds, userId = null, db = null } = {}) {
  db = await getDb(db);
  const ids = distinctProjectIds(projectIds);
  if (ids.length < 2) {
    throw new MissionGroupError('MIN_MEMBERS', 'Selecione pelo menos duas missões para unificar.');
  }

  const run = async (tx) => {
    const projects = await tx.project.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: projectSelect
    });
    if (projects.length !== ids.length) {
      throw new MissionGroupError('PROJECT_NOT_FOUND', 'Uma ou mais missões selecionadas não existem ou foram removidas.');
    }

    const activeMembers = await tx.acompanhamentoMissionGroupMember.findMany({
      where: { activeProjectId: { in: ids } },
      select: { projectId: true }
    });
    if (activeMembers.length > 0) {
      throw new MissionGroupError('PROJECT_ALREADY_GROUPED', 'Uma ou mais missões já pertencem a outro agrupamento ativo.');
    }

    const projectsById = new Map(projects.map(project => [project.id, project]));
    const orderedProjects = ids.map(id => projectsById.get(id));
    const displayName = trimName(name) ?? generatedName(orderedProjects);
    const group = await tx.acompanhamentoMissionGroup.create({
      data: {
        name: displayName,
        status: ACTIVE,
        laborAllocationMode: VISUAL_ONLY,
        primaryLaborProjectId: null,
        createdByUserId: userId,
        members: {
          create: ids.map((projectId, order) => ({
            projectId,
            activeProjectId: projectId,
            order
          }))
        }
      },
      include: groupInclude
    });
    return serializeMissionGroup(group, { warning: groupWarning(orderedProjects) });
  };

  return db.$transaction ? db.$transaction(run) : run(db);
}

export async function updateMissionGroup({
  groupId,
  name,
  laborAllocationMode,
  primaryLaborProjectId = null,
  db = null
} = {}) {
  db = await getDb(db);
  const updatesName = name !== undefined;
  const displayName = updatesName ? trimName(name) : null;
  if (updatesName && (!displayName || displayName.length > 120)) {
    throw new MissionGroupError('INVALID_NAME', 'Informe um nome com até 120 caracteres.');
  }
  const updatesLaborPolicy = laborAllocationMode !== undefined;
  if (updatesLaborPolicy && !LABOR_ALLOCATION_MODES.has(laborAllocationMode)) {
    throw new MissionGroupError('INVALID_LABOR_ALLOCATION_MODE', 'Política de mão de obra inválida.');
  }
  if (!updatesName && !updatesLaborPolicy) {
    throw new MissionGroupError('NO_CHANGES', 'Informe o nome ou a política de mão de obra a alterar.');
  }

  const existing = await db.acompanhamentoMissionGroup.findUnique({
    where: { id: groupId },
    include: groupInclude
  });
  if (!existing || existing.status !== ACTIVE) {
    throw new MissionGroupError('GROUP_NOT_ACTIVE', 'Agrupamento não encontrado ou já desmesclado.');
  }

  let normalizedPrimaryProjectId = existing.primaryLaborProjectId ?? null;
  if (updatesLaborPolicy) {
    normalizedPrimaryProjectId = laborAllocationMode === CONSOLIDATE_PRIMARY
      ? String(primaryLaborProjectId || '').trim() || null
      : null;
    if (laborAllocationMode === CONSOLIDATE_PRIMARY) {
      const memberIds = new Set((existing.members || []).map(member => member.projectId));
      if (!normalizedPrimaryProjectId || !memberIds.has(normalizedPrimaryProjectId)) {
        throw new MissionGroupError(
          'PRIMARY_NOT_MEMBER',
          'Selecione como missão principal um projeto que pertença a este agrupamento.'
        );
      }
    }
  }

  const group = await db.acompanhamentoMissionGroup.update({
    where: { id: groupId },
    data: {
      ...(updatesName ? { name: displayName } : {}),
      ...(updatesLaborPolicy ? {
        laborAllocationMode,
        primaryLaborProjectId: normalizedPrimaryProjectId
      } : {})
    },
    include: groupInclude
  });
  return serializeMissionGroup(group);
}

export async function renameMissionGroup({ groupId, name, db = null } = {}) {
  return updateMissionGroup({ groupId, name, db });
}

export async function dissolveMissionGroup({ groupId, userId = null, db = null } = {}) {
  db = await getDb(db);
  const run = async (tx) => {
    const group = await tx.acompanhamentoMissionGroup.findUnique({
      where: { id: groupId },
      include: groupInclude
    });
    if (!group) {
      throw new MissionGroupError('GROUP_NOT_FOUND', 'Agrupamento não encontrado.');
    }
    if (group.status !== ACTIVE) {
      throw new MissionGroupError('GROUP_NOT_ACTIVE', 'Este agrupamento já foi desmesclado.');
    }

    const dissolvedAt = new Date();
    await tx.acompanhamentoMissionGroupMember.updateMany({
      where: { groupId },
      data: { activeProjectId: null }
    });
    await tx.acompanhamentoMissionGroup.update({
      where: { id: groupId },
      data: {
        status: DISSOLVED,
        dissolvedAt,
        dissolvedByUserId: userId
      }
    });
    return { ok: true, groupId, dissolvedAt: dissolvedAt.toISOString() };
  };

  return db.$transaction ? db.$transaction(run) : run(db);
}

export const MISSION_GROUP_STATUS = {
  ACTIVE,
  DISSOLVED
};

export const MISSION_GROUP_LABOR_ALLOCATION_MODE = {
  VISUAL_ONLY,
  SHARED_EXECUTION,
  CONSOLIDATE_PRIMARY
};
