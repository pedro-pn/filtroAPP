import { dateKeyToUtc, eachDateInclusive, parseDateKey } from './date-only.js';

export function isWeekend(value) {
  const day = dateKeyToUtc(value).getUTCDay();
  return day === 0 || day === 6;
}

export function holidayDateSet(holidays = []) {
  return new Set(holidays.filter(item => !item.deletedAt).map(item => parseDateKey(item.holidayDate ?? item)));
}

export function isBusinessDay(value, holidays = new Set()) {
  const key = parseDateKey(value);
  return !isWeekend(key) && !holidays.has(key);
}

export function businessDatesInclusive(startDate, endDate, holidays = new Set()) {
  return eachDateInclusive(startDate, endDate).filter(date => isBusinessDay(date, holidays));
}
