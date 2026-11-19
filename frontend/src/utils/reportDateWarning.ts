import { todayDateOnly } from './dateOnly';

// Aviso não bloqueante para a data do relatório (incidente de 2026-11-19: anos
// digitados como 2062/2027). Nunca impede salvar ou enviar: só chama a atenção.

export type ReportDateWarningKind = 'FUTURE_DAY' | 'OTHER_YEAR';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
// Enquanto o ano é digitado no campo de data, o navegador entrega valores como
// "0002-06-29" ou "0206-06-29"; só avalia anos completos para o aviso não piscar.
const MIN_COMPLETE_YEAR = 1900;

/**
 * Compara a data (AAAA-MM-DD, sem fuso) com o "hoje" do fuso de negócio
 * (todayDateOnly). Strings date-only nunca passam por `new Date()`, para não
 * deslocar o dia por UTC.
 */
export function reportDateWarnings(value: string | null | undefined, now: Date = new Date()): ReportDateWarningKind[] {
  const match = DATE_ONLY.exec(String(value ?? ''));
  if (!match || Number(match[1]) < MIN_COMPLETE_YEAR) return [];
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const today = todayDateOnly(now);
  const warnings: ReportDateWarningKind[] = [];
  if (date > today) warnings.push('FUTURE_DAY');
  if (match[1] !== today.slice(0, 4)) warnings.push('OTHER_YEAR');
  return warnings;
}

function ptBr(date: string) {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

export function reportDateWarningMessage(value: string | null | undefined, now: Date = new Date()): string | null {
  const warnings = reportDateWarnings(value, now);
  if (!warnings.length) return null;
  const date = String(value);
  const year = date.slice(0, 4);
  const currentYear = todayDateOnly(now).slice(0, 4);
  const future = warnings.includes('FUTURE_DAY');
  const otherYear = warnings.includes('OTHER_YEAR');
  if (future && otherYear) {
    return `Atenção: a data está no futuro (${ptBr(date)}) e o ano informado (${year}) não é o ano atual (${currentYear}). Confira antes de enviar.`;
  }
  if (future) return `Atenção: a data está no futuro (${ptBr(date)}). Confira antes de enviar.`;
  return `Atenção: o ano informado (${year}) não é o ano atual (${currentYear}). Confira antes de enviar.`;
}

export function reportDateWarningId(inputId: string) {
  return `${inputId}-date-warning`;
}

/** `aria-describedby` do campo de data: aponta para o aviso só quando ele existe. */
export function reportDateDescribedBy(inputId: string, value: string | null | undefined) {
  return reportDateWarningMessage(value) ? reportDateWarningId(inputId) : undefined;
}
