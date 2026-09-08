import { corporateDateKey, loadCorporateCalendar } from '../calendar/corporate-calendar.js';
import { allocationPeriod } from '../efetivo/planning/allocation-period.js';
import { missionEndsOnOrAfter } from '../efetivo/planning/mission-period.js';

function utcDate(value) {
  return new Date(`${corporateDateKey(value)}T00:00:00.000Z`);
}

export function availabilityPeriodsOverlap(left, right) {
  const leftStart = corporateDateKey(left.startDate);
  const leftEnd = corporateDateKey(left.endDate);
  const rightStart = corporateDateKey(right.startDate);
  const rightEnd = corporateDateKey(right.endDate);
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

function workforceError(message, code, status = 400, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.statusCode = status;
  Object.assign(error, details);
  return error;
}

async function currentCalendarState(database) {
  return database.workforceCalendarState.upsert({
    where: { id: 'global' },
    create: { id: 'global', revision: 1 },
    update: {}
  });
}

export async function bumpWorkforceCalendarRevision(database) {
  await currentCalendarState(database);
  return database.workforceCalendarState.update({
    where: { id: 'global' },
    data: { revision: { increment: 1 } }
  });
}

export async function markMissionsAffectedByAbsence(database, collaboratorId, period) {
  const allocations = await database.efetivoMissionAllocation.findMany({
    where: {
      collaboratorId,
      deletedAt: null,
      mission: {
        deletedAt: null,
        scheduleStatus: { not: 'CANCELLED' },
        mobilizationDate: { lte: utcDate(period.endDate) },
        ...missionEndsOnOrAfter(utcDate(period.startDate))
      }
    },
    select: {
      missionId: true,
      mobilizationDate: true,
      demobilizationDate: true,
      mission: { select: { mobilizationDate: true, executionEndDate: true, returnDate: true } }
    }
  });
  const missionIds = [...new Set(allocations
    .filter(item => availabilityPeriodsOverlap(allocationPeriod(item, item.mission), period))
    .map(item => item.missionId))];
  if (missionIds.length) {
    await database.efetivoMissionPlan.updateMany({
      where: { id: { in: missionIds } },
      data: {
        needsReplanning: true,
        replanningReason: 'Ausência cadastrada sobre a equipe planejada.',
        version: { increment: 1 }
      }
    });
  }
  return missionIds;
}

async function assertNoAbsenceOverlap(database, collaboratorId, period, ignoredAbsenceId = null) {
  const existing = await database.collaboratorAbsence.findFirst({
    where: {
      collaboratorId,
      deletedAt: null,
      ...(ignoredAbsenceId ? { id: { not: ignoredAbsenceId } } : {}),
      startDate: { lte: utcDate(period.endDate) },
      endDate: { gte: utcDate(period.startDate) }
    }
  });
  if (existing) {
    throw workforceError('Já existe uma ausência sobreposta para este colaborador.', 'ABSENCE_OVERLAP', 409, {
      conflictId: existing.id
    });
  }
}

export async function createWorkforceAbsence(database, payload, context = {}) {
  const period = { startDate: corporateDateKey(payload.startDate), endDate: corporateDateKey(payload.endDate) };
  if (period.endDate < period.startDate) throw workforceError('A data final não pode ser anterior à inicial.', 'INVALID_PERIOD');
  return database.$transaction(async tx => {
    const collaborator = await tx.collaborator.findUnique({ where: { id: payload.collaboratorId } });
    if (!collaborator) throw workforceError('Colaborador não encontrado.', 'COLLABORATOR_NOT_FOUND', 404);
    await assertNoAbsenceOverlap(tx, payload.collaboratorId, period);
    const absence = await tx.collaboratorAbsence.create({
      data: {
        collaboratorId: payload.collaboratorId,
        type: payload.type,
        startDate: utcDate(period.startDate),
        endDate: utcDate(period.endDate),
        note: String(payload.note || '').trim() || null,
        createdByUserId: context.actorUserId || null,
        updatedByUserId: context.actorUserId || null
      },
      include: { collaborator: { include: { jobRole: true } } }
    });
    const affectedMissionIds = await markMissionsAffectedByAbsence(tx, payload.collaboratorId, period);
    const calendarState = await bumpWorkforceCalendarRevision(tx);
    return { absence, affectedMissionIds, calendarRevision: calendarState.revision };
  });
}

export async function updateWorkforceAbsence(database, absenceId, payload, context = {}) {
  return database.$transaction(async tx => {
    const existing = await tx.collaboratorAbsence.findUnique({ where: { id: absenceId } });
    if (!existing || existing.deletedAt) throw workforceError('Ausência não encontrada.', 'ABSENCE_NOT_FOUND', 404);
    if (context.expectedVersion && existing.version !== context.expectedVersion) {
      throw workforceError('A ausência foi alterada por outro usuário.', 'VERSION_CONFLICT', 409, { currentVersion: existing.version });
    }
    const period = {
      startDate: corporateDateKey(payload.startDate ?? existing.startDate),
      endDate: corporateDateKey(payload.endDate ?? existing.endDate)
    };
    if (period.endDate < period.startDate) throw workforceError('A data final não pode ser anterior à inicial.', 'INVALID_PERIOD');
    await assertNoAbsenceOverlap(tx, existing.collaboratorId, period, absenceId);
    const absence = await tx.collaboratorAbsence.update({
      where: { id: absenceId },
      data: {
        type: payload.type ?? existing.type,
        startDate: utcDate(period.startDate),
        endDate: utcDate(period.endDate),
        ...(payload.note !== undefined ? { note: String(payload.note || '').trim() || null } : {}),
        updatedByUserId: context.actorUserId || null,
        version: { increment: 1 }
      },
      include: { collaborator: { include: { jobRole: true } } }
    });
    const affectedMissionIds = await markMissionsAffectedByAbsence(tx, existing.collaboratorId, period);
    const calendarState = await bumpWorkforceCalendarRevision(tx);
    return { absence, affectedMissionIds, calendarRevision: calendarState.revision };
  });
}

export async function deleteWorkforceAbsence(database, absenceId, context = {}) {
  return database.$transaction(async tx => {
    const existing = await tx.collaboratorAbsence.findUnique({ where: { id: absenceId } });
    if (!existing || existing.deletedAt) throw workforceError('Ausência não encontrada.', 'ABSENCE_NOT_FOUND', 404);
    if (context.expectedVersion && existing.version !== context.expectedVersion) {
      throw workforceError('A ausência foi alterada por outro usuário.', 'VERSION_CONFLICT', 409, { currentVersion: existing.version });
    }
    await tx.collaboratorAbsence.update({
      where: { id: absenceId },
      data: { deletedAt: new Date(), updatedByUserId: context.actorUserId || null, version: { increment: 1 } }
    });
    const calendarState = await bumpWorkforceCalendarRevision(tx);
    return { calendarRevision: calendarState.revision };
  });
}

export async function listWorkforceAbsences(database, filters = {}) {
  return database.collaboratorAbsence.findMany({
    where: {
      deletedAt: null,
      type: { in: ['FERIAS', 'FOLGA', 'AFASTAMENTO'] },
      ...(filters.collaboratorId ? { collaboratorId: filters.collaboratorId } : {}),
      ...(filters.startDate ? {
        startDate: { lte: utcDate(filters.endDate || filters.startDate) },
        endDate: { gte: utcDate(filters.startDate) }
      } : {})
    },
    include: { collaborator: { include: { jobRole: true } } },
    orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }]
  });
}

