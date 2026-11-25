import { calculateWorkedMinutes, formatReportMinutes, parseDurationToMinutes } from './reportOvertime';

export interface StandbyFields {
  standby: boolean;
  standbyDuration: string;
  standbyMotivo: string;
}

export interface StandbyReportInput extends StandbyFields {
  dailyDescription: string;
  services: { data: Record<string, unknown> }[];
  arrivalTime: string;
  departureTime: string;
  lunchBreak: string;
  noturno: boolean;
  noturnoStart: string;
  noturnoEnd: string;
  noturnoInterval: string;
}

export interface StandbyEvidence {
  source: string;
  text: string;
  minutes: number | null;
}

export interface StandbySuggestion {
  key: string;
  totalMinutes: number | null;
  duration: string;
  reason: string;
  evidence: StandbyEvidence[];
  warnings: string[];
}

type Interval = [number, number];
interface Occurrence extends StandbyEvidence {
  intervals: Interval[];
  fullDay: boolean;
  summary: boolean;
}

function fold(text: string) {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[–—]/g, '-');
}

const pause = /\b(?:stand\s*-?\s*by|parad[oa]s?|paramos|parou|parali[sz]ad[oa]s?|parali[sz]ac(?:ao|oes)|pausas?|aguard(?:ando|amos|ou|o)|esper(?:a|ando|amos|ou)|interrupc(?:ao|oes)|interrompid[oa]s?|suspens[oa]s?|inativ[oa]s?|ocios[oa]s?|sem (?:liberacao|acesso|energia|frente de trabalho)|falta de (?:energia|liberacao|material))\b/;
const routine = /\b(?:almoco|janta(?:r)?|refeic(?:ao|oes)|cafe|descanso|dds)\b/;
const technicalWait = /\b(?:cura|secagem|reacao|decantacao|tempo de contato|estabilizacao)\b/;
const negated = /\b(?:sem|nao (?:houve|ocorreu|ocorreram|tivemos|tiveram))\s+(?:nenhuma?\s+)?(?:paradas?|pausas?|paralisac(?:ao|oes)|interrupc(?:ao|oes)|stand\s*-?\s*by)\b|\bnao (?:ficamos|ficou|estivemos|estava|estavam)\s+parad[oa]s?\b/;
const uncertain = /\b(?:aproximad\w*|cerca de|mais ou menos|talvez|previst\w*|previsao|amanha|ontem|dia anterior|semana passada|poder\w*|dever\w*|se houver)\b/;
const notCurrent = /\b(?:amanha|ontem|dia anterior|semana passada|previst\w*|previsao|se houver)\b/;
const fullDay = /\b(?:dia (?:todo|inteiro)|tod[oa] (?:o dia|a jornada)|durante tod[oa] (?:o dia|a jornada))\b/;
const numbers: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6,
  sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12,
  quinze: 15, vinte: 20, trinta: 30, quarenta: 40, quarentaecinco: 45, cinquenta: 50
};
const numberPattern = `(?:\\d+(?:[.,]\\d+)?|${Object.keys(numbers).join('|')})`;
const compactDurationPattern = new RegExp(`\\b(${numberPattern})h(\\d{1,2})(?:min(?:utos)?|m)?\\b`, 'g');
const durationPattern = new RegExp(`\\b(?:(${numberPattern})\\s*(?:horas?|hrs?|h)\\b(?:\\s*(?:e\\s*)?(meia\\b|(${numberPattern})\\s*(?:minutos?|mins?|min|m)\\b))?|(${numberPattern})\\s*(?:minutos?|mins?|min)\\b|meia\\s+hora\\b)`, 'g');
const clockPattern = '\\d{1,2}(?:\\s*[:h]\\s*\\d{2}(?::00)?\\s*h?|\\s*h(?:oras?)?)?';
const intervalPattern = new RegExp(`(?<![\\d:.,/])(?:(das?|entre)\\s+)?(${clockPattern})\\s*(as|a|ate|e|-)\\s*(${clockPattern})(?![\\d:h/]|[.,]\\d)`, 'g');

