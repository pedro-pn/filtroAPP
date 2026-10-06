export type WeeklyTargetMetric = 'PCT_POINTS' | 'M' | 'L' | 'UN' | 'COLLABORATORS';
export type WeeklyTargetService = 'LIMPEZA_QUIMICA' | 'TESTE_PRESSAO' | 'FLUSHING' | 'FILTRAGEM';
export type WeeklyTargetCondition = { kind: 'ALWAYS' } | { kind: 'SERVICE_COUNT'; count: number }
  | { kind: 'SERVICE_SET'; serviceTypes: WeeklyTargetService[] };
export type WeeklyTargetBasis = 'WEEK_TOTAL' | 'PER_PRODUCTIVE_DAY' | 'PER_WORKDAY';
export interface WeeklyTargetGoal { serviceType: WeeklyTargetService | null; value: number }
export interface WeeklyTargetScenario { name: string; condition: WeeklyTargetCondition; goals: WeeklyTargetGoal[] }
export interface WeeklyTargetDefinition { metric: WeeklyTargetMetric; basis?: WeeklyTargetBasis; referenceDayHours?: number; workdays?: number[]; scenarios: WeeklyTargetScenario[] }
export interface WeeklyAttendanceHistoryPoint { date: string; collaboratorIds: string[]; attendanceIssues?: string[] }
export interface DailyAttendanceComparison {
  date: string;
  plannedValue: number;
  actualValue: number | null;
  differenceValue: number | null;
  cumulativeDifferenceValue: number | null;
  attendanceIssues: string[];
  status: 'PLANNED' | 'NO_DATA' | 'BELOW' | 'ON_TARGET';
}
export interface WeeklyServiceHistoryPoint {
  date: string;
  serviceType: WeeklyTargetService;
  quantities: { M: number; L: number; UN: number };
  productivePersonMinutes?: number;
  productivityIssues?: string[];
}
export type WeeklyTargetInput = { weekStartDate: string; expectedRevision: number }
  & ({ plannedPctPoints: number; definition?: never } | { definition: WeeklyTargetDefinition; plannedPctPoints?: never });
export interface WeeklyTargetDeleteInput { weekStartDate: string; expectedRevision: number }
export interface WeeklyProgressTarget {
  id: string;
  weekStartDate: string;
  plannedPctPoints: number | null;
  definition?: WeeklyTargetDefinition;
  isDeleted?: boolean;
  revision: number;
  author: { id: string | null; name: string };
  createdAt: string;
}
export interface WeeklyProgressComparison {
  weekStartDate: string;
  weekEndDate: string;
  plannedPctPoints: number | null;
  actualPctPoints: number | null;
  differencePctPoints: number | null;
  metric: WeeklyTargetMetric;
  mixedUnits: boolean;
  plannedValue: number | null;
  actualValue: number | null;
  differenceValue: number | null;
  achievementPct: number | null;
  basis: WeeklyTargetBasis;
  goals: Array<WeeklyTargetGoal & { metric: WeeklyTargetMetric; plannedValue: number | null; personDays: number | null; productiveHours: number | null; productivityIssues: string[]; actualRate: number | null; actualValue: number | null; differenceValue: number | null }>;
  dailyAttendance: DailyAttendanceComparison[];
  cumulativeAttendance: { plannedValue: number; actualValue: number | null; differenceValue: number | null } | null;
  activeServiceTypes: WeeklyTargetService[];
  scenarioName: string | null;
  status: 'NO_TARGET' | 'PLANNED' | 'NO_DATA' | 'NO_RULE' | 'ABOVE' | 'BELOW' | 'ON_TARGET';
  inProgress: boolean;
  target: WeeklyProgressTarget | null;
}
export const WEEKLY_TARGET_METRICS: Record<WeeklyTargetMetric, string>;
export const WEEKLY_TARGET_WORKDAYS: Record<number, string>;
export const WEEKLY_TARGET_SERVICES: Record<WeeklyTargetService, string>;
export function weeklyTargetUnit(metric: WeeklyTargetMetric): string;
export function weeklyTargetGoalMetric(metric: WeeklyTargetMetric, goal: Pick<WeeklyTargetGoal, 'serviceType'>, condition?: WeeklyTargetCondition): WeeklyTargetMetric;
export function weeklyTargetDefinition(target?: WeeklyProgressTarget | null): WeeklyTargetDefinition;
export function dateOnlyKey(value: unknown): string | null;
export function weekStartKey(value: unknown): string | null;
export function corporateToday(value?: Date): string;
export function buildWeeklyProgressComparison(input?: {
  targets?: WeeklyProgressTarget[];
  progressHistory?: Array<{ date: string; progressPct: number }>;
  serviceHistory?: WeeklyServiceHistoryPoint[];
  attendanceHistory?: WeeklyAttendanceHistoryPoint[];
  today?: string;
}): WeeklyProgressComparison[];
