const TIME = /\b(\d{1,2})\s*:\s*(\d{2})(?::\d{2})?\b/g;
const DURATION = '(?:\\d{1,2}\\s*:\\s*\\d{2}(?:\\s*:\\s*\\d{2})?|\\d{1,2}\\s*h(?:oras?)?(?:\\s*\\d{1,2})?|\\d{1,3}\\s*min|sem intervalo)';

function fold(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function times(value) {
  return [...value.matchAll(TIME)].flatMap(match => {
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    return hours < 24 && minutes < 60
      ? [`${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`]
      : [];
  });
}

function duration(value) {
  if (!value) return undefined;
  const text = fold(value).trim();
  if (text === 'sem intervalo') return '00:00:00';
  const clock = text.match(/^(\d{1,2})\s*:\s*(\d{2})(?:\s*:\s*(\d{2}))?$/);
  let seconds;
  if (clock) {
    if (Number(clock[2]) > 59 || Number(clock[3] || 0) > 59) return undefined;
    seconds = Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3] || 0);
  } else {
    const hours = text.match(/^(\d{1,2})\s*h(?:oras?)?(?:\s*(\d{1,2}))?$/);
    const minutes = text.match(/^(\d{1,3})\s*min$/);
    if (hours && Number(hours[2] || 0) < 60) seconds = Number(hours[1]) * 3600 + Number(hours[2] || 0) * 60;
    else if (minutes) seconds = Number(minutes[1]) * 60;
    else return undefined;
  }
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(part => String(part).padStart(2, '0')).join(':');
}

function labeledDuration(text, label) {
  return duration(text.match(new RegExp(`\\b${label}\\s*[:.-]?\\s*(${DURATION})(?![\\d:])`, 'i'))?.[1]);
}

function worktimeSection(text) {
  const start = text.search(/\bjornada de trabalho\b|\b(?:horario de )?entrada\b|\bturno (?:diurno|noturno)\b/);
  if (start < 0) return '';
  return text.slice(start).split(/\batividades\b|\bitem\s*\d+\b|\bservico\s*:/)[0];
}

function shiftTimes(section, label) {
  const matches = [...section.matchAll(new RegExp(`\\b(?:horario de )?${label}(?:\\s*\\((?:diurno|noturno)\\))?\\s*[:.-]?\\s*`, 'g'))];
  let day;
  let night;
  for (const match of matches) {
    // Stop at another field so empty cells never borrow a neighboring value.
    const row = section.slice(match.index + match[0].length).split(/\n|\bintervalo\b|\b(?:n[ºo°.]?\s*)?colaboradores\b|\b(?:entrada|saida)\b|\bhoras extras\b/)[0];
    if (row.includes('<')) {
      day ||= times(row.match(/([\d\s:]+)\s*<\s*diurno/)?.[1] || '')[0];
      night ||= times(row.match(/([\d\s:]+)\s*<\s*noturno/)?.[1] || '')[0];
    } else {
      const value = times(row)[0];
      const prefix = section.slice(0, match.index);
      const nightSection = prefix.lastIndexOf('turno noturno') > prefix.lastIndexOf('turno diurno')
        && !/turno diurno[^\n]*turno noturno/.test(prefix);
      if (/\bnoturno\b/.test(match[0] + row) || nightSection || (matches.length > 1 && match !== matches[0])) night ||= value;
      else day ||= value;
    }
  }
  return { day, night };
}

/** Read only labeled work hours; service start/end times are separate data. */
export function parseManualReportPdfFields(text) {
  const raw = String(text || '').replace(/[\t ]+/g, ' ');
  const normalized = fold(raw);
  const section = worktimeSection(normalized);
  const arrival = shiftTimes(section, 'entrada');
  const departure = shiftTimes(section, 'saida');
  const fields = {};
  if (arrival.day) fields.arrivalTime = arrival.day;
  if (departure.day) fields.departureTime = departure.day;
  const inlineHeaders = /turno diurno[^\n]*turno noturno/.test(section);
  const daySection = inlineHeaders ? section : section.split(/\bturno noturno\b/)[0];
  const lunchBreak = labeledDuration(daySection, 'intervalo(?: de almoco| do almoco| diurno)?');
  if (lunchBreak) fields.lunchBreak = lunchBreak;

  // Some versions label the night block with início/término instead of entrada/saída.
  const nightBlock = section.match(/\bturno noturno\s*:?([^]*?)(?=\bturno diurno\b|$)/)?.[1] || '';
  const nightStart = arrival.night || times(nightBlock.match(/\binicio\s*[:.-]?\s*([\d :]+)/)?.[1] || '')[0];
  const nightEnd = departure.night || times(nightBlock.match(/\b(?:termino|fim)\s*[:.-]?\s*([\d :]+)/)?.[1] || '')[0];
  if (nightStart || nightEnd) {
    fields.noturno = true;
    if (nightStart) fields.noturnoStart = nightStart;
    if (nightEnd) fields.noturnoEnd = nightEnd;
    const interval = labeledDuration(section, 'intervalo(?: de janta(?:r)?| do jantar| noturno)')
      || labeledDuration(nightBlock, 'intervalo');
    if (interval) fields.noturnoInterval = interval;
  }

  const standbyLabel = '(?:tempo (?:total )?(?:de )?)?stand\\s*[- ]?\\s*by(?:\\s*\\(h\\))?';
  const standbyDuration = labeledDuration(normalized, standbyLabel);
  if (standbyDuration && standbyDuration !== '00:00:00') {
    fields.standby = true;
    fields.standbyDuration = standbyDuration;
    const motive = normalized.match(/\bmotivo\s*(?:stand\s*[- ]?\s*by)?\s*:\s*/);
    if (motive) {
      const start = motive.index + motive[0].length;
      const rest = normalized.slice(start);
      const end = rest.search(/\b(?:lider|responsavel|cargo|ass\.|assinatura|coment\.|comentario|horas extras|servico|turno|entrada|saida)\b/);
      const value = raw.slice(start, end < 0 ? undefined : start + end).trim().replace(/^[\s:._–—-]+|[\s._–—-]+$/g, '');
      if (value && !/^(?:nao|sem|n\/a)$/i.test(fold(value))) fields.standbyMotivo = value.slice(0, 1000);
    }
  }
  return fields;
}

/** Form values can be appended after labels in a PDF stream: rebuild visual rows. */
export function manualPdfTextFromItems(items) {
  const rows = [];
  for (const item of items.filter(item => typeof item.str === 'string' && item.str.trim())
    .sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4])) {
    let row = rows.find(row => Math.abs(row.y - item.transform[5]) <= 2.5);
    if (!row) { row = { y: item.transform[5], items: [] }; rows.push(row); }
    row.items.push(item);
  }
  return rows.map(row => row.items.sort((a, b) => a.transform[4] - b.transform[4])
    .map(item => item.str).join(' ')).join('\n');
}
