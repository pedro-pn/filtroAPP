const businessDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
});
const civilDateFormatter = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' });
const timestampDateFormatter = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' });

// Calendar fields stored at UTC midnight represent a day, not an instant.
export function formatDateOnly(value, fallback = '—') {
  if (!value) return fallback;
  if (value instanceof Date && Number.isNaN(value.getTime())) return fallback;
  const raw = value instanceof Date ? value.toISOString() : String(value);
  const key = raw.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  const date = new Date(key ? `${key}T00:00:00.000Z` : raw);
  return Number.isNaN(date.getTime()) ? fallback : civilDateFormatter.format(date);
}

export function todayDateOnly(now = new Date()) {
  const parts = Object.fromEntries(businessDateFormatter.formatToParts(now).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// Audit/creation timestamps must still be converted to the business timezone.
export function formatTimestampDate(value, fallback = '—') {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : timestampDateFormatter.format(date);
}

const timestampDateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short'
});
export function formatTimestampDateTime(value, fallback = '—') {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : timestampDateTimeFormatter.format(date);
}
