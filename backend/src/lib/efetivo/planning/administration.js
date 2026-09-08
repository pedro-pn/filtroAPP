import { recordEfetivoAudit } from './audit.js';
import { bumpWorkforceCalendarRevision } from '../../collaborators/availability-service.js';
import { parseDateKey } from './date-only.js';
import { notFound } from './errors.js';
import { bumpPlanRevision, requireEditablePlan, resolvePlanningDatabase, runPlanningTransaction } from './plan-context.js';

function utcDate(value) {
  return new Date(`${parseDateKey(value)}T00:00:00.000Z`);
}

export async function updatePlanningJobRole(jobRoleId, payload, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  return runPlanningTransaction(database, async tx => {
    const existing = await tx.jobRole.findUnique({ where: { id: jobRoleId } });
    if (!existing) throw notFound('Função não encontrada.');
    const plan = await requireEditablePlan(tx, undefined, { actorUserId: context.actorUserId });
    const updated = await tx.jobRole.update({ where: { id: jobRoleId }, data: payload });
    await bumpPlanRevision(tx, plan);
    await recordEfetivoAudit(tx, {
      planId: plan.id, actorUserId: context.actorUserId, action: 'JOB_ROLE_CONFIG_UPDATE', entityType: 'JOB_ROLE', entityId: jobRoleId,
      summary: `Configuração operacional de ${updated.name} atualizada.`, beforeData: existing, afterData: updated, evidence: context.evidence
    });
    return updated;
  });
}

export async function listHolidays(filters, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  return database.workforceHoliday.findMany({
    where: {
      deletedAt: null,
      ...(filters?.startDate ? { holidayDate: { gte: utcDate(filters.startDate), ...(filters.endDate ? { lte: utcDate(filters.endDate) } : {}) } } : {})
    },
    orderBy: { holidayDate: 'asc' }
  });
}

export async function saveHoliday(payload, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  return runPlanningTransaction(database, async tx => {
    const plan = await requireEditablePlan(tx, undefined, { actorUserId: context.actorUserId });
    const date = utcDate(payload.holidayDate);
    const existing = await tx.workforceHoliday.findUnique({ where: { holidayDate: date } });
    const holiday = await tx.workforceHoliday.upsert({
      where: { holidayDate: date },
      create: { holidayDate: date, name: payload.name.trim(), source: 'COMPANY', createdByUserId: context.actorUserId || null, updatedByUserId: context.actorUserId || null },
      update: { name: payload.name.trim(), deletedAt: null, updatedByUserId: context.actorUserId || null }
    });
    await bumpPlanRevision(tx, plan);
    await bumpWorkforceCalendarRevision(tx);
    await recordEfetivoAudit(tx, {
      planId: plan.id, actorUserId: context.actorUserId, action: existing ? 'HOLIDAY_UPDATE' : 'HOLIDAY_CREATE', entityType: 'HOLIDAY', entityId: holiday.id,
      summary: `Feriado ${holiday.name} salvo.`, beforeData: existing, afterData: holiday, evidence: context.evidence
    });
    return holiday;
  });
}

export async function updateHoliday(holidayId, payload, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  return runPlanningTransaction(database, async tx => {
    const existing = await tx.workforceHoliday.findUnique({ where: { id: holidayId } });
    if (!existing || existing.deletedAt) throw notFound('Feriado não encontrado.');
    const plan = await requireEditablePlan(tx, undefined, { actorUserId: context.actorUserId });
    const updated = await tx.workforceHoliday.update({ where: { id: holidayId }, data: { holidayDate: utcDate(payload.holidayDate), name: payload.name.trim(), updatedByUserId: context.actorUserId || null } });
    await bumpPlanRevision(tx, plan);
    await bumpWorkforceCalendarRevision(tx);
    await recordEfetivoAudit(tx, { planId: plan.id, actorUserId: context.actorUserId, action: 'HOLIDAY_UPDATE', entityType: 'HOLIDAY', entityId: holidayId, summary: `Feriado ${updated.name} atualizado.`, beforeData: existing, afterData: updated, evidence: context.evidence });
    return updated;
  });
}

