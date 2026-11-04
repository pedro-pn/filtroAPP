import prisma from '../../prisma.js';
import { clearProjectDerivedCaches } from '../../resource-list-cache.js';
import { invalidateAllocationAudit } from '../../acompanhamento/allocation-audit.js';
import { isAppAdmin } from '../access.js';
import { cancelAlertsForRows, createAlertsForConfirmedRows } from './absence-alerts.js';
import { assembleReviewWeek, loadReviewWeekContext, saoPauloToday, utcDate, weekDateKeys } from './read-model.js';
import { PROJECT_KINDS } from './schemas.js';
import { sameAllocation } from './suggestion.js';

/*
 * Escritas da conferência semanal de alocação (feature 037).
 * Toda escrita exige a versão atual da semana (0 = semana ainda sem registro) e incrementa a
 * versão. Só dias de linhas conferidas passam a valer no custo HH e no relatório mensal.
 */

export class AllocationReviewError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function invalidateCaches() {
  invalidateAllocationAudit();
  clearProjectDerivedCaches();
}

async function currentWeek(database, weekStart) {
  return database.allocationReviewWeek.findUnique({ where: { weekStart: utcDate(weekStart) } });
}

function assertVersion(week, expectedVersion) {
  const current = week?.version || 0;
  if (expectedVersion === null || expectedVersion === undefined || expectedVersion !== current) {
    throw new AllocationReviewError(
      'WEEK_VERSION_CONFLICT',
      'A semana foi alterada por outra pessoa. Atualize a página e refaça a alteração.',
      409,
      { currentVersion: current }
    );
  }
}

function assertOpen(week) {
  if (week?.status === 'CLOSED') {
    throw new AllocationReviewError('WEEK_CLOSED', 'A semana está fechada. Peça a um administrador para reabrir.', 409);
  }
}

// Incrementa a versão (ou cria a semana) dentro da transação, protegendo contra corrida.
async function bumpWeek(tx, weekStart, week, expectedVersion, data = {}) {
  if (!week) {
    try {
      return await tx.allocationReviewWeek.create({ data: { weekStart: utcDate(weekStart), version: 1, ...data } });
    } catch (error) {
      if (error?.code === 'P2002') {
        throw new AllocationReviewError('WEEK_VERSION_CONFLICT', 'A semana foi alterada por outra pessoa. Atualize a página e refaça a alteração.', 409);
      }
      throw error;
    }
  }
  const result = await tx.allocationReviewWeek.updateMany({
    where: { id: week.id, version: expectedVersion },
    data: { version: { increment: 1 }, ...data }
  });
  if (result.count !== 1) {
    throw new AllocationReviewError('WEEK_VERSION_CONFLICT', 'A semana foi alterada por outra pessoa. Atualize a página e refaça a alteração.', 409);
  }
  return tx.allocationReviewWeek.findUnique({ where: { id: week.id } });
}

async function ensureRow(tx, weekId, collaboratorId) {
  return tx.allocationReviewRow.upsert({
    where: { weekId_collaboratorId: { weekId, collaboratorId } },
    create: { weekId, collaboratorId },
    update: {}
  });
}

async function writeDay(tx, { rowId, collaboratorId, date, value, note, suggestion, fingerprint = null, userId }) {
  const data = {
    rowId,
    kind: value.kind,
    note: note ?? null,
    differsFromSuggestion: !sameAllocation(value, suggestion),
    suggestionSnapshot: { kind: suggestion.kind, projectIds: suggestion.projectIds },
    sourceFingerprint: fingerprint,
    updatedByUserId: userId || null
  };
  const day = await tx.allocationReviewDay.upsert({
    where: { collaboratorId_workDate: { collaboratorId, workDate: utcDate(date) } },
    create: { collaboratorId, workDate: utcDate(date), ...data },
    update: data
  });
  await tx.allocationReviewDayProject.deleteMany({ where: { dayId: day.id } });
  const projectIds = PROJECT_KINDS.has(value.kind) ? [...new Set(value.projectIds)] : [];
  if (projectIds.length) {
    await tx.allocationReviewDayProject.createMany({ data: projectIds.map(projectId => ({ dayId: day.id, projectId })) });
  }
  return day;
}

async function assembleFor(weekStart, collaboratorIds, { now, user }, deps) {
  const context = await loadReviewWeekContext({ weekStart, collaboratorIds }, deps);
  return assembleReviewWeek(context, { now, user });
}

function rowsByCollaborator(assembled) {
  return new Map(assembled.rows.map(row => [row.collaborator.id, row]));
}

function validateItemsInWeek(weekStart, items, today) {
  const dates = new Set(weekDateKeys(weekStart));
  for (const item of items) {
    if (!dates.has(item.date)) {
      throw new AllocationReviewError('INVALID_DAY', `O dia ${item.date} não pertence à semana.`, 400);
    }
    if (item.date > today) {
      throw new AllocationReviewError('INVALID_DAY', 'Dias futuros não podem ser conferidos.', 400);
    }
  }
}

