function isoDatePart(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

function ptBrDatePart(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? value : '';
}

export function dateInputValue(value?: string | null) {
  if (!value) return '';
  const raw = String(value);
  const datePart = isoDatePart(raw);
  if (datePart) return datePart;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

export function formatDateOnly(value?: string | null, fallback = 'Não informado') {
  if (!value) return fallback;
  const raw = String(value);
  const ptBrDate = ptBrDatePart(raw);
  if (ptBrDate) return ptBrDate;
  const datePart = dateInputValue(raw);
  if (!datePart) return fallback;
  const [year, month, day] = datePart.split('-');
  return `${day}/${month}/${year}`;
}

export function formatDateOnlyPtBr(value?: string | null, fallback = '-') {
  if (!value) return fallback;
  const raw = String(value);
  const formatted = formatDateOnly(raw, '');
  if (formatted) return formatted;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getFullYear()}`;
}
