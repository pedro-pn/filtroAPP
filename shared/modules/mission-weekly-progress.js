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

export function weeklyTargetCountingDays(definition) {
  const start = definition?.countingStartDay ?? 1;
  const end = definition?.countingEndDay ?? 0;
  return Array.from({ length: (end - start + 7) % 7 + 1 }, (_, index) => (start + index) % 7);
}

// A segunda-feira continua identificando a revisão da meta. O intervalo de
// contagem pode terminar na semana seguinte (por exemplo, quarta a terça).
export function weeklyTargetCountingPeriod(week, definition) {
  const startDay = definition?.countingStartDay ?? 1;
  const periodStartDate = addDays(week, (startDay + 6) % 7);
  return { periodStartDate, periodEndDate: addDays(periodStartDate, weeklyTargetCountingDays(definition).length - 1) };
}

export function currentWeeklyProgressComparison(rows, today = corporateToday()) {
  const ordered = [...rows].sort((a, b) => b.periodStartDate.localeCompare(a.periodStartDate));
  const containing = ordered.filter(row => row.periodStartDate <= today && row.periodEndDate >= today);
  return containing.find(row => row.target) ?? containing[0]
    ?? ordered.find(row => row.weekStartDate === weekStartKey(today))
    ?? ordered.find(row => row.periodStartDate <= today) ?? ordered.at(-1);
}

const round = value => Math.round((value + Number.EPSILON) * 100) / 100;

export const WEEKLY_TARGET_METRICS = { PCT_POINTS: 'Avanço percentual (p.p.)', M: 'Metragem (m)', L: 'Volume filtrado / óleo (L)', UN: 'Unidades de sistema (un)', COLLABORATORS: 'Colaboradores presentes por dia' };
export const WEEKLY_TARGET_WORKDAYS = { 1: 'Segunda', 2: 'Terça', 3: 'Quarta', 4: 'Quinta', 5: 'Sexta', 6: 'Sábado', 0: 'Domingo' };
export const WEEKLY_TARGET_SERVICES = { LIMPEZA_QUIMICA: 'Limpeza química', TESTE_PRESSAO: 'Teste de pressão', FLUSHING: 'Flushing', FILTRAGEM: 'Filtragem' };
export const weeklyTargetUnit = metric => ({ PCT_POINTS: 'p.p.', M: 'm', L: 'L', UN: 'un', COLLABORATORS: 'colab./dia' }[metric]);

export function weeklyTargetGoalMetric(metric, goal, condition) {
  const serviceType = goal.serviceType ?? (condition?.kind === 'SERVICE_SET' && condition.serviceTypes.length === 1 ? condition.serviceTypes[0] : null);
  return metric !== 'PCT_POINTS' && metric !== 'COLLABORATORS' && serviceType === 'FILTRAGEM' ? 'L' : metric;
}

export function weeklyTargetDefinition(target) {
  return target?.definition ?? {
    metric: 'PCT_POINTS', basis: 'WEEK_TOTAL', scenarios: [{ name: 'Meta geral', condition: { kind: 'ALWAYS' }, goals: [{ serviceType: null, value: Number(target?.plannedPctPoints ?? 0) }] }]
  };
}

// Settings on the scenario take precedence; older definitions keep their shared settings.
export function weeklyTargetScenarioSettings(definition, scenario) {
  return {
    metric: scenario?.metric ?? definition.metric,
    basis: scenario?.basis ?? definition.basis ?? 'WEEK_TOTAL',
    referenceDayHours: scenario?.referenceDayHours ?? definition.referenceDayHours,
    workdays: scenario?.workdays ?? definition.workdays
  };
}

function resolveTargetForWeek(entries, week) {
  const previous = entries.filter(([date]) => date <= week).sort(([a], [b]) => b.localeCompare(a))[0];
  if (!previous) return null;
  const [date, target] = previous;
  if (target.isDeleted || (date !== week && !target.definition?.repeatWeekly)) return null;
  return date === week ? target : { ...target, weekStartDate: week, revision: 0, repeatedFromWeekStartDate: date };
}

export function effectiveWeeklyProgressTarget(targets, week) {
  const latest = new Map();
  for (const target of targets) {
    const date = weekStartKey(target.weekStartDate);
    if (date && (!latest.has(date) || target.revision > latest.get(date).revision)) latest.set(date, target);
  }
  return resolveTargetForWeek([...latest], week);
}

