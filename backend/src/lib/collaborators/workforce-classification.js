import { z } from 'zod';
import { corporateToday } from '../../../../shared/modules/mission-weekly-progress.js';
import { clearCollaboratorDerivedCaches } from '../resource-list-cache.js';
import { missionEndsOnOrAfter } from '../efetivo/planning/mission-period.js';
import { WORKFORCE_CLASSIFICATIONS, classificationWhere, workforcePolicySummary } from './workforce-policy.js';

const classification = z.enum(WORKFORCE_CLASSIFICATIONS);
const reason = z.string().trim().min(3).max(1000);
export const workforceListQuery = z.object({
  q: z.string().trim().max(120).optional(),
  classification: classification.optional(),
  jobRoleId: z.string().max(100).optional(),
  sector: z.string().trim().max(100).optional(),
  active: z.enum(['true', 'false']).optional(),
  divergence: z.enum(['true']).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(100)
}).strict();
export const workforceBatchInput = z.object({
  items: z.array(z.object({ id: z.string().min(1).max(100), version: z.number().int().positive() }).strict()).min(1).max(200),
  classification: classification.nullable(),
  sector: z.string().trim().max(100).nullable().optional(),
  reason
}).strict().refine(input => new Set(input.items.map(item => item.id)).size === input.items.length, 'Seleção duplicada.');
export const workforceRoleInput = z.object({ classification, version: z.number().int().positive(), reason }).strict();

function conflict() {
  return Object.assign(new Error('A classificação foi alterada por outra pessoa. Atualize a lista e tente novamente.'), { status: 409, code: 'CLASSIFICATION_VERSION_CONFLICT' });
}

export async function markWorkforceForReplanning(tx, collaboratorIds) {
  if (!collaboratorIds.length) return [];
  const missions = await tx.efetivoMissionPlan.findMany({
    where: { deletedAt: null, scheduleStatus: { not: 'CANCELLED' },
      ...missionEndsOnOrAfter(new Date(`${corporateToday()}T00:00:00.000Z`), { includeOpenCycles: true }),
      AND: [{ OR: [
        { allocations: { some: { collaboratorId: { in: collaboratorIds }, deletedAt: null } } },
        { headquartersResponsibleCollaboratorId: { in: collaboratorIds } }
      ] }] },
    select: { id: true, planId: true }
  });
  if (missions.length) {
    await tx.efetivoMissionPlan.updateMany({ where: { id: { in: missions.map(item => item.id) } }, data: {
      needsReplanning: true, replanningReason: 'Classificação da equipe alterada. Revise a participação operacional.', version: { increment: 1 }
    } });
    await tx.efetivoPlan.updateMany({ where: { id: { in: [...new Set(missions.map(item => item.planId))] } }, data: { revision: { increment: 1 } } });
  }
  return missions.map(item => item.id);
}

export async function listWorkforce(database, input) {
  const query = workforceListQuery.parse(input);
  const where = { AND: [
    ...(query.q ? [{ OR: ['name', 'code', 'registrationNumber'].map(field => ({ [field]: { contains: query.q, mode: 'insensitive' } })) }] : []),
    ...(query.jobRoleId ? [{ jobRoleId: query.jobRoleId }] : []),
    ...(query.sector ? [{ workforceSector: { contains: query.sector, mode: 'insensitive' } }] : []),
    ...(query.active ? [{ isActive: query.active === 'true' }] : []),
    ...(query.classification ? [classificationWhere(query.classification)] : []),
    ...(query.divergence ? [{ OR: [
      { AND: [{ sourceIsOperational: true }, classificationWhere('NON_OPERATIONAL')] },
      { AND: [{ sourceIsOperational: false }, classificationWhere('OPERATIONAL')] }
    ] }] : [])
  ] };
  return database.$transaction(async tx => {
    const total = await tx.collaborator.count({ where });
    const items = await tx.collaborator.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: (query.page - 1) * query.limit, take: query.limit,
      select: { id: true, code: true, name: true, registrationNumber: true, isActive: true, rhStatus: true,
        workforceSector: true, sourceIsOperational: true, workforceClassificationOverride: true, classificationVersion: true,
        jobRole: { select: { id: true, name: true, isOperational: true, workforceClassification: true } } }
    });
    return { items: items.map(item => ({ ...item, ...workforcePolicySummary(item) })), total, page: query.page, limit: query.limit };
  }, { isolationLevel: 'RepeatableRead' });
}

