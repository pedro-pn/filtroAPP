import { calculateWorkedMinutes, formatReportMinutes, parseDurationToMinutes } from './reportOvertime';

/**
 * `standby` = paralisação por conta do cliente (aparece no RDO).
 * `internalStandby` = pausa por nossa conta (falha de equipamento, acidente...): só uso interno, nunca vai ao RDO.
 */
export interface StandbyFields {
  standby: boolean;
  standbyDuration: string;
  standbyMotivo: string;
  internalStandby: boolean;
  internalStandbyDuration: string;
  internalStandbyMotivo: string;
  standbySuggestionReview?: StandbyReviewReceipt | null;
}

export type PauseResponsibility = 'client' | 'internal' | 'both';

export interface StandbyReviewReceipt {
  version: 1;
  sourceKey: string;
  standby: boolean;
  totalMinutes: number;
  deductedBreakMinutes: number;
  /** Minutos classificados como pausa por nossa conta (ausente em recibos antigos = 0). */
  internalMinutes?: number;
}

export interface StandbyBreak {
  id: 'day' | 'night';
  label: string;
  minutes: number;
  maxOverlapMinutes: number;
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
  responsibility?: 'client' | 'internal' | null;
}

export interface StandbySuggestion {
  key: string;
  totalMinutes: number | null;
  duration: string;
  reason: string;
  evidence: StandbyEvidence[];
  warnings: string[];
  breaks: StandbyBreak[];
  /** Responsabilidade inferida pelo texto; null quando não há pista suficiente (o colaborador escolhe). */
  responsibility: PauseResponsibility | null;
  /** Minutos sugeridos como "nossa conta" quando a responsabilidade é mista e os trechos têm duração clara. */
  internalMinutes: number | null;
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
// Pistas de responsabilidade. Cliente: aguardando liberação/documentação/condições da planta.
// Nossa conta: falha/quebra de equipamento próprio, acidente, falta de recurso nosso.
const clientCause = /\b(?:pt|apr|pts|permiss(?:ao|oes) de trabalho|permiss\w*|liberac(?:ao|oes)|liberad[oa]|documentac\w*|documentos?|energia|frente de (?:servico|trabalho)|cliente|contratante|fiscal(?:izacao)?|operacao da (?:planta|unidade)|parada da (?:planta|unidade)|andaime|isolamento|bloqueio|raquete\w*|chuva|tempestade|descargas? atmosfericas?|alerta de raios?|acesso|integrac(?:ao|oes)|crach\w*)\b/;
const internalCause = /\b(?:falhas?(?! (?:de|na|no) (?:energia|rede|liberac\w*|cliente))|defeitos?|quebr\w*|pane|avaria\w*|vazamentos?|manutenc(?:ao|oes) corretiva|conserto|reparo|acidentes?|incidentes?|nosso equipamento|nossos equipamentos|nossa equipe|equipamento (?:da filtrovali|nosso|proprio)|falta de (?:ferramenta|epi|insumo|combustivel|oleo|elemento filtrante)|bomba (?:parou|travou|queimou)|motor (?:parou|travou|queimou)|gerador|compressor (?:parou|travou|queimou)|mangueira (?:rompeu|estourou)|atraso (?:da|de) (?:nossa )?equipe)\b/;

export function classifyPauseResponsibility(text: string): 'client' | 'internal' | null {
  const normalized = fold(text);
  const client = clientCause.test(normalized);
  const internal = internalCause.test(normalized);
  return client === internal ? null : client ? 'client' : 'internal';
}

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
const intervalPattern = new RegExp(`(?<![\\d:.,/])(?:(das?|entre)(?:\\s+as)?\\s+)?(${clockPattern})\\s*(as|a|ate|e|-)\\s*(?:as\\s+)?(${clockPattern})(?![\\d:h/]|[.,]\\d)`, 'g');

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

function possibleBreaks(input: StandbyReportInput, intervals: Interval[]): StandbyBreak[] {
  const shifts = [
    { id: 'day' as const, label: 'Intervalo de almoço', duration: input.lunchBreak, start: input.arrivalTime, end: input.departureTime },
    ...(input.noturno ? [{ id: 'night' as const, label: 'Intervalo noturno', duration: input.noturnoInterval, start: input.noturnoStart, end: input.noturnoEnd }] : [])
  ];
  return shifts.flatMap(shift => {
    const minutes = parseDurationToMinutes(shift.duration);
    if (!Number.isInteger(minutes) || minutes <= 0 || minutes >= 1440) return [];
    const start = clockMinutes(shift.start);
    const end = clockMinutes(shift.end);
    const windows: Interval[] = start === null || end === null ? [[0, 1440]]
      : end >= start ? [[start, end]] : [[start, 1440], [0, end]];
    const overlaps: Interval[] = intervals.flatMap(([from, to]) => windows
      .map(([shiftStart, shiftEnd]): Interval => [Math.max(from, shiftStart), Math.min(to, shiftEnd)])
      .filter(([from, to]) => to > from));
    const maxOverlapMinutes = Math.min(minutes, unionMinutes(overlaps));
    return maxOverlapMinutes > 0 ? [{ id: shift.id, label: shift.label, minutes, maxOverlapMinutes }] : [];
  });
}

function sourceFingerprint(value: string) {
  let hash = 14695981039346656037n;
  for (let index = 0; index < value.length; index++) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(value.charCodeAt(index))) * 1099511628211n);
  }
  return hash.toString(16).padStart(16, '0');
}

