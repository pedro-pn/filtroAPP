import type { WeeklyTargetMetric, WeeklyTargetBasis, WeeklyTargetService, WeeklyTargetCondition, WeeklyTargetScenario } from '../../../../shared/modules/mission-weekly-progress.js';
import { weeklyTargetGoalMetric } from '../../../../shared/modules/mission-weekly-progress.js';

export type GoalDraft = { serviceType: WeeklyTargetService | null; value: string };
export type ScenarioDraft = { name: string; condition: WeeklyTargetCondition; distribution: 'GLOBAL' | 'SERVICE'; goals: GoalDraft[] };
export type TargetDraft = { weekStartDate: string; metric: WeeklyTargetMetric; basis: WeeklyTargetBasis; referenceDayHours: string; scenarios: ScenarioDraft[]; expectedRevision: number };
export const newScenario = (): ScenarioDraft => ({ name: 'Meta geral', condition: { kind: 'ALWAYS' }, distribution: 'GLOBAL', goals: [{ serviceType: null, value: '' }] });
export const scenarioToDraft = (scenario: WeeklyTargetScenario): ScenarioDraft => ({ ...scenario, distribution: scenario.goals[0]?.serviceType == null ? 'GLOBAL' : 'SERVICE', goals: scenario.goals.map(goal => ({ serviceType: goal.serviceType, value: String(goal.value) })) });
export const onlyFilteringGoals = (draft: TargetDraft) => draft.metric !== 'PCT_POINTS' && draft.scenarios.every(scenario => scenario.goals.length > 0
  && scenario.goals.every(goal => weeklyTargetGoalMetric('M', goal, scenario.condition) === 'L'));
