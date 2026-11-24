/**
 * Gerador de planilhas XLSX no modelo padrão Filtrovali — sem dependências.
 *
 * Usado pelo frontend (exportações montadas no navegador) e pelo backend (exportações
 * geradas no servidor). Produz um .xlsx (OOXML) com:
 *   - faixa de título na cor da marca + subtítulo do módulo + filete de destaque;
 *   - linhas de contexto (período, filtros, gerado em, nº de registros);
 *   - cabeçalho verde com autofiltro e painel congelado;
 *   - linhas zebradas, sem linhas de grade, bordas discretas;
 *   - valores tipados (número, moeda, data, data-hora, duração) — nada de texto "250.00";
 *   - status em "badges" (cor de fundo + texto) iguais aos do app;
 *   - linha de totais com SUBTOTAL (respeita o autofiltro);
 *   - impressão em paisagem, ajustada à largura, com cabeçalho repetido e rodapé paginado.
 *
 * O ZIP é montado aqui; a compressão é injetada (`deflateRaw`) para cada ambiente usar a
 * sua (zlib no Node, CompressionStream no navegador). Sem ela, os arquivos são armazenados.
 */

export const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Tokens do Filtrovali DS (frontend/src/styles/variables.css), sem o "#".
const PALETTE = {
  brandDark: '243D2C',
  brand: '2C4A36',
  brandHeader: '30503A',
  accent: '72B487',
  brandSoft: 'E6EFE9',
  brandWash: 'F2F7F4',
  subtitle: 'C9DDD0',
  ink: '16211B',
  muted: '596273',
  line: 'E5E7EB',
  white: 'FFFFFF'
};

const TONES = {
  success: { font: '1F7A3D', fill: 'E6F4EA' },
  warning: { font: 'B45309', fill: 'FFF7E6' },
  danger: { font: 'C81519', fill: 'FDECEC' },
  info: { font: '11437E', fill: 'E7EFFA' },
  neutral: { font: '374151', fill: 'F3F4F4' }
};

const FONT_NAME = 'Calibri';
const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';

const NUMBER_TYPES = new Set(['integer', 'decimal', 'currency', 'percent', 'duration']);
const DATE_TYPES = new Set(['date', 'datetime']);

const BUILTIN_NUM_FMTS = new Map([
  ['General', 0], ['0', 1], ['0.00', 2], ['#,##0', 3], ['#,##0.00', 4], ['0%', 9], ['0.00%', 10]
]);

function defaultNumFmt(column) {
  if (column.numFmt) return column.numFmt;
  const decimals = Number.isInteger(column.decimals) ? column.decimals : 2;
  const fraction = decimals > 0 ? `.${'0'.repeat(decimals)}` : '';
  switch (column.type) {
    case 'integer': return '#,##0';
    case 'decimal': return `#,##0${fraction}`;
    case 'currency': return `"R$" #,##0.00;[Red]-"R$" #,##0.00`;
    case 'percent': return `0${Number.isInteger(column.decimals) ? fraction : '.0'}%`;
    case 'duration': return '[h]:mm';
    case 'date': return 'dd/mm/yyyy';
    case 'datetime': return 'dd/mm/yyyy hh:mm';
    default: return 'General';
  }
}

function defaultAlign(column) {
  if (column.align) return column.align;
  if (NUMBER_TYPES.has(column.type)) return 'right';
  if (DATE_TYPES.has(column.type)) return 'center';
  return 'left';
}

// ─── XML helpers ────────────────────────────────────────────────────────────

// Caracteres de controle não são permitidos em XML 1.0.
// eslint-disable-next-line no-control-regex
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

function escapeXml(value) {
  return String(value ?? '')
    .replace(INVALID_XML_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function textNode(value) {
  const text = escapeXml(value);
  const preserve = /^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : '';
  return `<t${preserve}>${text}</t>`;
}

export function columnLetter(index) {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function cellRef(colIndex, rowNumber) {
  return `${columnLetter(colIndex)}${rowNumber}`;
}

export function sanitizeSheetName(name, fallback = 'Planilha') {
  const clean = String(name ?? '').replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim();
  return (clean || fallback).slice(0, 31);
}

// ─── Value coercion ─────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

function serialFromParts(year, month, day, hour = 0, minute = 0, second = 0) {
  const utc = Date.UTC(year, month - 1, day, hour, minute, second);
  return (utc - EXCEL_EPOCH_UTC) / DAY_MS;
}

const zonedFormatters = new Map();
function zonedParts(date, timeZone) {
  let formatter = zonedFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    });
    zonedFormatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  return [Number(parts.year), Number(parts.month), Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second)];
}