export function readStandbyReviewReceipt(value: unknown): StandbyReviewReceipt | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || typeof record.sourceKey !== 'string' || !/^[0-9a-f]{16}$/.test(record.sourceKey)
    || typeof record.standby !== 'boolean' || !Number.isInteger(record.totalMinutes)
    || Number(record.totalMinutes) < 0 || Number(record.totalMinutes) >= 1440
    || !Number.isInteger(record.deductedBreakMinutes) || Number(record.deductedBreakMinutes) < 0
    || Number(record.deductedBreakMinutes) >= 1440 || record.standby !== (Number(record.totalMinutes) > 0)) return null;
  if (record.internalMinutes !== undefined && (!Number.isInteger(record.internalMinutes)
    || Number(record.internalMinutes) < 0 || Number(record.internalMinutes) >= 1440)) return null;
  return record as unknown as StandbyReviewReceipt;
}

/** Missing choices and impossible overlaps never produce an automatic net duration. */
export function standbyMinutesAfterBreaks(suggestion: StandbySuggestion, deductions: Partial<Record<StandbyBreak['id'], number>>) {
  if (suggestion.totalMinutes === null) return null;
  let deducted = 0;
  for (const option of suggestion.breaks) {
    const value = deductions[option.id];
    if (value === undefined || !Number.isInteger(value) || value < 0 || value > option.maxOverlapMinutes) return null;
    deducted += value;
  }
  return deducted <= suggestion.totalMinutes ? suggestion.totalMinutes - deducted : null;
}

/**
 * Divide o total revisado entre standby do cliente (RDO) e pausa por nossa conta (interno).
 * `internalDuration` só é usado quando a responsabilidade é mista ("both").
 */
