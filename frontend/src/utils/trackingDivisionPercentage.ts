export type TrackingDivisionPlannedField = 'plannedCost' | 'plannedRevenue' | 'plannedHours' | 'plannedDays';

export function percentageOfProjectTotal(total: number | null, percentage: string, field: TrackingDivisionPlannedField): number | null {
  if (percentage.trim() === '' || total == null || !Number.isFinite(total) || total <= 0) return null;
  const rate = Number(percentage);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) return null;
  const value = total * rate / 100;
  const decimals = field === 'plannedDays' ? 0 : 2;
  return Number(value.toFixed(decimals));
}

export function percentageForProjectValue(value: string, total: number): string {
  if (value.trim() === '') return '';
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(Number((numeric / total * 100).toFixed(10))) : '';
}