function toDateSerial(value, withTime, timeZone) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    const text = value.trim();
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (dateOnly) return serialFromParts(+dateOnly[1], +dateOnly[2], +dateOnly[3]);
    const ptBr = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
    if (ptBr) {
      const serial = serialFromParts(+ptBr[3], +ptBr[2], +ptBr[1], +(ptBr[4] || 0), +(ptBr[5] || 0), +(ptBr[6] || 0));
      return withTime ? serial : Math.floor(serial);
    }
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const [year, month, day, hour, minute, second] = zonedParts(date, timeZone);
  return withTime ? serialFromParts(year, month, day, hour, minute, second) : serialFromParts(year, month, day);
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s|R\$/g, '');
  if (!text) return null;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  // pt-BR: 1.234,56
  if (/^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(text) || /^-?\d+,\d+$/.test(text)) {
    return Number(text.replace(/\./g, '').replace(',', '.'));
  }
  return null;
}

/** Converte o valor bruto em { kind: 'number' | 'text' | 'empty', value }. */
function coerceCell(value, column, timeZone) {
  if (value === null || value === undefined || value === '') return { kind: 'empty' };
  if (typeof value === 'boolean') return { kind: 'text', value: value ? 'Sim' : 'Não' };
  if (NUMBER_TYPES.has(column.type)) {
    const number = toNumber(value);
    if (number === null) return { kind: 'text', value: String(value) };
    if (column.type === 'duration') return { kind: 'number', value: number / (24 * 60) };
    return { kind: 'number', value: number };
  }
  if (DATE_TYPES.has(column.type)) {
    const serial = toDateSerial(value, column.type === 'datetime', timeZone);
    return serial === null ? { kind: 'text', value: String(value) } : { kind: 'number', value: serial };
  }
  if (value instanceof Date) return { kind: 'text', value: value.toISOString() };
  return { kind: 'text', value: Array.isArray(value) ? value.join(', ') : String(value) };
}

// ─── Styles ─────────────────────────────────────────────────────────────────

class StyleRegistry {
  constructor() {
    this.fonts = [];
    this.fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
    this.borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
    this.numFmts = [];
    this.xfs = [];
    this.index = { font: new Map(), fill: new Map(), border: new Map(), numFmt: new Map(), xf: new Map() };
    this.font({});
    this.xf({});
  }

  register(kind, list, key, xmlValue) {
    const map = this.index[kind];
    if (map.has(key)) return map.get(key);
    list.push(xmlValue);
    map.set(key, list.length - 1);
    return list.length - 1;
  }

  font({ size = 10, color = PALETTE.ink, bold = false, italic = false } = {}) {
    const key = `${size}|${color}|${bold}|${italic}`;
    return this.register('font', this.fonts, key,
      `<font>${bold ? '<b/>' : ''}${italic ? '<i/>' : ''}<sz val="${size}"/><color rgb="FF${color}"/><name val="${FONT_NAME}"/><family val="2"/></font>`);
  }

  fill(color) {
    if (!color) return 0;
    return this.register('fill', this.fills, color,
      `<fill><patternFill patternType="solid"><fgColor rgb="FF${color}"/><bgColor indexed="64"/></patternFill></fill>`);
  }

  border({ bottom, top } = {}) {
    if (!bottom && !top) return 0;
    const side = (name, spec) => spec
      ? `<${name} style="${spec.style}"><color rgb="FF${spec.color}"/></${name}>`
      : `<${name}/>`;
    const key = `${bottom?.style}|${bottom?.color}|${top?.style}|${top?.color}`;
    return this.register('border', this.borders, key,
      `<border><left/><right/>${side('top', top)}${side('bottom', bottom)}<diagonal/></border>`);
  }

