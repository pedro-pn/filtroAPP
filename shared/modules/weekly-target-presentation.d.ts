import type { WeeklyProgressComparison, WeeklyTargetGoalItem, WeeklyTargetMetric } from './mission-weekly-progress.js';

export function weeklyValueLabel(value: number | null, metric: WeeklyTargetMetric, signed?: boolean): string;
export function attendanceBalanceLabel(value: number | null): string;
export const WEEKLY_STATUS_LABEL: Record<WeeklyProgressComparison['status'], string>;
export function weeklyGoalLabel(goal: { kind?: WeeklyTargetGoalItem['kind']; serviceType?: string | null; metric?: WeeklyTargetMetric }): string;
export function workdaysLabel(workdays: number[]): string;
export function weeklyGoalSentence(goal: { kind: WeeklyTargetGoalItem['kind']; value: number | null; serviceType?: string | null; metric?: string; basis?: string; workdays?: number[] }): string;
export function weeklyScenarioGoalDescription(goal: { serviceType?: string | null; value: number | null; metric: WeeklyTargetMetric; basis?: string }): string;