function selectScenario(definition, activeServiceTypes) {
  // Exact combination takes priority over service count, followed by the general rule.
  return definition.scenarios.find(item => item.condition.kind === 'SERVICE_SET'
    && item.condition.serviceTypes.length === activeServiceTypes.length
    && item.condition.serviceTypes.every(type => activeServiceTypes.includes(type)))
    ?? definition.scenarios.find(item => item.condition.kind === 'SERVICE_COUNT' && item.condition.count === activeServiceTypes.length)
    ?? definition.scenarios.find(item => item.condition.kind === 'ALWAYS') ?? null;
}

function comparisonStatus(differences) {
  return differences.some(value => value < 0) ? 'BELOW' : differences.some(value => value > 0) ? 'ABOVE' : 'ON_TARGET';
}

// Presença é verificada em cada dia contratado. O menor efetivo diário resume
// a semana sem permitir que excedentes de outros dias compensem uma falta.
function compareAttendanceTarget({ definition, scenario, periodStartDate, periodEndDate, today, attendancePoints, previousAttendance, activeServiceTypes }) {
  const settings = weeklyTargetScenarioSettings(definition, scenario), goal = scenario.goals[0];
  let cumulativeDifferenceValue = previousAttendance.differenceValue ?? 0;
  let cumulativeComplete = previousAttendance.differenceValue != null;
  const dailyAttendance = Array.from({ length: 7 }, (_, index) => addDays(periodStartDate, index))
    .filter(date => date <= periodEndDate)
    .filter(date => (settings.workdays ?? [1, 2, 3, 4, 5]).includes(new Date(`${date}T00:00:00Z`).getUTCDay()))
    .map(date => {
      const points = attendancePoints.filter(point => point.date === date);
      const attendanceIssues = [...new Set(points.flatMap(point => point.attendanceIssues ?? []))];
      const actualValue = date > today || !points.length || attendanceIssues.length ? null
        : new Set(points.flatMap(point => point.collaboratorIds)).size;
      const differenceValue = actualValue == null ? null : actualValue - goal.value;
      if (date <= today) {
        if (differenceValue == null) cumulativeComplete = false;
        else cumulativeDifferenceValue += differenceValue;
      }
      return { date, plannedValue: goal.value, actualValue, differenceValue, attendanceIssues,
        cumulativeDifferenceValue: date > today || !cumulativeComplete ? null : cumulativeDifferenceValue,
        status: date > today ? 'PLANNED' : actualValue == null ? 'NO_DATA' : differenceValue < 0 ? 'BELOW' : 'ON_TARGET' };
    });
  const elapsed = dailyAttendance.filter(day => day.date <= today);
  const complete = elapsed.length > 0 && elapsed.every(day => day.actualValue != null);
  const actualValue = complete ? Math.min(...elapsed.map(day => day.actualValue)) : null;
  const differenceValue = actualValue == null ? null : actualValue - goal.value;
  const status = !elapsed.length ? 'PLANNED' : elapsed.some(day => day.status === 'BELOW') ? 'BELOW' : !complete ? 'NO_DATA' : 'ON_TARGET';
  const cumulativePlannedValue = previousAttendance.plannedValue + elapsed.length * goal.value;
  const cumulativeActualValue = previousAttendance.actualValue != null && elapsed.every(day => day.actualValue != null)
    ? previousAttendance.actualValue + elapsed.reduce((sum, day) => sum + day.actualValue, 0) : null;
  return { metric: 'COLLABORATORS', mixedUnits: false, basis: 'PER_WORKDAY', plannedValue: goal.value, actualValue, differenceValue,
    cumulativeAttendance: { plannedValue: cumulativePlannedValue, actualValue: cumulativeActualValue,
      differenceValue: cumulativeActualValue == null ? null : cumulativeActualValue - cumulativePlannedValue },
    achievementPct: actualValue == null ? null : actualValue / goal.value * 100,
    goals: [{ ...goal, metric: 'COLLABORATORS', plannedValue: goal.value, actualValue, differenceValue,
      personDays: null, productiveHours: null, productivityIssues: [], actualRate: null }],
    dailyAttendance, activeServiceTypes, scenarioName: scenario.name, status };
}

// Colaboradores-dia enviados pelo backend: a equipe do RDO em cada dia. Num mesmo dia
// com vários serviços a equipe é a mesma, então conta uma vez (maior valor do dia).
// Sem esse dado (histórico antigo), vale a conversão por horas ÷ jornada da meta.
function productivePersonDays(points) {
  if (!points.length || !points.every(point => typeof point.productivePersonDays === 'number' && Number.isFinite(point.productivePersonDays))) return null;
  const byDate = new Map();
  for (const point of points) byDate.set(point.date, Math.max(byDate.get(point.date) ?? 0, point.productivePersonDays));
  return Math.round([...byDate.values()].reduce((sum, value) => sum + value, 0) * 10000) / 10000;
}
const isProductiveBase = point => (typeof point.productivePersonDays === 'number' && Number.isFinite(point.productivePersonDays))
  || (typeof point.productivePersonMinutes === 'number' && Number.isFinite(point.productivePersonMinutes));