  numFmt(code) {
    if (!code || code === 'General') return 0;
    if (BUILTIN_NUM_FMTS.has(code)) return BUILTIN_NUM_FMTS.get(code);
    const map = this.index.numFmt;
    if (map.has(code)) return map.get(code);
    const id = 164 + this.numFmts.length;
    this.numFmts.push(`<numFmt numFmtId="${id}" formatCode="${escapeXml(code)}"/>`);
    map.set(code, id);
    return id;
  }

  /** spec: { font, fill, border, numFmt, h, v, wrap, indent } */
  xf(spec = {}) {
    const fontId = this.font(spec.font || {});
    const fillId = this.fill(spec.fill);
    const borderId = this.border(spec.border);
    const numFmtId = this.numFmt(spec.numFmt);
    const h = spec.h || '';
    const v = spec.v || 'center';
    const wrap = Boolean(spec.wrap);
    const indent = spec.indent || 0;
    const key = `${fontId}|${fillId}|${borderId}|${numFmtId}|${h}|${v}|${wrap}|${indent}`;
    const alignment = `<alignment${h ? ` horizontal="${h}"` : ''} vertical="${v}"${wrap ? ' wrapText="1"' : ''}${indent ? ` indent="${indent}"` : ''}/>`;
    return this.register('xf', this.xfs, key,
      `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"`
      + `${numFmtId ? ' applyNumberFormat="1"' : ''} applyFont="1"${fillId ? ' applyFill="1"' : ''}`
      + `${borderId ? ' applyBorder="1"' : ''} applyAlignment="1">${alignment}</xf>`);
  }

  toXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + (this.numFmts.length ? `<numFmts count="${this.numFmts.length}">${this.numFmts.join('')}</numFmts>` : '')
      + `<fonts count="${this.fonts.length}">${this.fonts.join('')}</fonts>`
      + `<fills count="${this.fills.length}">${this.fills.join('')}</fills>`
      + `<borders count="${this.borders.length}">${this.borders.join('')}</borders>`
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + `<cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs>`
      + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
      + '</styleSheet>';
  }
}

class SharedStrings {
  constructor() {
    this.items = [];
    this.index = new Map();
    this.count = 0;
  }

  add(text) {
    this.count += 1;
    const key = `t:${text}`;
    if (this.index.has(key)) return this.index.get(key);
    this.items.push(`<si>${textNode(text)}</si>`);
    this.index.set(key, this.items.length - 1);
    return this.items.length - 1;
  }

  /** Texto rico: [{ text, bold?, color?, size? }] */
  addRich(runs) {
    this.count += 1;
    const key = `r:${JSON.stringify(runs)}`;
    if (this.index.has(key)) return this.index.get(key);
    const xmlRuns = runs.map(run => (
      `<r><rPr>${run.bold ? '<b/>' : ''}<sz val="${run.size || 9}"/><color rgb="FF${run.color || PALETTE.muted}"/>`
      + `<rFont val="${FONT_NAME}"/><family val="2"/></rPr>${textNode(run.text)}</r>`
    )).join('');
    this.items.push(`<si>${xmlRuns}</si>`);
    this.index.set(key, this.items.length - 1);
    return this.items.length - 1;
  }

  toXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${this.count}" uniqueCount="${this.items.length}">`
      + this.items.join('') + '</sst>';
  }
}

// ─── Sheet ──────────────────────────────────────────────────────────────────

function formatGeneratedAt(date, timeZone) {
  const [year, month, day, hour, minute] = zonedParts(date, timeZone);
  const pad = value => String(value).padStart(2, '0');
  return `${pad(day)}/${pad(month)}/${year} às ${pad(hour)}:${pad(minute)}`;
}

