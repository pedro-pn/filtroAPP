export const PRODUCTIVITY_MONTH_OPTIONS = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro'
].map((label, index) => ({ value: index + 1, label: `Até ${label}` }));

export interface ProductivityPeriod {
  year: number;
  cutoffMonth: number;
}

export function defaultProductivityPeriod(now = new Date()): ProductivityPeriod {
  const currentMonth = now.getMonth() + 1;
  if (currentMonth === 1) {
    return { year: now.getFullYear() - 1, cutoffMonth: 12 };
  }
  return { year: now.getFullYear(), cutoffMonth: currentMonth - 1 };
}

export function productivityYearOptions(now = new Date(), count = 5) {
  const currentYear = now.getFullYear();
  return Array.from({ length: count }, (_item, index) => currentYear - index);
}

export function parseProductivityPeriod(params: URLSearchParams, now = new Date()): ProductivityPeriod {
  const fallback = defaultProductivityPeriod(now);
  const year = Number(params.get('ano'));
  const cutoffMonth = Number(params.get('ateMes'));
  return {
    year: Number.isInteger(year) && year >= 2000 && year <= now.getFullYear() + 1 ? year : fallback.year,
    cutoffMonth: Number.isInteger(cutoffMonth) && cutoffMonth >= 1 && cutoffMonth <= 12
      ? cutoffMonth
      : fallback.cutoffMonth
  };
}

export function setProductivityPeriodParams(params: URLSearchParams, period: ProductivityPeriod) {
  const next = new URLSearchParams(params);
  next.set('ano', String(period.year));
  next.set('ateMes', String(period.cutoffMonth));
  return next;
}