export const isWeeklyTargetGoalList = definition => definition?.version === 2 && Array.isArray(definition.goals);
export const weeklyTargetGoalKind = goal => goal.kind ?? (goal.metric === 'COLLABORATORS' ? 'ATTENDANCE' : goal.metric === 'PCT_POINTS' ? 'PROGRESS' : 'SERVICE');

const emptyGoalBase = { personDays: null, productiveHours: null, productivityIssues: [], actualRate: null };

// Metas em lista: cada linha é avaliada sozinha e a regra E/OU decide a semana.
// Um serviço que não apareceu nos RDOs conta 0 (não cumprido); sem nenhum RDO
// no período, a semana fica sem avaliação.
function compareGoalList({ definition, activeServiceTypes, periodStartDate, periodEndDate, today, actualPctPoints, servicePoints, attendancePoints, previousAttendance }) {
  const started = periodStartDate <= today;
  const weekPoints = servicePoints.filter(point => point.date >= periodStartDate && point.date <= periodEndDate);
  const hasRdo = weekPoints.length > 0 || attendancePoints.some(point => point.date >= periodStartDate && point.date <= periodEndDate);
  let attendance = null;
  const goals = definition.goals.map(goal => {
    const kind = weeklyTargetGoalKind(goal);
    if (kind === 'PROGRESS') {
      const actualValue = started ? actualPctPoints : null;
      return { ...emptyGoalBase, kind, serviceType: null, value: goal.value, metric: 'PCT_POINTS', basis: 'WEEK_TOTAL', plannedValue: goal.value,
        actualValue, differenceValue: actualValue == null ? null : round(actualValue - goal.value),
        outcome: !started ? 'PLANNED' : actualValue == null ? 'NO_DATA' : actualValue >= goal.value ? 'MET' : 'BELOW' };
    }
    if (kind === 'ATTENDANCE') {
      const scenario = { name: 'Equipe mínima', metric: 'COLLABORATORS', basis: 'PER_WORKDAY', workdays: goal.workdays, condition: { kind: 'ALWAYS' }, goals: [{ serviceType: null, value: goal.value }] };
      attendance = compareAttendanceTarget({ definition: { scenarios: [scenario] }, scenario, activeServiceTypes, periodStartDate, periodEndDate, today, attendancePoints, previousAttendance });
      return { ...attendance.goals[0], kind, workdays: goal.workdays, basis: 'PER_WORKDAY',
        outcome: { ON_TARGET: 'MET', BELOW: 'BELOW', NO_DATA: 'NO_DATA', PLANNED: 'PLANNED' }[attendance.status] };
    }
    const metric = goal.serviceType === 'FILTRAGEM' ? 'L' : goal.metric;
    // Sem tipo de serviço, a linha vale para qualquer serviço e soma todos eles.
    const selected = weekPoints.filter(point => !goal.serviceType || point.serviceType === goal.serviceType);
    const actualValue = started ? round(selected.reduce((sum, point) => sum + Number(point.quantities?.[metric] ?? 0), 0)) : null;
    const base = { ...emptyGoalBase, kind, serviceType: goal.serviceType, value: goal.value, metric, basis: goal.basis, actualValue, executed: selected.length > 0 };
    const result = (plannedValue, outcome, extra = {}) => ({ ...base, ...extra, plannedValue, outcome,
      differenceValue: plannedValue == null || actualValue == null ? null : round(actualValue - plannedValue) });
    if (!started) return result(goal.basis === 'WEEK_TOTAL' ? goal.value : null, 'PLANNED');
    if (!hasRdo) return result(goal.basis === 'WEEK_TOTAL' ? goal.value : null, 'NO_DATA');
    if (goal.basis !== 'PER_PRODUCTIVE_DAY') return result(goal.value, actualValue >= goal.value ? 'MET' : 'BELOW');
    if (!selected.length) return result(null, 'BELOW', { personDays: 0 });
    const productivePoints = selected.filter(isProductiveBase);
    const productiveHours = productivePoints.reduce((sum, point) => sum + (point.productivePersonMinutes ?? 0) / 60, 0);
    const personDays = productivePersonDays(productivePoints) ?? productiveHours / 8;
    const productivityIssues = [...new Set(productivePoints.flatMap(point => point.productivityIssues ?? []))];
    if (!productivePoints.length || selected.some(point => !isProductiveBase(point)
      && !productivePoints.some(other => other.date === point.date))) productivityIssues.push('MISSING_RDO_BASE');
    if (!(personDays > 0)) productivityIssues.push('NO_PRODUCTIVE_TIME');
    const extra = { personDays, productiveHours, productivityIssues,
      actualRate: personDays > 0 && !productivityIssues.length ? round(actualValue / personDays) : null };
    if (productivityIssues.length) return result(null, 'NO_DATA', extra);
    const plannedValue = round(goal.value * personDays);
    return result(plannedValue, actualValue >= plannedValue ? 'MET' : 'BELOW', extra);
  });
  const logic = definition.logic === 'ANY' ? 'ANY' : 'ALL';
  const count = outcome => goals.filter(goal => goal.outcome === outcome).length;
  const met = count('MET'), below = count('BELOW'), noData = count('NO_DATA');
  const reached = () => goals.some(goal => goal.outcome === 'MET' && goal.differenceValue > 0) ? 'ABOVE' : 'ON_TARGET';
  const status = !started ? 'PLANNED'
    : logic === 'ANY' ? met ? reached() : noData ? 'NO_DATA' : 'BELOW'
      : met === goals.length ? reached() : noData && !below ? 'NO_DATA' : met ? 'PARTIAL' : 'BELOW';
  const goalPct = goal => goal.plannedValue > 0 ? goal.actualValue / goal.plannedValue * 100
    : goal.plannedValue === 0 ? 100 : goal.outcome === 'BELOW' ? 0 : null;
  const percents = goals.map(goal => goal.actualValue == null ? null : goalPct(goal)).filter(value => value != null);
  const achievementPct = !started || !percents.length ? null : Math.max(0, logic === 'ANY' ? Math.max(...percents) : Math.min(...percents));
  const single = goals.length === 1 ? goals[0] : null;
  return { metric: single?.metric ?? goals[0].metric, mixedUnits: !single, basis: single?.basis ?? 'WEEK_TOTAL', logic,
    plannedValue: single?.plannedValue ?? null, actualValue: single?.actualValue ?? null, differenceValue: single?.differenceValue ?? null,
    achievementPct, goals, activeServiceTypes, scenarioName: null, status,
    dailyAttendance: attendance?.dailyAttendance ?? [], cumulativeAttendance: attendance?.cumulativeAttendance ?? null };
}

