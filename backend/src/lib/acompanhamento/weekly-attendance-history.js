import prisma from '../prisma.js';
import { dateOnlyKey } from '../../../../shared/modules/mission-weekly-progress.js';
import { isPointWorkbookDerivedRdoRoster } from './avanco.js';
import { weeklyTargetProjectIds } from './weekly-progress-targets.js';

// Conta a equipe do RDO, independentemente do cargo, serviço, produção ou horas.
// A mesma pessoa em mais de um RDO, turno ou projeto do grupo conta uma vez no dia.
export function buildWeeklyAttendanceHistory(reports = []) {
  const days = new Map();
  for (const report of reports) {
    const date = dateOnlyKey(report.reportDate);
    if (!date || report.deletedAt || report.reportType !== 'RDO') continue;
    if (!days.has(date)) days.set(date, { date, collaboratorIds: new Set(), attendanceIssues: new Set() });
    const day = days.get(date);
    if (isPointWorkbookDerivedRdoRoster(report)) {
      day.attendanceIssues.add('UNCONFIRMED_TEAM');
      continue;
    }
    const special = report.specialConditions ?? {};
    const nightIds = special.noturno || special.noturnoDetails?.enabled ? special.noturnoDetails?.collaboratorIds : [];
    const crew = [...(report.collaborators ?? []).map(link => link.collaboratorId), ...(Array.isArray(nightIds) ? nightIds : [])];
    for (const id of crew) if (typeof id === 'string' && id.trim()) day.collaboratorIds.add(id);
  }
  return [...days.values()].map(day => ({ date: day.date, collaboratorIds: [...day.collaboratorIds].sort(), attendanceIssues: [...day.attendanceIssues].sort() }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function loadWeeklyAttendanceHistory(owner, { client = prisma } = {}) {
  const projectIds = await weeklyTargetProjectIds(owner, client);
  if (!projectIds.length) return [];
  const reports = await client.report.findMany({
    where: { projectId: { in: projectIds }, reportType: 'RDO', deletedAt: null },
    select: { reportType: true, reportDate: true, specialConditions: true, collaborators: { select: { collaboratorId: true } } }
  });
  return buildWeeklyAttendanceHistory(reports);
}
