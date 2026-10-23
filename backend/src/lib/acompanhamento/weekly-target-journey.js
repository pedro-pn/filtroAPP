import { corporateDateKey, isCorporateHoliday, loadCorporateCalendar, resolveCorporateCalendar } from '../calendar/corporate-calendar.js';

const FRIDAY = 5, SATURDAY = 6, SUNDAY = 0;

export function journeyMinutes(value) {
  const match = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match || +match[2] >= 60) return null;
  const minutes = +match[1] * 60 + +match[2];
  return minutes > 0 && minutes <= 24 * 60 ? minutes : null;
}

const label = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

// Mesma regra das horas extras dos relatórios: segunda a quinta usam a jornada
// padrão; sexta, fim de semana e feriados, a jornada de fim de semana. Num
// agrupamento com jornadas diferentes vale a maior, e a divergência é informada.
export function buildWeeklyTargetJourney(projects = []) {
  const members = projects.map(project => ({
    projectId: project.id, code: project.code ?? null,
    weekdayMinutes: journeyMinutes(project.workdayHours), weekendMinutes: journeyMinutes(project.weekendWorkdayHours || project.workdayHours)
  }));
  if (!members.length || members.some(member => member.weekdayMinutes == null || member.weekendMinutes == null)) return null;
  const weekdayMinutes = Math.max(...members.map(member => member.weekdayMinutes));
  const weekendMinutes = Math.max(...members.map(member => member.weekendMinutes));
  const divergent = members.some(member => member.weekdayMinutes !== members[0].weekdayMinutes || member.weekendMinutes !== members[0].weekendMinutes);
  const workdays = [1, 2, 3, 4, 5,
    ...(projects.some(project => project.includesSaturday) ? [SATURDAY] : []), ...(projects.some(project => project.includesSunday) ? [SUNDAY] : [])];
  return {
    weekdayMinutes, weekendMinutes, weekdayHours: label(weekdayMinutes), weekendHours: label(weekendMinutes), workdays,
    divergentMembers: divergent ? members.map(member => ({ projectId: member.projectId, code: member.code,
      weekdayHours: label(member.weekdayMinutes), weekendHours: label(member.weekendMinutes) })) : null
  };
}

export function journeyMinutesForDate(date, journey, holidays) {
  if (!journey) return null;
  const day = new Date(`${corporateDateKey(date)}T00:00:00.000Z`).getUTCDay();
  return day === FRIDAY || day === SATURDAY || day === SUNDAY || isCorporateHoliday(date, holidays)
    ? journey.weekendMinutes : journey.weekdayMinutes;
}

export const JOURNEY_PROJECT_SELECT = { id: true, code: true, workdayHours: true, weekendWorkdayHours: true, includesSaturday: true, includesSunday: true };

export async function loadWeeklyTargetJourney(projectIds, client) {
  if (!projectIds.length) return null;
  const projects = await client.project.findMany({ where: { id: { in: projectIds }, deletedAt: null }, select: JOURNEY_PROJECT_SELECT });
  return projects.length === projectIds.length ? buildWeeklyTargetJourney(projects) : null;
}

export async function loadJourneyHolidays(client, dates) {
  const keys = dates.filter(Boolean).sort();
  if (!keys.length) return null;
  // Sem a tabela de feriados da empresa (ex.: testes), valem os feriados nacionais.
  return client?.workforceHoliday ? loadCorporateCalendar(client, keys[0], keys.at(-1)) : resolveCorporateCalendar({ startDate: keys[0], endDate: keys.at(-1) });
}
