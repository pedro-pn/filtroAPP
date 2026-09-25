export type CalendarScale = 'day' | 'week' | 'month';

export interface CalendarBucket {
  key: string;
  dates: string[];
  start: string;
  end: string;
}

export function buildCalendarBuckets(dates: string[], viewportWidth: number): { scale: CalendarScale; buckets: CalendarBucket[] } {
  const narrow = viewportWidth < 640;
  const dayLimit = narrow ? 7 : viewportWidth < 1100 ? 21 : 31;
  const weekLimit = narrow ? 56 : 112;
  const scale: CalendarScale = dates.length <= dayLimit ? 'day' : dates.length <= weekLimit ? 'week' : 'month';
  const buckets: CalendarBucket[] = [];

  for (const date of dates) {
    const key = scale === 'day' ? date : scale === 'month' ? date.slice(0, 7) : weekStart(date);
    const last = buckets[buckets.length - 1];
    if (last?.key === key) {
      last.dates.push(date);
      last.end = date;
    } else {
      buckets.push({ key, dates: [date], start: date, end: date });
    }
  }

  return { scale, buckets };
}

function weekStart(date: string): string {
  const monday = new Date(`${date}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  return monday.toISOString().slice(0, 10);
}
