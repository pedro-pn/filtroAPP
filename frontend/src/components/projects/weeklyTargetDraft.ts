import type { WeeklyTargetMetric, WeeklyTargetBasis, WeeklyTargetService, WeeklyTargetCondition, WeeklyTargetScenario, WeeklyTargetDefinition, WeeklyTargetInput } from '../../../../shared/modules/mission-weekly-progress.js';
import { weeklyTargetGoalMetric, weeklyTargetScenarioSettings, weeklyTargetCountingDays } from '../../../../shared/modules/mission-weekly-progress.js';

export type GoalDraft = { serviceType: WeeklyTargetService | null; value: string };
export type ScenarioDraft = { name: string; metric: WeeklyTargetMetric; basis: WeeklyTargetBasis; referenceDayHours: string; workdays: number[]; condition: WeeklyTargetCondition; distribution: 'GLOBAL' | 'SERVICE'; goals: GoalDraft[] };
export type TargetDraft = { weekStartDate: string; countingStartDay: number; countingEndDay: number; repeatWeekly: boolean; scenarios: ScenarioDraft[]; expectedRevision: number };
export const newScenario = (referenceDayHours = ''): ScenarioDraft => ({ name: 'Meta geral', metric: 'PCT_POINTS', basis: 'WEEK_TOTAL', referenceDayHours, workdays: [1, 2, 3, 4, 5], condition: { kind: 'ALWAYS' }, distribution: 'GLOBAL', goals: [{ serviceType: null, value: '' }] });
export const scenarioToDraft = (scenario: WeeklyTargetScenario, definition: WeeklyTargetDefinition, defaultReferenceDayHours?: number | null): ScenarioDraft => {
  const settings = weeklyTargetScenarioSettings(definition, scenario);
  return { ...scenario, metric: settings.metric, basis: settings.basis, referenceDayHours: String(settings.referenceDayHours ?? defaultReferenceDayHours ?? ''), workdays: settings.workdays ?? [1, 2, 3, 4, 5],
    distribution: scenario.goals[0]?.serviceType == null ? 'GLOBAL' : 'SERVICE', goals: scenario.goals.map(goal => ({ serviceType: goal.serviceType, value: String(goal.value) })) };
};
export const onlyFilteringGoals = (scenario: ScenarioDraft) => scenario.metric !== 'PCT_POINTS' && scenario.metric !== 'COLLABORATORS' && scenario.goals.length > 0
  && scenario.goals.every(goal => weeklyTargetGoalMetric('M', goal, scenario.condition) === 'L');

export function weeklyTargetDraftToInput(draft: TargetDraft): WeeklyTargetInput {
  const countingStartDay = draft.countingStartDay ?? 1, countingEndDay = draft.countingEndDay ?? 0;
  if (![countingStartDay, countingEndDay].every(day => Number.isInteger(day) && day >= 0 && day <= 6)) {
    throw new Error('Escolha os dias de início e fim da contagem.');
  }
  const conditions = new Set<string>();
  const scenarios = draft.scenarios.map(scenario => {
    const metric = onlyFilteringGoals(scenario) ? 'L' : scenario.metric;
    const goals = scenario.goals.map(goal => ({ serviceType: goal.serviceType, value: Number(goal.value.replace(',', '.')) }));
    const referenceDayHours = Number(scenario.referenceDayHours.replace(',', '.'));
    const conditionKey = scenario.condition.kind === 'SERVICE_SET' ? `SET:${[...scenario.condition.serviceTypes].sort().join(',')}`
      : scenario.condition.kind === 'SERVICE_COUNT' ? `COUNT:${scenario.condition.count}` : 'ALWAYS';
    if (conditions.has(conditionKey)) throw new Error('Escolha uma condição diferente para cada cenário.');
    conditions.add(conditionKey);
    if (metric === 'COLLABORATORS' && (!scenario.workdays.length || goals.some(goal => !Number.isInteger(goal.value) || goal.value < 1))) {
      throw new Error('Informe uma quantidade inteira positiva de colaboradores e selecione ao menos um dia de trabalho.');
    }
    if (metric === 'COLLABORATORS' && !scenario.workdays.some(day => weeklyTargetCountingDays({ countingStartDay, countingEndDay }).includes(day))) {
      throw new Error('Selecione ao menos um dia de presença dentro do período de contagem.');
    }
    if (!scenario.name.trim() || !scenario.goals.length || scenario.goals.some(goal => !goal.value.trim())
      || (scenario.condition.kind === 'SERVICE_SET' && !scenario.condition.serviceTypes.length)
      || goals.some(goal => !Number.isFinite(goal.value) || goal.value < 0 || goal.value > (metric === 'PCT_POINTS' ? 100 : 999999999.99)
        || Math.abs(goal.value * 100 - Math.round(goal.value * 100)) > 1e-5
        || (weeklyTargetGoalMetric(metric, goal, scenario.condition) === 'UN' && scenario.basis === 'WEEK_TOTAL' && !Number.isInteger(goal.value)))
      || (scenario.basis === 'PER_PRODUCTIVE_DAY' && (!scenario.referenceDayHours.trim() || !Number.isFinite(referenceDayHours)
        || referenceDayHours <= 0 || referenceDayHours > 24 || Math.abs(referenceDayHours * 100 - Math.round(referenceDayHours * 100)) > 1e-5))) {
      throw new Error('Preencha as condições e os valores de cada cenário. Use até duas casas decimais e uma jornada de referência entre 0,01 e 24 horas.');
    }
    return { name: scenario.name, metric, basis: scenario.basis, condition: scenario.condition, goals,
      ...(metric === 'COLLABORATORS' ? { workdays: scenario.workdays } : {}),
      ...(scenario.basis === 'PER_PRODUCTIVE_DAY' ? { referenceDayHours } : {}) };
  });
  if (!draft.weekStartDate || !scenarios.length) throw new Error('Informe a semana e ao menos um cenário.');
  return { weekStartDate: draft.weekStartDate, expectedRevision: draft.expectedRevision,
    definition: { metric: scenarios[0].metric, basis: 'WEEK_TOTAL', countingStartDay, countingEndDay, repeatWeekly: draft.repeatWeekly, scenarios } };
}