export async function deleteHoliday(holidayId, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  return runPlanningTransaction(database, async tx => {
    const existing = await tx.workforceHoliday.findUnique({ where: { id: holidayId } });
    if (!existing || existing.deletedAt) throw notFound('Feriado não encontrado.');
    const plan = await requireEditablePlan(tx, undefined, { actorUserId: context.actorUserId });
    const deleted = await tx.workforceHoliday.update({ where: { id: holidayId }, data: { deletedAt: new Date(), updatedByUserId: context.actorUserId || null } });
    await bumpPlanRevision(tx, plan);
    await bumpWorkforceCalendarRevision(tx);
    await recordEfetivoAudit(tx, { planId: plan.id, actorUserId: context.actorUserId, action: 'HOLIDAY_DELETE', entityType: 'HOLIDAY', entityId: holidayId, summary: `Feriado ${existing.name} removido.`, beforeData: existing, afterData: deleted, evidence: context.evidence });
    return deleted;
  });
}

export async function updatePlanningSettings(payload, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  return runPlanningTransaction(database, async tx => {
    const plan = await requireEditablePlan(tx, undefined, { actorUserId: context.actorUserId });
    const existing = await tx.efetivoSetting.findUnique({ where: { key: 'plannedUtilizationTarget' } });
    const setting = await tx.efetivoSetting.upsert({
      where: { key: 'plannedUtilizationTarget' },
      create: { key: 'plannedUtilizationTarget', numberValue: payload.plannedUtilizationTarget, updatedByUserId: context.actorUserId || null },
      update: { numberValue: payload.plannedUtilizationTarget, updatedByUserId: context.actorUserId || null }
    });
    await bumpPlanRevision(tx, plan);
    await recordEfetivoAudit(tx, { planId: plan.id, actorUserId: context.actorUserId, action: 'SETTING_UPDATE', entityType: 'SETTING', entityId: setting.key, summary: 'Meta de utilização planejada atualizada.', beforeData: existing, afterData: setting, evidence: context.evidence });
    return { plannedUtilizationTarget: setting.numberValue, updatedAt: setting.updatedAt, updatedByUserId: setting.updatedByUserId };
  });
}

export async function getPlanningSettings(dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  const setting = await database.efetivoSetting.findUnique({ where: { key: 'plannedUtilizationTarget' } });
  return {
    plannedUtilizationTarget: setting?.numberValue ?? 80,
    updatedAt: setting?.updatedAt || null,
    updatedByUserId: setting?.updatedByUserId || null
  };
}

export async function listPlanningActivity(filters = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  const limit = Math.min(100, Math.max(1, Number(filters.limit || 30)));
  const rows = await database.efetivoAuditEvent.findMany({
    where: filters.cursor ? { createdAt: { lt: new Date(filters.cursor) } } : {},
    orderBy: { createdAt: 'desc' }, take: limit + 1
  });
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const actorIds = [...new Set(items.map(item => item.actorUserId).filter(Boolean))];
  const actors = actorIds.length ? await database.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [];
  const names = new Map(actors.map(item => [item.id, item.name]));
  return {
    items: items.map(item => ({ ...item, actorName: names.get(item.actorUserId) || null })),
    nextCursor: hasMore ? items.at(-1)?.createdAt?.toISOString() || null : null
  };
}

export async function listEfetivoRoleUsers(dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  return database.user.findMany({
    where: {
      isActive: true,
      OR: [
        { accountType: 'ADMIN' },
        { moduleRoles: { some: { module: 'EFETIVO' } } }
      ]
    },
    select: { id: true, name: true, accountType: true, moduleRoles: { where: { module: 'EFETIVO' }, select: { role: true } } },
    orderBy: { name: 'asc' }
  });
}
