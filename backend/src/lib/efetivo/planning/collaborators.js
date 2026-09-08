import crypto from 'node:crypto';

import { markFutureAllocationsForReplanning, withCurrentJobRole } from '../../collaborators/job-role-service.js';
import { synchronizeCurrentCollaboratorJobRole, validateCollaboratorRoleEffectiveDate } from '../../collaborators/job-role-history.js';
import { recordEfetivoAudit } from './audit.js';
import {
  collectAllocationConflicts,
  ensureNoPlanningConflicts,
  loadCollaboratorConflictData,
  lockCollaborator
} from './conflicts.js';
import { parseDateKey, periodsOverlap } from './date-only.js';
import { conflictDescriptor, conflictError, notFound, planningError } from './errors.js';
import { allocationPeriods } from './allocation-period.js';
import { bumpPlanRevision, requireEditablePlan, resolvePlanningDatabase, runPlanningTransaction } from './plan-context.js';

function utcDate(value) {
  return value ? new Date(`${parseDateKey(value)}T00:00:00.000Z`) : null;
}

async function requireOperationalRole(tx, jobRoleId) {
  const role = await tx.jobRole.findFirst({ where: { id: jobRoleId, isActive: true, isOperational: true } });
  if (!role) throw planningError('Função operacional não encontrada.', { code: 'INVALID_JOB_ROLE' });
  return role;
}

function collaboratorData(payload, role) {
  return {
    name: payload.name.trim(),
    jobRoleId: role.id,
    admissionDate: utcDate(payload.admissionDate),
    terminationDate: utcDate(payload.terminationDate),
    efetivoNote: String(payload.note || '').trim() || null,
    isActive: !payload.terminationDate || parseDateKey(payload.terminationDate) >= new Date().toISOString().slice(0, 10)
  };
}

export function collectCollaboratorUpdateConflicts(collaborator, allocations = []) {
  return allocations.flatMap(allocation => allocationPeriods(allocation, allocation.mission)
    .flatMap(period => collectAllocationConflicts({
      collaborator,
      jobRoleId: allocation.jobRoleId,
      period,
      ignoredMissionId: allocation.mission.id,
      allowMissionOverlap: allocation.allowMissionOverlap
    })));
}

