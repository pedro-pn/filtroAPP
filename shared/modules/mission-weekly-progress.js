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

export const WEEKLY_TARGET_METRICS = { PCT_POINTS: 'Avanço percentual (p.p.)', M: 'Metragem (m)', L: 'Volume filtrado / óleo (L)', UN: 'Unidades de sistema (un)' };
export const WEEKLY_TARGET_SERVICES = { LIMPEZA_QUIMICA: 'Limpeza química', TESTE_PRESSAO: 'Teste de pressão', FLUSHING: 'Flushing', FILTRAGEM: 'Filtragem' };
export const weeklyTargetUnit = metric => ({ PCT_POINTS: 'p.p.', M: 'm', L: 'L', UN: 'un' }[metric]);

export function weeklyTargetGoalMetric(metric, goal, condition) {
  const serviceType = goal.serviceType ?? (condition?.kind === 'SERVICE_SET' && condition.serviceTypes.length === 1 ? condition.serviceTypes[0] : null);
  return metric !== 'PCT_POINTS' && serviceType === 'FILTRAGEM' ? 'L' : metric;
}

export function weeklyTargetDefinition(target) {
  return target?.definition ?? {
    metric: 'PCT_POINTS', basis: 'WEEK_TOTAL', scenarios: [{ name: 'Meta geral', condition: { kind: 'ALWAYS' }, goals: [{ serviceType: null, value: Number(target?.plannedPctPoints ?? 0) }] }]
  };
}

function comparisonStatus(differences) {
  return differences.some(value => value < 0) ? 'BELOW' : differences.some(value => value > 0) ? 'ABOVE' : 'ON_TARGET';
}

function compareTarget({ target, week, currentWeek, actualPctPoints, servicePoints }) {
  const definition = weeklyTargetDefinition(target), metric = definition.metric;
  const basis = definition.basis ?? 'WEEK_TOTAL';
  const weekPoints = servicePoints.filter(point => point.date >= week && point.date <= addDays(week, 6));
  const activeServiceTypes = [...new Set(weekPoints.map(point => point.serviceType))].sort();
  // Combinação exata tem prioridade sobre quantidade; a meta geral é a alternativa.
  const scenario = definition.scenarios.find(item => item.condition.kind === 'SERVICE_SET'
    && item.condition.serviceTypes.length === activeServiceTypes.length
    && item.condition.serviceTypes.every(type => activeServiceTypes.includes(type)))
    ?? definition.scenarios.find(item => item.condition.kind === 'SERVICE_COUNT' && item.condition.count === activeServiceTypes.length)
    ?? definition.scenarios.find(item => item.condition.kind === 'ALWAYS') ?? null;
  const hasData = metric === 'PCT_POINTS' ? actualPctPoints != null : servicePoints.length > 0;
  const canCompare = week <= currentWeek && hasData;
  const goals = (scenario?.goals ?? []).map(goal => {
    const goalMetric = weeklyTargetGoalMetric(metric, goal, scenario.condition);
    const selected = weekPoints.filter(point => !goal.serviceType || point.serviceType === goal.serviceType);
    const productivePoints = selected.filter(point => typeof point.productivePersonMinutes === 'number' && Number.isFinite(point.productivePersonMinutes));
    const productiveHours = basis === 'PER_PRODUCTIVE_DAY' ? productivePoints.reduce((sum, point) => sum + point.productivePersonMinutes / 60, 0) : null;
    const personDays = productiveHours == null ? null : productiveHours / (definition.referenceDayHours ?? 8);
    const productivityIssues = basis === 'PER_PRODUCTIVE_DAY' ? [...new Set(productivePoints.flatMap(point => point.productivityIssues ?? []))] : [];
    if (basis === 'PER_PRODUCTIVE_DAY' && (!productivePoints.length || selected.some(point => point.productivePersonMinutes == null
      && !productivePoints.some(base => base.date === point.date && base.serviceType === point.serviceType)))) productivityIssues.push('MISSING_RDO_BASE');
    if (basis === 'PER_PRODUCTIVE_DAY' && !(personDays > 0)) productivityIssues.push('NO_PRODUCTIVE_TIME');
    const validBase = basis !== 'PER_PRODUCTIVE_DAY' || (canCompare && !productivityIssues.length);
    const plannedValue = validBase ? round(goal.value * (personDays ?? 1)) : null;
    const actualValue = !canCompare ? null : goalMetric === 'PCT_POINTS' ? actualPctPoints : round(weekPoints
      .filter(point => !goal.serviceType || point.serviceType === goal.serviceType)
      .reduce((sum, point) => sum + Number(point.quantities[goalMetric] ?? 0), 0));
    return { ...goal, metric: goalMetric, plannedValue, personDays, productiveHours, productivityIssues,
      actualRate: validBase && personDays && actualValue != null ? round(actualValue / personDays) : null,
      actualValue, differenceValue: actualValue == null || plannedValue == null ? null : round(actualValue - plannedValue) };
  });
  const baseComplete = goals.every(goal => goal.plannedValue != null);
  const goalMetrics = [...new Set(goals.map(goal => goal.metric))];
  const mixedUnits = goalMetrics.length > 1;
  const plannedValue = scenario && baseComplete && !mixedUnits ? round(goals.reduce((sum, goal) => sum + goal.plannedValue, 0)) : null;
  const actualValue = scenario && canCompare && !mixedUnits ? round(goals.reduce((sum, goal) => sum + goal.actualValue, 0)) : null;
  const differenceValue = actualValue == null || plannedValue == null ? null : round(actualValue - plannedValue);
  // Cada serviço precisa cumprir sua própria meta. Excedente de um não compensa outro.
  const achievementPct = goals.length && canCompare && baseComplete ? Math.max(0, Math.min(...goals.map(goal => goal.plannedValue > 0
    ? goal.actualValue / goal.plannedValue * 100 : goal.actualValue >= 0 ? 100 : 0))) : null;
  const status = week > currentWeek ? 'PLANNED' : !hasData ? 'NO_DATA' : !scenario ? 'NO_RULE' : !baseComplete ? 'NO_DATA'
    : comparisonStatus(goals.map(goal => goal.differenceValue));
  return { metric: goalMetrics.length === 1 ? goalMetrics[0] : metric, mixedUnits, basis, plannedValue, actualValue, differenceValue, achievementPct, goals, activeServiceTypes,
    scenarioName: scenario?.name ?? null, status };
}