export async function checkWorkforceAvailability(database, input) {
  const startDate = corporateDateKey(input.startDate);
  const endDate = corporateDateKey(input.endDate);
  const collaboratorIds = [...new Set(input.collaboratorIds || [])];
  const [absences, allocations, calendar] = await Promise.all([
    database.collaboratorAbsence.findMany({
      where: {
        collaboratorId: { in: collaboratorIds },
        deletedAt: null,
        startDate: { lte: utcDate(endDate) },
        endDate: { gte: utcDate(startDate) }
      }
    }),
    database.efetivoMissionAllocation.findMany({
      where: {
        collaboratorId: { in: collaboratorIds },
        deletedAt: null,
        mission: {
          deletedAt: null,
          scheduleStatus: 'CONFIRMED',
          mobilizationDate: { lte: utcDate(endDate) },
          ...missionEndsOnOrAfter(utcDate(startDate))
        }
      },
      include: { mission: true }
    }),
    loadCorporateCalendar(database, startDate, endDate)
  ]);
  const actual = input.context === 'ACTUAL_REPORT';
  const conflicts = [
    ...absences.map(absence => ({
      code: actual ? 'WORK_DURING_ABSENCE' : 'ABSENCE',
      collaboratorId: absence.collaboratorId,
      sourceId: absence.id,
      startDate: corporateDateKey(absence.startDate),
      endDate: corporateDateKey(absence.endDate),
      policy: actual ? 'REQUIRE_JUSTIFICATION' : 'BLOCK'
    })),
    ...(actual ? [] : allocations.flatMap(allocation => {
      const period = allocationPeriod(allocation, allocation.mission);
      if (!availabilityPeriodsOverlap(period, { startDate, endDate })) return [];
      return [{
        code: 'MISSION',
        collaboratorId: allocation.collaboratorId,
        sourceId: allocation.missionId,
        startDate: period.startDate,
        endDate: period.endDate,
        policy: 'BLOCK'
      }];
    })),
    ...(actual ? calendar.holidays.flatMap(holiday => collaboratorIds.map(collaboratorId => ({
      code: 'WORK_ON_HOLIDAY',
      collaboratorId,
      sourceId: holiday.id || holiday.date,
      startDate: holiday.date,
      endDate: holiday.date,
      policy: 'WARN'
    }))) : [])
  ];
  return { calendarRevision: calendar.revision, holidays: calendar.holidays, conflicts };
}