async function validateProjects(database, items, rows) {
  const ids = [...new Set(items.flatMap(item => item.projectIds || []))];
  if (!ids.length) return;
  const projects = await database.project.findMany({
    where: { id: { in: ids } },
    select: { id: true, isActive: true, deletedAt: true }
  });
  const byId = new Map(projects.map(project => [project.id, project]));
  for (const item of items) {
    const day = rows.get(item.collaboratorId)?.days.find(entry => entry.date === item.date);
    for (const projectId of item.projectIds || []) {
      const project = byId.get(projectId);
      if (!project || project.deletedAt) {
        throw new AllocationReviewError('PROJECT_NOT_FOUND', 'Projeto não encontrado.', 404);
      }
      const isSource = day?.candidateProjectIds.includes(projectId) || day?.value?.projectIds?.includes(projectId);
      if (!project.isActive && !isSource) {
        throw new AllocationReviewError('PROJECT_INACTIVE', 'Projeto inativo só pode ser escolhido quando aparece nas fontes do dia.', 400);
      }
    }
  }
}

function assertEditableRows(items, rows) {
  for (const item of items) {
    const row = rows.get(item.collaboratorId);
    const day = row?.days.find(entry => entry.date === item.date);
    if (!row || !day?.eligible) {
      throw new AllocationReviewError('COLLABORATOR_NOT_ACTIVE', 'O colaborador não estava ativo neste dia.', 400);
    }
    if (row.confirmed) {
      throw new AllocationReviewError('ROW_CONFIRMED', `A semana de ${row.collaborator.name} já foi conferida. Desfaça a conferência para editar.`, 409);
    }
  }
}

function result(week, assembled) {
  return { version: week?.version || 0, rows: assembled.rows };
}

export async function saveReviewDays({ weekStart, items, expectedVersion, user, now = new Date() }, deps = {}) {
  const database = deps.database || prisma;
  const today = saoPauloToday(now);
  validateItemsInWeek(weekStart, items, today);
  const collaboratorIds = [...new Set(items.map(item => item.collaboratorId))];
  const week = await currentWeek(database, weekStart);
  assertOpen(week);
  assertVersion(week, expectedVersion);
  const before = await assembleFor(weekStart, collaboratorIds, { now, user }, deps);
  const rows = rowsByCollaborator(before);
  assertEditableRows(items, rows);
  await validateProjects(database, items, rows);

  const updated = await database.$transaction(async tx => {
    const saved = await bumpWeek(tx, weekStart, week, expectedVersion);
    for (const item of items) {
      const row = await ensureRow(tx, saved.id, item.collaboratorId);
      const day = rows.get(item.collaboratorId).days.find(entry => entry.date === item.date);
      await writeDay(tx, {
        rowId: row.id,
        collaboratorId: item.collaboratorId,
        date: item.date,
        value: { kind: item.kind, projectIds: item.projectIds || [] },
        note: item.note,
        suggestion: day.suggestion,
        userId: user?.id
      });
    }
    return saved;
  });
  invalidateCaches();
  return result(updated, await assembleFor(weekStart, collaboratorIds, { now, user }, deps));
}

export async function discardReviewDays({ weekStart, items, expectedVersion, user, now = new Date() }, deps = {}) {
  const database = deps.database || prisma;
  validateItemsInWeek(weekStart, items, '9999-12-31');
  const collaboratorIds = [...new Set(items.map(item => item.collaboratorId))];
  const week = await currentWeek(database, weekStart);
  assertOpen(week);
  assertVersion(week, expectedVersion);
  const before = await assembleFor(weekStart, collaboratorIds, { now, user }, deps);
  assertEditableRows(items, rowsByCollaborator(before));
  if (!week) return result(week, before);

  const updated = await database.$transaction(async tx => {
    const saved = await bumpWeek(tx, weekStart, week, expectedVersion);
    for (const item of items) {
      await tx.allocationReviewDay.deleteMany({
        where: { collaboratorId: item.collaboratorId, workDate: utcDate(item.date), row: { weekId: week.id } }
      });
    }
    return saved;
  });
  invalidateCaches();
  return result(updated, await assembleFor(weekStart, collaboratorIds, { now, user }, deps));
}