function numberValue(value: string) {
  return numbers[value] ?? Number(value.replace(',', '.'));
}

function clockMinutes(value: string): number | null {
  const match = /^(\d{1,2})(?:\s*[:h]\s*(\d{2})(?::00)?)?\s*(?:h(?:oras?)?)?$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

function intervalsIn(text: string): Interval[] {
  const intervals: Interval[] = [];
  for (const match of text.matchAll(intervalPattern)) {
    // Bare numbers only denote clocks with an explicit "das/entre" prefix.
    if (!match[1] && !/[:h]/.test(match[2]) && !/[:h]/.test(match[4])) continue;
    if (match[3] === 'e' && match[1] !== 'entre') continue;
    const start = clockMinutes(match[2]);
    const end = clockMinutes(match[4]);
    if (start === null || end === null || start === end) continue;
    if (end > start) intervals.push([start, end]);
    else intervals.push([start, 1440], [0, end]);
  }
  return intervals;
}

function unionMinutes(intervals: Interval[]) {
  let total = 0;
  let previousEnd = -1;
  for (const [start, end] of [...intervals].sort((a, b) => a[0] - b[0])) {
    total += Math.max(0, end - Math.max(start, previousEnd));
    previousEnd = Math.max(previousEnd, end);
  }
  return total;
}

function durationsIn(text: string) {
  const values: number[] = [];
  const clockPrefix = (index: number) => /\b(?:as|das|a|ate|desde|apos)\s*$/.test(text.slice(0, index));
  const remaining = text.replace(compactDurationPattern, (match, hours: string, minutes: string, index: number) => {
    if (!clockPrefix(index)) values.push(Number(minutes) < 60 ? numberValue(hours) * 60 + Number(minutes) : NaN);
    return ' '.repeat(match.length);
  });
  for (const match of remaining.matchAll(durationPattern)) {
    if (clockPrefix(match.index)) continue;
    if (match[1]) values.push(numberValue(match[1]) * 60 + (match[2] === 'meia' ? 30 : match[3] ? numberValue(match[3]) : 0));
    else values.push(match[4] ? numberValue(match[4]) : 30);
  }
  // A colon-formatted duration needs a duration label; a lone clock is insufficient.
  for (const match of text.matchAll(/\b(?:por|durante|total(?: de)?(?: stand\s*-?\s*by(?: de)?)?|tempo(?: total)?(?: de)?|parada\s*:|pausa\s*:|stand\s*-?\s*by\s*:)\s*(\d{1,2}:[0-5]\d)(?::00)?\b/g)) {
    values.push(parseDurationToMinutes(match[1]));
  }
  return values;
}

function workedMinutes(input: StandbyReportInput) {
  return calculateWorkedMinutes(input.arrivalTime, input.departureTime, input.lunchBreak)
    + (input.noturno ? calculateWorkedMinutes(input.noturnoStart, input.noturnoEnd, input.noturnoInterval) : 0);
}

/** Local and deterministic: stored annotations are reanalysed independently for every editor. */
export function suggestStandby(input: StandbyReportInput): StandbySuggestion | null {
  const sources = [
    { source: 'Atividades do dia', text: input.dailyDescription },
    ...input.services.map((service, index) => ({
      source: `Observações do serviço ${index + 1}`,
      text: String(service.data.notes || service.data['Observações'] || service.data.Observacoes || '')
    }))
  ];
  const occurrences: Occurrence[] = [];
  const seen = new Set<string>();
  const worked = workedMinutes(input);

  for (const { source, text } of sources) {
    // Preserve clock/decimal punctuation. Each line/sentence carries its own pause context.
    for (const fragment of text.split(/[;\n]+|[.!?](?:\s+|$)|\bmas\b/i)) {
      const excerpt = fragment.trim();
      const normalized = fold(excerpt);
      if (!pause.test(normalized) || negated.test(normalized) || notCurrent.test(normalized)) continue;
      if (/\b(?:termino|fim)\s*\/\s*pausa\b/.test(normalized)) continue;
      const routineContext = routine.test(normalized) || technicalWait.test(normalized);
      if (routineContext && !/\b(?:liberacao|energia|acesso|material|permissao|chuva|guindaste)\b/.test(normalized)) continue;
      const fingerprint = normalized.replace(/[^a-z0-9:]/g, '');
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);

      const intervals = intervalsIn(normalized);
      const durations = intervals.length ? [] : durationsIn(normalized);
      const allDay = fullDay.test(normalized);
      const mixedActivities = intervals.length > 1 && /\b(?:montagem|executad\w*|realizad\w*|limpeza|filtragem|flushing|circulacao|teste)\b/.test(normalized);
      const ambiguous = uncertain.test(normalized) || mixedActivities || routineContext;
      const minutes = ambiguous ? null
        : allDay ? worked || null
        : intervals.length ? unionMinutes(intervals)
        : durations.length === 1 && Number.isInteger(durations[0]) && durations[0] > 0 ? durations[0]
        : null;
      occurrences.push({ source, text: excerpt, minutes, intervals: ambiguous ? [] : intervals,
        fullDay: allDay && !ambiguous, summary: /\btotal\b/.test(normalized) });
    }
  }
  if (!occurrences.length) return null;

  const warnings: string[] = [];
  const details = occurrences.filter(item => !item.summary);
  const summaries = occurrences.filter(item => item.summary);
  const counted = details.length ? details : summaries;
  const intervals = counted.flatMap(item => item.intervals);
  const durations = counted.filter(item => !item.intervals.length && !item.fullDay);
  let totalMinutes: number | null;

  if (counted.some(item => item.minutes === null)) {
    warnings.push('Há menção de pausa sem duração clara ou com contexto ambíguo. Confira os trechos e informe o tempo total.');
    totalMinutes = null;
  } else if (counted.some(item => item.fullDay)) {
    totalMinutes = worked || null;
  } else if (intervals.length && durations.length) {
    warnings.push('Há pausas com horários e outras apenas com duração. Confira possíveis sobreposições e informe o total.');
    totalMinutes = null;
  } else if (!details.length && summaries.length > 1) {
    const totals = new Set(summaries.map(item => item.minutes));
    totalMinutes = totals.size === 1 ? summaries[0].minutes : null;
  } else {
    totalMinutes = intervals.length ? unionMinutes(intervals) : durations.reduce((sum, item) => sum + (item.minutes || 0), 0);
  }

  if (details.length && summaries.some(item => item.minutes === null || item.minutes !== totalMinutes)) {
    warnings.push('O total descrito diverge das pausas identificadas. Confira o tempo total antes de aplicar.');
    totalMinutes = null;
  }
  if (totalMinutes !== null && (totalMinutes <= 0 || totalMinutes >= 1440 || (worked > 0 && totalMinutes > worked))) {
    warnings.push('O tempo identificado excede a jornada informada ou o limite do campo. Confira horários e duração.');
    totalMinutes = null;
  }
  if (totalMinutes === null && !warnings.length) warnings.push('Confira os tempos descritos e informe o total das pausas.');

  const registered = input.standby ? parseDurationToMinutes(input.standbyDuration) : 0;
  // A complete manual entry already covering the detected total takes precedence.
  if (registered > 0 && input.standbyMotivo.trim() && (totalMinutes === null || registered >= totalMinutes)) return null;

  const evidence = occurrences.map(({ source, text, minutes }) => ({ source, text, minutes }));
  return {
    key: JSON.stringify([evidence, totalMinutes]),
    totalMinutes,
    duration: totalMinutes === null ? '' : formatReportMinutes(totalMinutes),
    reason: `Paralisações registradas: ${occurrences.map(item => item.text).join('; ')}.`,
    evidence,
    warnings
  };
}
