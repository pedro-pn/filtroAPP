import { isBusinessDay } from '../efetivo/planning/business-days.js';

/*
 * Prazos em dias úteis usados pelo envio do relatório mensal de alocação (feature 037).
 * Dia útil = segunda a sexta fora dos feriados corporativos. O próprio dia 1º conta quando é útil:
 * com o dia 1º numa sexta-feira sem feriados, o 3º dia útil é a terça-feira, dia 5.
 */

const YEAR_MONTH = /^(\d{4})-(\d{2})$/;

function pad(value) {
  return String(value).padStart(2, '0');
}

function dateKey(year, month, day) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function parseYearMonth(yearMonth) {
  const match = YEAR_MONTH.exec(String(yearMonth || ''));
  if (!match) throw new Error(`Mês inválido: ${yearMonth}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error(`Mês inválido: ${yearMonth}`);
  return { year, month };
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function nthBusinessDayOfMonth(yearMonth, n, holidayDates = new Set()) {
  if (!Number.isInteger(n) || n < 1) throw new Error('n deve ser inteiro positivo.');
  const { year, month } = parseYearMonth(yearMonth);
  let count = 0;
  for (let day = 1; day <= daysInMonth(year, month); day += 1) {
    const key = dateKey(year, month, day);
    if (isBusinessDay(key, holidayDates)) {
      count += 1;
      if (count === n) return key;
    }
  }
  throw new Error(`O mês ${yearMonth} não tem ${n} dias úteis.`);
}

// Segundas-feiras (YYYY-MM-DD) das semanas seg–dom que têm ao menos um dia no mês.
export function weekStartsTouchingMonth(yearMonth) {
  const { year, month } = parseYearMonth(yearMonth);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const weekday = first.getUTCDay();
  const offset = weekday === 0 ? 6 : weekday - 1;
  const cursor = new Date(first.getTime() - offset * 86400000);
  const last = new Date(Date.UTC(year, month - 1, daysInMonth(year, month)));
  const result = [];
  while (cursor <= last) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return result;
}