export async function updateWorkforceBatch(database, input, actorUserId) {
  const payload = workforceBatchInput.parse(input);
  const result = await database.$transaction(async tx => {
    const rows = await tx.collaborator.findMany({ where: { id: { in: payload.items.map(item => item.id) } }, include: { jobRole: true } });
    if (rows.length !== payload.items.length) throw conflict();
    const byId = new Map(rows.map(item => [item.id, item]));
    const changes = [];
    // Deterministic order avoids competing bulk updates locking in reverse order.
    for (const selected of [...payload.items].sort((a, b) => a.id.localeCompare(b.id))) {
      const previous = byId.get(selected.id);
      const changed = await tx.collaborator.updateMany({ where: { id: selected.id, classificationVersion: selected.version }, data: {
        workforceClassificationOverride: payload.classification,
        ...(payload.sector !== undefined ? { workforceSector: payload.sector || null } : {}), classificationVersion: { increment: 1 }
      } });
      if (changed.count !== 1) throw conflict();
      const before = { classification: previous.workforceClassificationOverride, sector: previous.workforceSector };
      const after = { classification: payload.classification, sector: payload.sector === undefined ? previous.workforceSector : payload.sector || null };
      await tx.workforceClassificationEvent.create({ data: { entityType: 'COLLABORATOR', entityId: previous.id, actorUserId, reason: payload.reason, before, after } });
      changes.push(previous.id);
    }
    const affectedMissionIds = await markWorkforceForReplanning(tx, changes);
    return { updated: changes.length, affectedMissionIds };
  }, { timeout: 20000 });
  clearCollaboratorDerivedCaches();
  return result;
}

// Also used by the existing job-role editors, so their changes survive RH sync.
export async function setRoleClassification(tx, jobRoleId, value, { actorUserId = null, reason: note = 'Classificação alterada no cadastro de cargos.', version } = {}) {
  const previous = await tx.jobRole.findUnique({ where: { id: jobRoleId } });
  if (!previous) throw Object.assign(new Error('Cargo não encontrado.'), { status: 404 });
  const updated = await tx.jobRole.updateMany({ where: { id: jobRoleId, classificationVersion: version ?? previous.classificationVersion }, data: {
    workforceClassification: value, isOperational: value === 'OPERATIONAL', classificationManagedLocally: true, classificationVersion: { increment: 1 }
  } });
  if (updated.count !== 1) throw conflict();
  await tx.workforceClassificationEvent.create({ data: {
    entityType: 'JOB_ROLE', entityId: jobRoleId, actorUserId, reason: note,
    before: { classification: previous.workforceClassification, managedLocally: previous.classificationManagedLocally },
    after: { classification: value, managedLocally: true }
  } });
  const inherited = await tx.collaborator.findMany({ where: { jobRoleId, workforceClassificationOverride: null }, select: { id: true } });
  await tx.collaborator.updateMany({ where: { jobRoleId, workforceClassificationOverride: null }, data: { classificationVersion: { increment: 1 } } });
  const affectedMissionIds = await markWorkforceForReplanning(tx, inherited.map(item => item.id));
  return { role: await tx.jobRole.findUnique({ where: { id: jobRoleId } }), affectedMissionIds };
}

export async function updateWorkforceRole(database, id, input, actorUserId) {
  const payload = workforceRoleInput.parse(input);
  const result = await database.$transaction(tx => setRoleClassification(tx, id, payload.classification, { ...payload, actorUserId }), { timeout: 20000 });
  clearCollaboratorDerivedCaches();
  return result;
}
