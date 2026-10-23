const day = value => value ? new Date(value).toISOString().slice(0, 10) : null;
const daysBetween = (start, end) => Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;

// Dias corridos, incluindo início e fim. Nenhum relatório é necessário.
export function rentalTracking(project, now = new Date()) {
  if (project?.serviceCategory !== 'RENTAL') return null;
  const startDate = day(project.startDate), endDate = day(project.endDate);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const plannedDays = startDate && endDate && endDate >= startDate ? daysBetween(startDate, endDate) : null;
  const elapsedDays = startDate ? Math.max(0, daysBetween(startDate, endDate && endDate < today ? endDate : today)) : null;
  return { startDate, endDate, plannedDays, elapsedDays,
    remainingDays: plannedDays == null || elapsedDays == null ? null : Math.max(0, plannedDays - elapsedDays),
    status: !startDate ? 'NO_DATES' : startDate > today ? 'SCHEDULED' : endDate && endDate < today ? 'ENDED' : 'ACTIVE' };
}
