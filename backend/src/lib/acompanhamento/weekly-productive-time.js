import { dateOnlyKey } from '../../../../shared/modules/mission-weekly-progress.js';
import { isPointWorkbookDerivedRdoRoster } from './avanco.js';
import { normalizeRdoServiceType } from './service-types.js';

const ids = value => (Array.isArray(value) ? value : []).filter(id => typeof id === 'string' && id.trim());

// Colaboradores-dia das metas "por colaborador por dia": cada pessoa da equipe do RDO
// (inclusive o turno noturno) conta 1 no dia, em cada tipo de serviço registrado nos
// RDOs daquele dia. Horários de serviço e jornada não entram; a mesma pessoa em mais
// de um RDO do dia (ou projeto do grupo) conta uma vez. Equipes inferidas da planilha
// de ponto precisam de confirmação antes de valer.
export function buildWeeklyProductiveHistory(reports = []) {
  const days = new Map();
  for (const report of reports) {
    const date = dateOnlyKey(report.reportDate);
    if (!date || report.deletedAt || report.reportType !== 'RDO') continue;
    if (!days.has(date)) days.set(date, { crew: new Set(), serviceTypes: new Set(), unconfirmed: false });
    const day = days.get(date);
    for (const service of report.services ?? []) {
      const serviceType = normalizeRdoServiceType(service.serviceType);
      if (serviceType) day.serviceTypes.add(serviceType); // Deslocamento e outros períodos não são serviço.
    }
    if (isPointWorkbookDerivedRdoRoster(report)) { day.unconfirmed = true; continue; }
    const special = report.specialConditions ?? {};
    const night = special.noturno || special.noturnoDetails?.enabled ? special.noturnoDetails?.collaboratorIds : [];
    for (const id of [...(report.collaborators ?? []).map(link => link.collaboratorId), ...ids(night)]) if (id) day.crew.add(id);
  }
  return [...days].flatMap(([date, day]) => [...day.serviceTypes].map(serviceType => ({
    date, serviceType, quantities: { M: 0, L: 0, UN: 0 }, productivePersonDays: day.crew.size,
    productivityIssues: day.unconfirmed ? ['UNCONFIRMED_TEAM'] : day.crew.size ? [] : ['MISSING_TEAM']
  }))).sort((a, b) => a.date.localeCompare(b.date) || a.serviceType.localeCompare(b.serviceType));
}

export async function loadWeeklyProductiveHistory(projectIds, client) {
  const reports = await client.report.findMany({
    where: { projectId: { in: projectIds }, reportType: 'RDO', deletedAt: null },
    select: { reportType: true, reportDate: true, specialConditions: true,
      collaborators: { select: { collaboratorId: true } }, services: { select: { serviceType: true } } }
  });
  return buildWeeklyProductiveHistory(reports);
}
