// The same year range is used by the application's date inputs. A partially
// typed year such as 0027 is a real JavaScript date, but not a report date.
export const MIN_REPORT_YEAR = 1900;
export const MAX_REPORT_YEAR = 2100;
export const REPORT_DATE_ERROR = 'Informe uma data válida com o ano entre 1900 e 2100.';

export function isValidReportDate(value) {
  if (!(value instanceof Date) && typeof value !== 'string') return false;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return false;
  if (date.getUTCFullYear() < MIN_REPORT_YEAR || date.getUTCFullYear() > MAX_REPORT_YEAR) return false;
  if (typeof value === 'string') {
    const match = /^(\d{4}-\d{2}-\d{2})(?:T|$)/.exec(value);
    if (!match) return false;
    const day = new Date(`${match[1]}T00:00:00.000Z`);
    if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== match[1]) return false;
  }
  return true;
}