export async function confirmReviewRows({ weekStart, collaboratorIds = null, allReady = false, expectedVersion, user, now = new Date() }, deps = {}) {
  const database = deps.database || prisma;
  const week = await currentWeek(database, weekStart);
  assertOpen(week);
  assertVersion(week, expectedVersion);
  const assembled = await assembleFor(weekStart, allReady ? null : collaboratorIds, { now, user }, deps);
  let targets;
  if (allReady) {
    targets = assembled.rows.filter(row => row.canConfirm);
  } else {
    const rows = rowsByCollaborator(assembled);
    const blocked = [];
    targets = [];
    for (const id of collaboratorIds) {
      const row = rows.get(id);
      if (!row) throw new AllocationReviewError('COLLABORATOR_NOT_ACTIVE', 'Colaborador fora da semana.', 400);
      if (row.confirmed) continue;
      if (!row.canConfirm) blocked.push(id);
      else targets.push(row);
    }
    if (blocked.length) {
      throw new AllocationReviewError('ROW_HAS_PENDING', 'Resolva as pendências antes de conferir. Dias futuros também impedem a conferência.', 409, { collaboratorIds: blocked });
    }
  }
  if (!targets.length) return { ...result(week, assembled), confirmed: 0, alertsCreated: 0 };

  let alertsCreated = 0;
  const updated = await database.$transaction(async tx => {
    const saved = await bumpWeek(tx, weekStart, week, expectedVersion);
    for (const row of targets) {
      const savedRow = await ensureRow(tx, saved.id, row.collaborator.id);
      for (const day of row.days) {
        if (!day.eligible || day.isFuture || !day.value || day.value.kind === 'NONE') continue;
        await writeDay(tx, {
          rowId: savedRow.id,
          collaboratorId: row.collaborator.id,
          date: day.date,
          value: day.value,
          note: day.note,
          suggestion: day.suggestion,
          fingerprint: day.sourceFingerprint,
          userId: user?.id
        });
      }
      await tx.allocationReviewRow.update({
        where: { id: savedRow.id },
        data: { confirmedAt: now, confirmedByUserId: user?.id || null }
      });
    }
    alertsCreated = await createAlertsForConfirmedRows(tx, { weekId: saved.id, rows: targets });
    return saved;
  });
  invalidateCaches();
  const after = await assembleFor(weekStart, targets.map(row => row.collaborator.id), { now, user }, deps);
  return { ...result(updated, after), confirmed: targets.length, alertsCreated };
}

export async function unconfirmReviewRows({ weekStart, collaboratorIds, expectedVersion, user, now = new Date() }, deps = {}) {
  const database = deps.database || prisma;
  const week = await currentWeek(database, weekStart);
  assertOpen(week);
  assertVersion(week, expectedVersion);
  if (!week) return { ...result(week, await assembleFor(weekStart, collaboratorIds, { now, user }, deps)), alertsCancelled: 0 };
  let alertsCancelled = 0;
  const updated = await database.$transaction(async tx => {
    const saved = await bumpWeek(tx, weekStart, week, expectedVersion);
    await tx.allocationReviewRow.updateMany({
      where: { weekId: week.id, collaboratorId: { in: collaboratorIds } },
      data: { confirmedAt: null, confirmedByUserId: null }
    });
    alertsCancelled = await cancelAlertsForRows(tx, { weekId: week.id, collaboratorIds });
    return saved;
  });
  invalidateCaches();
  return { ...result(updated, await assembleFor(weekStart, collaboratorIds, { now, user }, deps)), alertsCancelled };
}

export async function closeReviewWeek({ weekStart, expectedVersion, user, now = new Date() }, deps = {}) {
  const database = deps.database || prisma;
  const week = await currentWeek(database, weekStart);
  assertOpen(week);
  assertVersion(week, expectedVersion);
  const assembled = await assembleFor(weekStart, null, { now, user }, deps);
  if (!assembled.week.ended) {
    throw new AllocationReviewError('WEEK_NOT_ENDED', 'A semana só pode ser fechada depois do domingo.', 409);
  }
  const pending = assembled.rows.filter(row => !row.confirmed).map(row => row.collaborator.id);
  if (pending.length || !assembled.rows.length) {
    throw new AllocationReviewError('ROWS_NOT_CONFIRMED', 'Todos os colaboradores precisam estar conferidos para fechar a semana.', 409, { pendingCollaboratorIds: pending });
  }
  const updated = await database.$transaction(async tx => {
    const saved = await bumpWeek(tx, weekStart, week, expectedVersion, {
      status: 'CLOSED', closedAt: now, closedByUserId: user?.id || null
    });
    await tx.allocationReviewWeekEvent.create({ data: { weekId: saved.id, type: 'CLOSED', actorUserId: user?.id || null } });
    return saved;
  });
  invalidateCaches();
  return { version: updated.version, week: (await assembleFor(weekStart, [], { now, user }, deps)).week };
}

export async function reopenReviewWeek({ weekStart, expectedVersion, note = null, user, now = new Date() }, deps = {}) {
  const database = deps.database || prisma;
  if (!isAppAdmin(user)) {
    throw new AllocationReviewError('ADMIN_REQUIRED', 'Só um administrador pode reabrir a semana.', 403);
  }
  const week = await currentWeek(database, weekStart);
  if (week?.status !== 'CLOSED') {
    throw new AllocationReviewError('WEEK_NOT_CLOSED', 'A semana não está fechada.', 409);
  }
  assertVersion(week, expectedVersion);
  const updated = await database.$transaction(async tx => {
    const saved = await bumpWeek(tx, weekStart, week, expectedVersion, { status: 'OPEN', closedAt: null, closedByUserId: null });
    await tx.allocationReviewWeekEvent.create({ data: { weekId: saved.id, type: 'REOPENED', actorUserId: user?.id || null, note: note || null } });
    return saved;
  });
  invalidateCaches();
  return { version: updated.version, week: (await assembleFor(weekStart, [], { now, user }, deps)).week };
}
