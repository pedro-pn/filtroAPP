export interface WeeklyProgressTarget {
  id: string;
  weekStartDate: string;
  plannedPctPoints: number;
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
  status: 'NO_TARGET' | 'PLANNED' | 'NO_DATA' | 'ABOVE' | 'BELOW' | 'ON_TARGET';
  inProgress: boolean;
  target: WeeklyProgressTarget | null;
}
export function dateOnlyKey(value: unknown): string | null;
export function weekStartKey(value: unknown): string | null;
export function corporateToday(value?: Date): string;
export function buildWeeklyProgressComparison(input?: {
  targets?: WeeklyProgressTarget[];
  progressHistory?: Array<{ date: string; progressPct: number }>;
  today?: string;
}): WeeklyProgressComparison[];
