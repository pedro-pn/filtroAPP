import { checkWorkforceAvailability } from '../collaborators/availability-service.js';

export function actualWorkforceConflictSummary(availability, justification = '') {
  const conflicts = availability?.conflicts || [];
  const requiresJustification = conflicts.some(item => item.policy === 'REQUIRE_JUSTIFICATION');
  const normalizedJustification = String(justification || '').trim();
  if (requiresJustification && !normalizedJustification) {
    const error = new Error('Justifique o trabalho registrado durante uma ausência cadastrada.');
    error.code = 'WORKFORCE_JUSTIFICATION_REQUIRED';
    error.status = 409;
    error.statusCode = 409;
    error.conflicts = conflicts;
    throw error;
  }
  return {
    calendarRevision: availability?.calendarRevision || 1,
    conflicts,
    justification: normalizedJustification || null,
    checkedAt: new Date().toISOString()
  };
}

export async function resolveActualWorkforceContext(database, {
  collaboratorIds = [],
  reportDate,
  justification = ''
}) {
  const ids = [...new Set(collaboratorIds.filter(Boolean))];
  if (!ids.length) return { calendarRevision: 1, conflicts: [], justification: null, checkedAt: new Date().toISOString() };
  const availability = await checkWorkforceAvailability(database, {
    collaboratorIds: ids,
    startDate: reportDate,
    endDate: reportDate,
    context: 'ACTUAL_REPORT'
  });
  return actualWorkforceConflictSummary(availability, justification);
}

export function annotateActualRowsWithWorkforceConflicts(rows = [], conflicts = []) {
  const byCollaborator = new Map();
  for (const conflict of conflicts) {
    const values = byCollaborator.get(conflict.collaboratorId) || [];
    values.push(conflict);
    byCollaborator.set(conflict.collaboratorId, values);
  }
  return rows.map(row => {
    const workedDates = new Set(Array.isArray(row.workedDates) ? row.workedDates : []);
    const matching = (byCollaborator.get(row.collaboratorId) || []).filter(conflict => (
      !workedDates.size || [...workedDates].some(date => date >= conflict.startDate && date <= conflict.endDate)
    ));
    return { ...row, workforceConflicts: matching };
  });
}

function addDate(date) {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

export function classifyActualWorkforceDays({ startDate, endDate, workedDates = [], conflicts = [] }) {
  const worked = new Set(workedDates);
  const absenceRanges = conflicts.filter(item => item.code === 'WORK_DURING_ABSENCE');
  const holidayDates = new Set(conflicts.filter(item => item.code === 'WORK_ON_HOLIDAY').map(item => item.startDate));
  const result = { workedDuringAbsence: [], workedOnHoliday: [], absence: [], holiday: [], residualDaysOff: [] };
  for (let date = startDate; date <= endDate; date = addDate(date)) {
    const isAbsence = absenceRanges.some(item => date >= item.startDate && date <= item.endDate);
    const isHoliday = holidayDates.has(date);
    if (worked.has(date)) {
      if (isAbsence) result.workedDuringAbsence.push(date);
      if (isHoliday) result.workedOnHoliday.push(date);
      continue;
    }
    const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    if (day === 0 || day === 6) continue;
    if (isAbsence) result.absence.push(date);
    else if (isHoliday) result.holiday.push(date);
    else result.residualDaysOff.push(date);
  }
  return result;
}