export function reviewedStandbyFields(
  suggestion: StandbySuggestion,
  duration: string,
  reason: string,
  deductedBreakMinutes: number,
  responsibility: PauseResponsibility = 'client',
  internalDuration = ''
): StandbyFields {
  const totalMinutes = parseDurationToMinutes(duration);
  const internalMinutes = totalMinutes <= 0 ? 0
    : responsibility === 'internal' ? totalMinutes
    : responsibility === 'both' ? Math.min(totalMinutes, Math.max(0, parseDurationToMinutes(internalDuration) || 0))
    : 0;
  const clientMinutes = totalMinutes > 0 ? totalMinutes - internalMinutes : 0;
  const text = reason.trim();
  return {
    standby: clientMinutes > 0,
    standbyDuration: clientMinutes > 0 ? formatReportMinutes(clientMinutes) : '',
    standbyMotivo: clientMinutes > 0 ? text : '',
    internalStandby: internalMinutes > 0,
    internalStandbyDuration: internalMinutes > 0 ? formatReportMinutes(internalMinutes) : '',
    internalStandbyMotivo: internalMinutes > 0 ? text : '',
    standbySuggestionReview: {
      version: 1, sourceKey: suggestion.key, standby: clientMinutes > 0, totalMinutes: clientMinutes, deductedBreakMinutes, internalMinutes
    }
  };
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
  const breaks = totalMinutes !== null && intervals.length > 0 && durations.length === 0 && !counted.some(item => item.fullDay)
    ? possibleBreaks(input, intervals) : [];
  const possibleDeduction = breaks.reduce((sum, option) => sum + option.maxOverlapMinutes, 0);
  if (totalMinutes !== null && (totalMinutes <= 0 || totalMinutes >= 1440 || (worked > 0 && totalMinutes - possibleDeduction > worked))) {
    warnings.push('O tempo identificado excede a jornada informada ou o limite do campo. Confira horários e duração.');
    totalMinutes = null;
  }
  if (totalMinutes === null && !warnings.length) warnings.push('Confira os tempos descritos e informe o total das pausas.');

  const evidence = occurrences.map(({ source, text, minutes }) => ({ source, text, minutes }));
  const key = sourceFingerprint(JSON.stringify([evidence, totalMinutes, breaks, clockMinutes(input.arrivalTime), clockMinutes(input.departureTime),
    parseDurationToMinutes(input.lunchBreak), input.noturno,
    ...(input.noturno ? [clockMinutes(input.noturnoStart), clockMinutes(input.noturnoEnd), parseDurationToMinutes(input.noturnoInterval)] : [])]));
  const registered = input.standby ? parseDurationToMinutes(input.standbyDuration) : 0;
  const registeredInternal = input.internalStandby ? parseDurationToMinutes(input.internalStandbyDuration) : 0;
  const clientComplete = !input.standby || Boolean(input.standbyMotivo.trim());
  const internalComplete = !input.internalStandby || Boolean(input.internalStandbyMotivo.trim());
  const receipt = readStandbyReviewReceipt(input.standbySuggestionReview);
  if (receipt?.sourceKey === key && receipt.standby === input.standby && receipt.totalMinutes === registered
    && (receipt.internalMinutes ?? 0) === registeredInternal && clientComplete && internalComplete) return null;
  // A complete manual entry (cliente + nossa conta) already covering the detected total takes precedence.
  const covered = registered + registeredInternal;
  if (covered > 0 && clientComplete && internalComplete && (totalMinutes === null || covered >= totalMinutes)) return null;

  const classified = evidence.map(item => ({ ...item, responsibility: classifyPauseResponsibility(item.text) }));
  // Trechos sem pista (ex.: "parados das 8h às 10h") não anulam os que indicam a causa.
  const classes = new Set(classified.map(item => item.responsibility).filter(item => item !== null));
  const responsibility: PauseResponsibility | null = classes.size === 0 ? null
    : classes.size === 1 ? [...classes][0] : 'both';
  const internalEvidence = classified.filter(item => item.responsibility === 'internal');
  const internalMinutes = responsibility === 'both' && internalEvidence.every(item => item.minutes !== null)
    ? internalEvidence.reduce((sum, item) => sum + (item.minutes || 0), 0) : null;

  return {
    key,
    totalMinutes,
    duration: totalMinutes === null ? '' : formatReportMinutes(totalMinutes),
    reason: `Paralisações registradas: ${occurrences.map(item => item.text).join('; ')}.`,
    evidence: classified,
    warnings,
    breaks: totalMinutes === null ? [] : breaks,
    responsibility,
    internalMinutes: internalMinutes !== null && totalMinutes !== null && internalMinutes < totalMinutes ? internalMinutes : null
  };
}