export async function createPlanningCollaborator(payload, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  return runPlanningTransaction(database, async tx => {
    const role = await requireOperationalRole(tx, payload.jobRoleId);
    const plan = await requireEditablePlan(tx, undefined, { actorUserId: context.actorUserId });
    const collaborator = await tx.collaborator.create({
      data: {
        code: `EF-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        ...collaboratorData(payload, role),
        jobRoleHistory: {
          create: {
            jobRoleId: role.id,
            effectiveDate: validateCollaboratorRoleEffectiveDate(
              { admissionDate: utcDate(payload.admissionDate) },
              payload.jobRoleEffectiveDate || payload.admissionDate
            )
          }
        }
      },
      include: { jobRole: true }
    });
    await bumpPlanRevision(tx, plan);
    await recordEfetivoAudit(tx, {
      planId: plan.id, actorUserId: context.actorUserId, action: 'COLLABORATOR_CREATE', entityType: 'COLLABORATOR', entityId: collaborator.id,
      summary: `${collaborator.name} incluído no efetivo operacional.`, afterData: collaborator, evidence: context.evidence
    });
    return withCurrentJobRole(collaborator);
  });
}

export async function updatePlanningCollaborator(collaboratorId, payload, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  return runPlanningTransaction(database, async tx => {
    const plan = await requireEditablePlan(tx, undefined, { actorUserId: context.actorUserId });
    await lockCollaborator(tx, collaboratorId);
    const existing = await tx.collaborator.findUnique({ where: { id: collaboratorId } });
    if (!existing) throw notFound('Colaborador não encontrado.');
    const role = await requireOperationalRole(tx, payload.jobRoleId);
    const nextData = collaboratorData(payload, role);
    const roleChanged = existing.jobRoleId !== nextData.jobRoleId;
    const { jobRoleId: nextJobRoleId, ...nonRoleData } = nextData;
    await tx.collaborator.update({ where: { id: collaboratorId }, data: nonRoleData });
    if (roleChanged) {
      const effectiveDate = validateCollaboratorRoleEffectiveDate(
        { ...existing, admissionDate: nonRoleData.admissionDate },
        payload.jobRoleEffectiveDate || new Date()
      );
      await tx.collaboratorJobRoleHistory.upsert({
        where: { collaboratorId_effectiveDate: { collaboratorId, effectiveDate } },
        create: { collaboratorId, jobRoleId: nextJobRoleId, effectiveDate },
        update: { jobRoleId: nextJobRoleId }
      });
      const synced = await synchronizeCurrentCollaboratorJobRole(tx, collaboratorId);
      if (synced.changed) await markFutureAllocationsForReplanning(tx, collaboratorId, synced.collaborator.jobRoleId);
    }
    const updated = await tx.collaborator.findUniqueOrThrow({ where: { id: collaboratorId }, include: { jobRole: true } });
    await bumpPlanRevision(tx, plan);
    await recordEfetivoAudit(tx, {
      planId: plan.id, actorUserId: context.actorUserId, action: 'COLLABORATOR_UPDATE', entityType: 'COLLABORATOR', entityId: collaboratorId,
      summary: `${updated.name} atualizado no efetivo operacional.`, beforeData: existing, afterData: updated, evidence: context.evidence
    });
    return withCurrentJobRole(updated);
  });
}

async function validateAbsenceConflicts(tx, plan, collaboratorId, period, ignoredAbsenceId = null) {
  const data = await loadCollaboratorConflictData(tx, collaboratorId, period, plan.id);
  if (!data.collaborator) throw notFound('Colaborador não encontrado.');
  const absenceConflict = data.absences.find(absence => absence.id !== ignoredAbsenceId && periodsOverlap(period, absence));
  const conflicts = collectAllocationConflicts({
    collaborator: data.collaborator,
    jobRoleId: data.collaborator.jobRoleId,
    period,
    absences: [],
    allocations: data.allocations
  });
  if (absenceConflict) conflicts.unshift(conflictDescriptor({
    collaborator: data.collaborator,
    startDate: parseDateKey(absenceConflict.startDate),
    endDate: parseDateKey(absenceConflict.endDate),
    sourceType: 'ABSENCE',
    sourceId: absenceConflict.id,
    entityPath: `/efetivo?section=colaboradores&colaborador=${collaboratorId}&ausencia=${absenceConflict.id}`,
    code: 'ABSENCE_OVERLAP'
  }));
  ensureNoPlanningConflicts(conflicts);
  return data.collaborator;
}

export async function createPlanningAbsence(payload, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  const period = { startDate: parseDateKey(payload.startDate), endDate: parseDateKey(payload.endDate) };
  return runPlanningTransaction(database, async tx => {
    const plan = await requireEditablePlan(tx, undefined, { actorUserId: context.actorUserId });
    await lockCollaborator(tx, payload.collaboratorId);
    const collaborator = await validateAbsenceConflicts(tx, plan, payload.collaboratorId, period);
    const absence = await tx.collaboratorAbsence.create({
      data: {
        collaboratorId: payload.collaboratorId,
        type: payload.type,
        startDate: utcDate(period.startDate),
        endDate: utcDate(period.endDate),
        note: String(payload.note || '').trim() || null,
        createdByUserId: context.actorUserId || null
      },
      include: { collaborator: { include: { jobRole: true } } }
    });
    await bumpPlanRevision(tx, plan);
    await recordEfetivoAudit(tx, {
      planId: plan.id, actorUserId: context.actorUserId, action: 'ABSENCE_CREATE', entityType: 'ABSENCE', entityId: absence.id,
      summary: `${payload.type} programado para ${collaborator.name}.`, afterData: absence, evidence: context.evidence
    });
    return { ...absence, collaborator: withCurrentJobRole(absence.collaborator) };
  });
}

export async function updatePlanningAbsence(absenceId, payload, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  return runPlanningTransaction(database, async tx => {
    const plan = await requireEditablePlan(tx, undefined, { actorUserId: context.actorUserId });
    const existing = await tx.collaboratorAbsence.findUnique({ where: { id: absenceId } });
    if (!existing || existing.deletedAt) throw notFound('Indisponibilidade não encontrada.');
    await lockCollaborator(tx, existing.collaboratorId);
    const period = {
      startDate: parseDateKey(payload.startDate ?? existing.startDate),
      endDate: parseDateKey(payload.endDate ?? existing.endDate)
    };
    if (period.endDate < period.startDate) throw planningError('A data final não pode ser anterior à inicial.');
    await validateAbsenceConflicts(tx, plan, existing.collaboratorId, period, absenceId);
    const updated = await tx.collaboratorAbsence.update({
      where: { id: absenceId },
      data: {
        type: payload.type ?? existing.type,
        startDate: utcDate(period.startDate),
        endDate: utcDate(period.endDate),
        ...(payload.note !== undefined ? { note: String(payload.note || '').trim() || null } : {})
      },
      include: { collaborator: { include: { jobRole: true } } }
    });
    await bumpPlanRevision(tx, plan);
    await recordEfetivoAudit(tx, {
      planId: plan.id, actorUserId: context.actorUserId, action: 'ABSENCE_UPDATE', entityType: 'ABSENCE', entityId: absenceId,
      summary: 'Indisponibilidade atualizada.', beforeData: existing, afterData: updated, evidence: context.evidence
    });
    return { ...updated, collaborator: withCurrentJobRole(updated.collaborator) };
  });
}

export async function deletePlanningAbsence(absenceId, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  return runPlanningTransaction(database, async tx => {
    const plan = await requireEditablePlan(tx, undefined, { actorUserId: context.actorUserId });
    const existing = await tx.collaboratorAbsence.findUnique({ where: { id: absenceId } });
    if (!existing || existing.deletedAt) throw notFound('Indisponibilidade não encontrada.');
    await lockCollaborator(tx, existing.collaboratorId);
    const deleted = await tx.collaboratorAbsence.update({ where: { id: absenceId }, data: { deletedAt: new Date() } });
    await bumpPlanRevision(tx, plan);
    await recordEfetivoAudit(tx, {
      planId: plan.id, actorUserId: context.actorUserId, action: 'ABSENCE_DELETE', entityType: 'ABSENCE', entityId: absenceId,
      summary: 'Indisponibilidade removida.', beforeData: existing, afterData: deleted, evidence: context.evidence
    });
    return deleted;
  });
}

export async function getPlanningAbsence(absenceId, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  const absence = await database.collaboratorAbsence.findUnique({ where: { id: absenceId } });
  if (!absence || absence.deletedAt) throw notFound('Indisponibilidade não encontrada.');
  return absence;
}

export async function listPlanningAbsences(filters = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  return database.collaboratorAbsence.findMany({
    where: {
      deletedAt: null,
      type: { in: ['FERIAS', 'FOLGA', 'AFASTAMENTO'] },
      ...(filters.collaboratorId ? { collaboratorId: filters.collaboratorId } : {}),
      ...(filters.startDate ? { startDate: { lte: utcDate(filters.endDate || filters.startDate) }, endDate: { gte: utcDate(filters.startDate) } } : {})
    },
    include: { collaborator: { include: { jobRole: true } } },
    orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }]
  }).then(items => items.map(item => ({ ...item, collaborator: withCurrentJobRole(item.collaborator) })));
}
