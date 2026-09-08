import { addCalendarDays, parseDateKey } from './date-only.js';

function anniversaryDate(admissionDate, years) {
  const admission = parseDateKey(admissionDate);
  const [year, month, day] = admission.split('-').map(Number);
  const candidate = `${year + years}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  try { return parseDateKey(candidate); } catch {
    return `${year + years}-02-28`;
  }
}

export function buildVacationAlert(collaborator, absences = [], positionValue) {
  if (!collaborator.admissionDate) return null;
  const position = parseDateKey(positionValue);
  const admission = parseDateKey(collaborator.admissionDate);
  if (position < admission) return null;
  const admissionYear = Number(admission.slice(0, 4));
  const positionYear = Number(position.slice(0, 4));
  const openCycles = [];
  for (let cycle = 1; cycle <= positionYear - admissionYear + 1; cycle += 1) {
    const acquisitionEnd = addCalendarDays(anniversaryDate(admission, cycle), -1);
    if (acquisitionEnd > position) break;
    const concessionStart = addCalendarDays(acquisitionEnd, 1);
    const concessionDeadline = addCalendarDays(anniversaryDate(admission, cycle + 1), -1);
    const vacationRegistered = absences.some(absence => absence.collaboratorId === collaborator.id
      && absence.type === 'FERIAS' && !absence.deletedAt
      && parseDateKey(absence.startDate) <= concessionDeadline
      && parseDateKey(absence.endDate) >= concessionStart);
    if (!vacationRegistered) openCycles.push({ acquisitionEnd, concessionStart, concessionDeadline });
  }
  if (!openCycles.length) return null;
  const overdue = openCycles.find(cycle => cycle.concessionDeadline < position);
  if (overdue) return { type: 'OVERDUE', label: 'Férias vencidas', ...overdue };
  const upcoming = openCycles.find(cycle => cycle.concessionDeadline <= addCalendarDays(position, 120));
  if (upcoming) {
    return { type: 'SCHEDULE', label: 'Programar férias', ...upcoming };
  }
  return null;
}

export function buildVacationAlerts(collaborators, absences, position) {
  return collaborators.map(collaborator => ({ collaborator, alert: buildVacationAlert(collaborator, absences, position) }))
    .filter(item => item.alert);
}