// O histórico contém avanço acumulado. A meta compara somente o ganho da semana,
// carregando o último acumulado por semanas sem medições e preservando regressões.
export function buildWeeklyProgressComparison({ targets = [], progressHistory = [], serviceHistory = [], today = corporateToday() } = {}) {
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
  const servicePoints = serviceHistory.map(point => ({ ...point, date: dateOnlyKey(point.date) }))
    .filter(point => point.date && point.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  if (servicePoints.length) {
    for (let week = weekStartKey(servicePoints[0].date); week <= currentWeek; week = addDays(week, 7)) weeks.add(week);
  }
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
    const latest = latestTargets.get(week);
    const target = latest?.isDeleted ? null : latest ?? null;
    const comparison = target ? compareTarget({ target, week, currentWeek, actualPctPoints: week > currentWeek || !points.length ? null : round(accumulated - before), servicePoints }) : null;
    const plannedPctPoints = comparison?.metric === 'PCT_POINTS' ? comparison.plannedValue : null;
    const actualPctPoints = week > currentWeek || !points.length ? null : round(accumulated - before);
    const differencePctPoints = plannedPctPoints != null && actualPctPoints != null ? round(actualPctPoints - plannedPctPoints) : null;
    return { weekStartDate: week, weekEndDate, plannedPctPoints, actualPctPoints, differencePctPoints,
      metric: 'PCT_POINTS', mixedUnits: false, basis: 'WEEK_TOTAL', plannedValue: null, actualValue: actualPctPoints, differenceValue: null, achievementPct: null,
      goals: [], activeServiceTypes: [], scenarioName: null, ...comparison,
      status: comparison?.status ?? 'NO_TARGET', inProgress: week === currentWeek, target };
  }).reverse();
}