function displayLength(cell, column) {
  if (cell.kind === 'empty') return 0;
  if (cell.kind === 'text') {
    return Math.max(...String(cell.value).split('\n').map(line => line.length));
  }
  switch (column.type) {
    case 'date': return 10;
    case 'datetime': return 16;
    case 'duration': return Math.max(5, String(Math.floor(cell.value * 24)).length + 3);
    case 'currency': return Math.abs(cell.value).toFixed(2).length + 5;
    case 'percent': return 7;
    default: {
      const digits = Math.abs(Math.trunc(cell.value)).toString().length;
      const decimals = column.type === 'integer' ? 0 : (Number.isInteger(column.decimals) ? column.decimals : 2);
      return digits + Math.floor((digits - 1) / 3) + (decimals ? decimals + 1 : 0) + (cell.value < 0 ? 1 : 0);
    }
  }
}

function normalizeTone(tone) {
  return tone && TONES[tone] ? tone : null;
}

function buildSheet(sheet, ctx) {
  const { styles, strings, timeZone, generatedAt } = ctx;
  const columns = (sheet.columns || []).map(column => ({ type: 'text', ...column }));
  if (!columns.length) throw new Error('A planilha precisa de ao menos uma coluna.');
  const lastCol = columns.length - 1;
  const lastLetter = columnLetter(lastCol);
  const rows = sheet.rows || [];

  // Estilos fixos do modelo.
  const s = {
    title: styles.xf({ font: { size: 16, bold: true, color: PALETTE.white }, fill: PALETTE.brand, indent: 1 }),
    subtitle: styles.xf({ font: { size: 10, color: PALETTE.subtitle }, fill: PALETTE.brand, indent: 1 }),
    accent: styles.xf({ fill: PALETTE.accent }),
    meta: styles.xf({ font: { size: 9, color: PALETTE.muted }, indent: 1 }),
    empty: styles.xf({ font: { size: 10, italic: true, color: PALETTE.muted }, h: 'center' }),
    totalLabel: styles.xf({
      font: { bold: true, color: PALETTE.brandDark }, fill: PALETTE.brandSoft,
      border: { top: { style: 'medium', color: PALETTE.brandHeader }, bottom: { style: 'thin', color: PALETTE.brandHeader } }
    })
  };
  const headerStyles = columns.map(column => styles.xf({
    font: { bold: true, color: PALETTE.white }, fill: PALETTE.brandHeader, wrap: true,
    h: defaultAlign(column) === 'right' ? 'right' : defaultAlign(column) === 'center' ? 'center' : 'left',
    border: { bottom: { style: 'medium', color: PALETTE.brandDark } }
  }));
  const dataBorder = { bottom: { style: 'thin', color: PALETTE.line } };
  const dataStyle = (column, zebra, tone) => {
    const toneSpec = tone ? TONES[tone] : null;
    return styles.xf({
      font: toneSpec ? { bold: true, color: toneSpec.font } : { color: PALETTE.ink },
      fill: toneSpec ? toneSpec.fill : (zebra ? PALETTE.brandWash : null),
      border: dataBorder,
      numFmt: defaultNumFmt(column),
      h: toneSpec ? 'center' : defaultAlign(column),
      wrap: Boolean(column.wrap)
    });
  };
  const totalStyles = columns.map(column => styles.xf({
    font: { bold: true, color: PALETTE.brandDark }, fill: PALETTE.brandSoft, numFmt: column.totalNumFmt || defaultNumFmt(column),
    h: defaultAlign(column),
    border: { top: { style: 'medium', color: PALETTE.brandHeader }, bottom: { style: 'thin', color: PALETTE.brandHeader } }
  }));

  const rowXml = [];
  const merges = [];
  const rowHeights = new Map();
  let rowNumber = 0;
  const widths = columns.map(column => Math.max(8, Math.min(48, String(column.header).split('\n')
    .reduce((max, line) => Math.max(max, line.length), 0) + 2)));

  const pushRow = (cells, height) => {
    rowNumber += 1;
    if (height) rowHeights.set(rowNumber, height);
    const ht = height ? ` ht="${height}" customHeight="1"` : '';
    rowXml.push(`<row r="${rowNumber}"${ht}>${cells.join('')}</row>`);
    return rowNumber;
  };
  const stringCell = (col, row, text, style) => `<c r="${cellRef(col, row)}" s="${style}" t="s"><v>${strings.add(text)}</v></c>`;
  const blankCells = (row, style, from = 0) => columns.slice(from).map((_, offset) => `<c r="${cellRef(from + offset, row)}" s="${style}"/>`);
  const bandRow = (text, style, height) => {
    const row = rowNumber + 1;
    const cells = [text === null ? `<c r="${cellRef(0, row)}" s="${style}"/>` : stringCell(0, row, text, style), ...blankCells(row, style, 1)];
    pushRow(cells, height);
    if (lastCol > 0) merges.push(`A${row}:${lastLetter}${row}`);
  };

  // 1. Faixa de título + subtítulo + filete.
  bandRow(sheet.title || sheet.name || 'Exportação', s.title, 30);
  bandRow(['FILTROVALI', sheet.subtitle].filter(Boolean).join('  ·  '), s.subtitle, 18);
  bandRow(null, s.accent, 3);

  // 2. Contexto da exportação.
  const metaLines = [...(sheet.meta || [])].filter(entry => entry && entry[1] !== undefined && entry[1] !== null && entry[1] !== '');
  metaLines.push(['Gerado em', formatGeneratedAt(generatedAt, timeZone)]);
  metaLines.push(['Registros', String(sheet.recordCount ?? rows.length)]);
  pushRow([], 6);
  for (const [label, value] of metaLines) {
    const row = rowNumber + 1;
    const index = strings.addRich([
      { text: `${label}: `, bold: true, color: PALETTE.brand },
      { text: String(value), color: PALETTE.muted }
    ]);
    pushRow([`<c r="A${row}" s="${s.meta}" t="s"><v>${index}</v></c>`], 15);
    if (lastCol > 0) merges.push(`A${row}:${lastLetter}${row}`);
  }
  pushRow([], 8);

  // 3. Cabeçalho.
  const headerRow = pushRow(columns.map((column, col) => stringCell(col, rowNumber + 1, column.header, headerStyles[col])), 30);

  // 4. Dados.
  const firstDataRow = headerRow + 1;
  const sums = columns.map(() => ({ sum: 0, count: 0 }));
  rows.forEach((values, rowIndex) => {
    const row = rowNumber + 1;
    const zebra = rowIndex % 2 === 1;
    const cells = columns.map((column, col) => {
      const raw = Array.isArray(values) ? values[col] : undefined;
      const cell = coerceCell(raw, column, timeZone);
      const tone = normalizeTone(typeof column.tone === 'function' ? column.tone(raw, values, rowIndex) : null);
      const style = dataStyle(column, zebra, tone);
      widths[col] = Math.max(widths[col], Math.min(60, displayLength(cell, column) + 2 + (tone ? 2 : 0)));
      const ref = cellRef(col, row);
      if (cell.kind === 'empty') return `<c r="${ref}" s="${style}"/>`;
      if (cell.kind === 'number') {
        sums[col].sum += cell.value;
        sums[col].count += 1;
        return `<c r="${ref}" s="${style}"><v>${cell.value}</v></c>`;
      }
      sums[col].count += 1;
      return `<c r="${ref}" s="${style}" t="s"><v>${strings.add(cell.value)}</v></c>`;
    });
    pushRow(cells, null);
  });
  const lastDataRow = rows.length ? rowNumber : headerRow;

  if (!rows.length) {
    bandRow(sheet.emptyMessage || 'Nenhum registro para os filtros selecionados.', s.empty, 24);
  }

  // 5. Totais (SUBTOTAL ignora linhas ocultas pelo autofiltro).
  const hasTotals = rows.length > 0 && columns.some(column => column.total);
  if (hasTotals) {
    const row = rowNumber + 1;
    const range = col => `${columnLetter(col)}${firstDataRow}:${columnLetter(col)}${lastDataRow}`;
    const cells = columns.map((column, col) => {
      const ref = cellRef(col, row);
      if (column.total === 'sum') {
        return `<c r="${ref}" s="${totalStyles[col]}"><f>SUBTOTAL(109,${range(col)})</f><v>${sums[col].sum}</v></c>`;
      }
      if (column.total === 'avg') {
        const avg = sums[col].count ? sums[col].sum / sums[col].count : 0;
        return `<c r="${ref}" s="${totalStyles[col]}"><f>IFERROR(SUBTOTAL(101,${range(col)}),0)</f><v>${avg}</v></c>`;
      }
      if (column.total === 'count') {
        return `<c r="${ref}" s="${totalStyles[col]}"><f>SUBTOTAL(103,${range(col)})</f><v>${sums[col].count}</v></c>`;
      }
      if (col === 0) return stringCell(col, row, sheet.totalsLabel || 'Total', s.totalLabel);
      return `<c r="${ref}" s="${totalStyles[col]}"/>`;
    });
    pushRow(cells, 20);
  }

  // Larguras: explícitas vencem; título longo não alarga a primeira coluna.
  const cols = columns.map((column, col) => {
    const width = column.width || widths[col];
    return `<col min="${col + 1}" max="${col + 1}" width="${width}" customWidth="1"/>`;
  }).join('');

  const dimension = `A1:${lastLetter}${Math.max(rowNumber, 1)}`;
  const freeze = `<pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/>`
    + `<selection pane="bottomLeft" activeCell="A${headerRow + 1}" sqref="A${headerRow + 1}"/>`;
  const autoFilter = rows.length ? `<autoFilter ref="A${headerRow}:${lastLetter}${lastDataRow}"/>` : '';
  const mergeXml = merges.length ? `<mergeCells count="${merges.length}">${merges.map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>` : '';
  const title = escapeXml(String(sheet.title || sheet.name || '').replace(/&/g, '&&'));

  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
    + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<sheetPr><tabColor rgb="FF30503A"/><pageSetUpPr fitToPage="1"/></sheetPr>'
    + `<dimension ref="${dimension}"/>`
    + `<sheetViews><sheetView showGridLines="0" workbookViewId="0"${ctx.sheetIndex === 0 ? ' tabSelected="1"' : ''}>${freeze}</sheetView></sheetViews>`
    + '<sheetFormatPr defaultRowHeight="16.5" customHeight="1"/>'
    + `<cols>${cols}</cols>`
    + `<sheetData>${rowXml.join('')}</sheetData>`
    + autoFilter
    + mergeXml
    + '<pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>'
    + '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>'
    + '<headerFooter>'
    + `<oddHeader>&amp;L&amp;"${FONT_NAME},Bold"&amp;9&amp;K30503AFILTROVALI&amp;R&amp;"${FONT_NAME},Regular"&amp;9&amp;K596273${title}</oddHeader>`
    + `<oddFooter>&amp;L&amp;"${FONT_NAME},Regular"&amp;8&amp;K596273Gerado em ${escapeXml(formatGeneratedAt(generatedAt, timeZone))}&amp;R&amp;"${FONT_NAME},Regular"&amp;8&amp;K596273Página &amp;P de &amp;N</oddFooter>`
    + '</headerFooter>'
    + '</worksheet>';

  return {
    xml,
    printTitles: `$${headerRow}:$${headerRow}`,
    filterRange: rows.length ? `$A$${headerRow}:$${lastLetter}$${lastDataRow}` : null
  };
}

