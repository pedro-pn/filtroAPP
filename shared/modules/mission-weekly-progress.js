const DAY_MS = 86_400_000;

export function dateOnlyKey(value) {
  if (value instanceof Date && !Number.isFinite(value.getTime())) return null;
  const key = value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const date = new Date(`${key}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === key ? key : null;
}

export function weekStartKey(value) {
  const key = dateOnlyKey(value);
  if (!key) return null;
  const date = new Date(`${key}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

export function corporateToday(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(value);
  const part = type => parts.find(item => item.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function addDays(key, days) {
  return new Date(new Date(`${key}T00:00:00.000Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

const round = value => Math.round((value + Number.EPSILON) * 100) / 100;

// O histórico contém avanço acumulado. A meta compara somente o ganho da semana,
// carregando o último acumulado por semanas sem medições e preservando regressões.
export function buildWeeklyProgressComparison({ targets = [], progressHistory = [], today = corporateToday() } = {}) {
  const currentWeek = weekStartKey(today);
  if (!currentWeek) return [];
  const latestTargets = new Map();
  for (const target of targets) {
    const week = weekStartKey(target.weekStartDate);
    if (!week) continue;
    if (!latestTargets.has(week) || target.revision > latestTargets.get(week).revision) latestTargets.set(week, target);
  }
  const points = progressHistory.map(point => ({ date: dateOnlyKey(point.date), progressPct: point.progressPct }))
    .filter(point => point.date && point.date <= today && point.progressPct != null && Number.isFinite(Number(point.progressPct)))
    .sort((a, b) => a.date.localeCompare(b.date));
  const weeks = new Set([...latestTargets.keys(), currentWeek]);
  if (points.length) {
    for (let week = weekStartKey(points[0].date); week <= currentWeek; week = addDays(week, 7)) weeks.add(week);
  }
  let pointIndex = 0;
  let accumulated = 0;
  return [...weeks].sort().map(week => {
    while (pointIndex < points.length && points[pointIndex].date < week) accumulated = Number(points[pointIndex++].progressPct);
    const before = accumulated;
    const weekEndDate = addDays(week, 6);
    while (pointIndex < points.length && points[pointIndex].date <= weekEndDate) accumulated = Number(points[pointIndex++].progressPct);
    const target = latestTargets.get(week) ?? null;
    const plannedPctPoints = target ? Number(target.plannedPctPoints) : null;
    const actualPctPoints = week > currentWeek || !points.length ? null : round(accumulated - before);
    const differencePctPoints = plannedPctPoints != null && actualPctPoints != null ? round(actualPctPoints - plannedPctPoints) : null;
    const status = !target ? 'NO_TARGET' : week > currentWeek ? 'PLANNED' : actualPctPoints == null ? 'NO_DATA'
      : differencePctPoints > 0 ? 'ABOVE' : differencePctPoints < 0 ? 'BELOW' : 'ON_TARGET';
    return { weekStartDate: week, weekEndDate, plannedPctPoints, actualPctPoints, differencePctPoints, status, inProgress: week === currentWeek, target };
  }).reverse();
}