function compareTarget({ definition, scenario, activeServiceTypes, periodStartDate, periodEndDate, today, actualPctPoints, servicePoints }) {
  const { metric, basis, referenceDayHours } = weeklyTargetScenarioSettings(definition, scenario);
  const weekPoints = servicePoints.filter(point => point.date >= periodStartDate && point.date <= periodEndDate);
  const hasData = metric === 'PCT_POINTS' ? actualPctPoints != null : servicePoints.length > 0;
  const canCompare = periodStartDate <= today && hasData;
  const goals = (scenario?.goals ?? []).map(goal => {
    const goalMetric = weeklyTargetGoalMetric(metric, goal, scenario.condition);
    const selected = weekPoints.filter(point => !goal.serviceType || point.serviceType === goal.serviceType);
    const productivePoints = selected.filter(isProductiveBase);
    const productiveHours = basis === 'PER_PRODUCTIVE_DAY' ? productivePoints.reduce((sum, point) => sum + (point.productivePersonMinutes ?? 0) / 60, 0) : null;
    const personDays = productiveHours == null ? null : productivePersonDays(productivePoints) ?? productiveHours / (referenceDayHours ?? 8);
    const productivityIssues = basis === 'PER_PRODUCTIVE_DAY' ? [...new Set(productivePoints.flatMap(point => point.productivityIssues ?? []))] : [];
    if (basis === 'PER_PRODUCTIVE_DAY' && (!productivePoints.length || selected.some(point => !isProductiveBase(point)
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
  const status = periodStartDate > today ? 'PLANNED' : !hasData ? 'NO_DATA' : !scenario ? 'NO_RULE' : !baseComplete ? 'NO_DATA'
    : comparisonStatus(goals.map(goal => goal.differenceValue));
  return { metric: goalMetrics.length === 1 ? goalMetrics[0] : metric, mixedUnits, basis, plannedValue, actualValue, differenceValue, achievementPct, goals, activeServiceTypes,
    scenarioName: scenario?.name ?? null, status };
}

// O histórico contém avanço acumulado. A meta compara somente o ganho da semana,
// carregando o último acumulado por semanas sem medições e preservando regressões.
export function buildWeeklyProgressComparison({ targets = [], progressHistory = [], serviceHistory = [], attendanceHistory = [], today = corporateToday() } = {}) {
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
  const targetEntries = [...latestTargets];
  const firstRepeatingWeek = targetEntries.filter(([, target]) => !target.isDeleted && target.definition?.repeatWeekly).map(([week]) => week).sort()[0];
  if (firstRepeatingWeek) {
    for (let week = firstRepeatingWeek; week <= currentWeek; week = addDays(week, 7)) weeks.add(week);
    const nextWeek = addDays(currentWeek, 7);
    if (resolveTargetForWeek(targetEntries, nextWeek)?.definition?.repeatWeekly) weeks.add(nextWeek);
  }
  const servicePoints = serviceHistory.map(point => ({ ...point, date: dateOnlyKey(point.date) }))
    .filter(point => point.date && point.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  const attendancePoints = attendanceHistory.map(point => ({ ...point, date: dateOnlyKey(point.date) }))
    .filter(point => point.date && point.date <= today);
  if (servicePoints.length) {
    for (let week = weekStartKey(servicePoints[0].date); week <= currentWeek; week = addDays(week, 7)) weeks.add(week);
  }
  if (points.length) {
    for (let week = weekStartKey(points[0].date); week <= currentWeek; week = addDays(week, 7)) weeks.add(week);
  }
  const periods = [...weeks].sort().map(week => {
    const target = resolveTargetForWeek(targetEntries, week);
    const definition = target ? weeklyTargetDefinition(target) : null;
    return { week, target, definition, ...weeklyTargetCountingPeriod(week, definition) };
  });
  // Uma mudança de intervalo passa a valer no início do novo período, sem
  // contabilizar os mesmos dias em duas metas consecutivas.
  for (let index = 0; index < periods.length - 1; index++) {
    const period = periods[index], next = periods[index + 1];
    if (period.target && next.target && period.periodEndDate >= next.periodStartDate) {
      period.periodEndDate = addDays(next.periodStartDate, -1);
    }
  }
  const progressAt = date => Number(points.findLast(point => point.date <= date)?.progressPct ?? 0);
  let accumulatedAttendance = { plannedValue: 0, actualValue: 0, differenceValue: 0 };
  return periods.map(({ week, target, definition, periodStartDate, periodEndDate }) => {
    const weekEndDate = addDays(week, 6);
    const actualPctPoints = periodStartDate > today || !points.length ? null
      : round(progressAt(periodEndDate) - progressAt(addDays(periodStartDate, -1)));
    const activeServiceTypes = [...new Set(servicePoints.filter(point => point.date >= periodStartDate && point.date <= periodEndDate).map(point => point.serviceType))].sort();
    const goalList = isWeeklyTargetGoalList(definition);
    const scenario = definition && !goalList ? selectScenario(definition, activeServiceTypes) : null;
    const comparison = !target ? null : goalList
      ? compareGoalList({ definition, activeServiceTypes, periodStartDate, periodEndDate, today, actualPctPoints, servicePoints, attendancePoints, previousAttendance: accumulatedAttendance })
      : scenario && weeklyTargetScenarioSettings(definition, scenario).metric === 'COLLABORATORS'
      ? compareAttendanceTarget({ definition, scenario, activeServiceTypes, periodStartDate, periodEndDate, today, attendancePoints, previousAttendance: accumulatedAttendance })
      : compareTarget({ definition, scenario, activeServiceTypes, periodStartDate, periodEndDate, today, actualPctPoints, servicePoints });
    if (comparison?.cumulativeAttendance) accumulatedAttendance = comparison.cumulativeAttendance;
    const plannedPctPoints = comparison?.metric === 'PCT_POINTS' ? comparison.plannedValue : null;
    const differencePctPoints = plannedPctPoints != null && actualPctPoints != null ? round(actualPctPoints - plannedPctPoints) : null;
    return { weekStartDate: week, weekEndDate, periodStartDate, periodEndDate, plannedPctPoints, actualPctPoints, differencePctPoints,
      metric: 'PCT_POINTS', mixedUnits: false, basis: 'WEEK_TOTAL', plannedValue: null, actualValue: actualPctPoints, differenceValue: null, achievementPct: null,
      goals: [], dailyAttendance: [], cumulativeAttendance: null, activeServiceTypes: [], scenarioName: null, logic: 'ALL', ...comparison,
      status: comparison?.status ?? 'NO_TARGET', inProgress: periodStartDate <= today && today <= periodEndDate, target };
  }).reverse();
}
