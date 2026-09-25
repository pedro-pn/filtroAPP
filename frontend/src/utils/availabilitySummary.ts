type AvailabilityDay = { date: string; shortage: number };
type AvailabilityRole = { daily: Array<{ date: string; allocated: number }> };

export function summarizeAvailabilityPeriod(days: AvailabilityDay[], roles: AvailabilityRole[]) {
  const allocatedByDate = new Map(days.map(day => [day.date, 0]));
  for (const role of roles) {
    for (const day of role.daily) {
      if (!allocatedByDate.has(day.date)) continue;
      allocatedByDate.set(day.date, (allocatedByDate.get(day.date) || 0) + day.allocated);
    }
  }

  return {
    peakAllocated: Math.max(0, ...allocatedByDate.values()),
    daysWithShortage: days.filter(day => day.shortage > 0).length,
    peakShortage: Math.max(0, ...days.map(day => day.shortage))
  };
}