// ─── Workbook ───────────────────────────────────────────────────────────────

function uniqueSheetNames(sheets) {
  const used = new Set();
  return sheets.map((sheet, index) => {
    const base = sanitizeSheetName(sheet.name || sheet.title, `Planilha ${index + 1}`);
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n += 1) {
      const suffix = ` (${n})`;
      name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

function quoteSheetName(name) {
  return `'${name.replace(/'/g, "''")}'`;
}

/**
 * Monta os arquivos (caminho → conteúdo XML) do pacote XLSX.
 * @returns {Array<{ name: string, data: Uint8Array }>}
 */
export function buildXlsxFiles(spec) {
  const sheets = spec?.sheets || [];
  if (!sheets.length) throw new Error('A planilha precisa de ao menos uma aba.');
  const timeZone = spec.timeZone || DEFAULT_TIME_ZONE;
  const generatedAt = spec.generatedAt ? new Date(spec.generatedAt) : new Date();
  const styles = new StyleRegistry();
  const strings = new SharedStrings();
  const names = uniqueSheetNames(sheets);
  const built = sheets.map((sheet, sheetIndex) => buildSheet(sheet, { styles, strings, timeZone, generatedAt, sheetIndex }));
  const encoder = new TextEncoder();
  const title = spec.title || sheets[0].title || names[0];
  const isoNow = generatedAt.toISOString().replace(/\.\d{3}Z$/, 'Z');

  const definedNames = built.flatMap((sheet, index) => {
    const ref = quoteSheetName(names[index]);
    const items = [`<definedName name="_xlnm.Print_Titles" localSheetId="${index}">${escapeXml(`${ref}!${sheet.printTitles}`)}</definedName>`];
    if (sheet.filterRange) {
      items.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${index}" hidden="1">${escapeXml(`${ref}!${sheet.filterRange}`)}</definedName>`);
    }
    return items;
  });

  const files = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + built.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
      + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
      + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
      + '</Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
      + '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
      + '</Relationships>'],
    ['docProps/core.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
      + 'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" '
      + 'xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
      + `<dc:title>${escapeXml(title)}</dc:title><dc:creator>Filtrovali</dc:creator><cp:lastModifiedBy>Filtrovali</cp:lastModifiedBy>`
      + `<dcterms:created xsi:type="dcterms:W3CDTF">${isoNow}</dcterms:created>`
      + `<dcterms:modified xsi:type="dcterms:W3CDTF">${isoNow}</dcterms:modified>`
      + '</cp:coreProperties>'],
    ['docProps/app.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" '
      + 'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
      + '<Application>Filtrovali</Application><Company>Filtrovali</Company>'
      + '</Properties>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
      + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<bookViews><workbookView activeTab="0"/></bookViews>'
      + `<sheets>${names.map((name, index) => `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets>`
      + `<definedNames>${definedNames.join('')}</definedNames>`
      + '<calcPr calcId="191029" fullCalcOnLoad="1"/>'
      + '</workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + built.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${built.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
      + `<Relationship Id="rId${built.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>`
      + '</Relationships>'],
    ...built.map((sheet, index) => [`xl/worksheets/sheet${index + 1}.xml`, sheet.xml]),
    ['xl/styles.xml', styles.toXml()],
    ['xl/sharedStrings.xml', strings.toXml()]
  ];

  return { files: files.map(([name, xml]) => ({ name, data: encoder.encode(xml) })), generatedAt };
}

// ─── ZIP (store/deflate) ────────────────────────────────────────────────────

let crcTable = null;
function crc32(data) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i += 1) crc = crcTable[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

/**
 * Empacota arquivos em ZIP. `compressed[i]`, quando presente, é o conteúdo já em
 * deflate-raw do arquivo i (método 8); senão o arquivo é armazenado (método 0).
 */
export function zipFiles(files, compressed = [], modifiedAt = new Date()) {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(modifiedAt);
  const locals = [];
  const centrals = [];
  let offset = 0;

  files.forEach((file, index) => {
    const nameBytes = encoder.encode(file.name);
    const packed = compressed[index] && compressed[index].length < file.data.length ? compressed[index] : null;
    const body = packed || file.data;
    const method = packed ? 8 : 0;
    const crc = crc32(file.data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034B50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, method, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, file.data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014B50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, file.data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);

    locals.push(local, body);
    centrals.push(central);
    offset += local.length + body.length;
  });

  const centralSize = centrals.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054B50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const parts = [...locals, ...centrals, end];
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let cursor = 0;
  for (const part of parts) {
    output.set(part, cursor);
    cursor += part.length;
  }
  return output;
}

/** Gera o .xlsx de forma síncrona (ex.: backend com zlib.deflateRawSync). */
export function buildXlsxWorkbook(spec, { deflateRaw } = {}) {
  const { files, generatedAt } = buildXlsxFiles(spec);
  const compressed = deflateRaw ? files.map(file => deflateRaw(file.data)) : [];
  return zipFiles(files, compressed, generatedAt);
}

/** Gera o .xlsx com compressão assíncrona (ex.: CompressionStream no navegador). */
export async function buildXlsxWorkbookAsync(spec, { deflateRaw } = {}) {
  const { files, generatedAt } = buildXlsxFiles(spec);
  const compressed = deflateRaw ? await Promise.all(files.map(file => deflateRaw(file.data))) : [];
  return zipFiles(files, compressed, generatedAt);
}
