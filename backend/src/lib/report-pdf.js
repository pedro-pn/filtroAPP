import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { formatCnpj } from './cnpj.js';
import { buildReportCollaboratorRows } from './report-collaborators.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logoPath = path.resolve(__dirname, '../../assets/Logo/LOGO_COLORIDO.png');

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = { left: 28, right: 28, top: 28, bottom: 24 };
const COLORS = {
  green: rgb(0x30 / 255, 0x50 / 255, 0x3a / 255),
  blue: rgb(0x11 / 255, 0x43 / 255, 0x7e / 255),
  light: rgb(0xe8 / 255, 0xe8 / 255, 0xe8 / 255),
  gray: rgb(0x9b / 255, 0x93 / 255, 0xa8 / 255),
  border: rgb(0.18, 0.18, 0.18),
  white: rgb(1, 1, 1),
  black: rgb(0, 0, 0)
};

const SERVICE_NAMES = {
  limpeza: 'Limpeza química',
  pressao: 'Teste de pressão',
  filtragem: 'Filtragem',
  flushing: 'Flushing',
  mecanica: 'Limpeza mecânica',
  inibicao: 'Flushing/Inibição'
};

function normalizeLabel(value) {
  const map = {
    'Material da tubulaÃ§Ã£o': 'Material da tubulação',
    'Material da tubulaÃƒÂ§ÃƒÂ£o': 'Material da tubulação',
    'Hora de inÃ­cio': 'Hora de início',
    'Hora de tÃ©rmino/pausa': 'Hora de término/pausa',
    'Houve contagem de partÃ­culas?': 'Houve contagem de partículas?',
    'Houve desidrataÃ§Ã£o?': 'Houve desidratação?',
    'Houve anÃ¡lise de umidade?': 'Houve análise de umidade?',
    'Equipamento de desidrataÃ§Ã£o': 'Equipamento de desidratação',
    'Unidade de Limpeza QuÃ­mica': 'Unidade de Limpeza Química',
    'Unidade de Teste HidrostÃ¡tico (UTH)': 'Unidade de Teste Hidrostático (UTH)',
    'ManÃ´metros utilizados': 'Manômetros utilizados',
    'ObservaÃ§Ãµes': 'Observações',
    'Colaboradores do serviÃ§o': 'Colaboradores do serviço',
    'ServiÃ§o finalizado?': 'Serviço finalizado?',
    'Tipo de Ã³leo': 'Tipo de óleo',
    'Volume de Ã³leo': 'Volume de óleo',
    'PressÃ£o de trabalho': 'Pressão de trabalho',
    'PressÃ£o de teste': 'Pressão de teste',
    'ExecuÃ§Ã£o do teste': 'Execução do teste',
    'RealizaÃ§Ã£o do flushing': 'Realização do flushing',
    'RealizaÃ§Ã£o da filtragem': 'Realização da filtragem',
    'DesidrataÃ§Ã£o com centrÃ­fuga': 'Desidratação com centrífuga',
    'DesidrataÃ§Ã£o com termovÃ¡cuo': 'Desidratação com termovácuo',
    'InspeÃ§Ã£o inicial': 'Inspeção inicial',
    'InspeÃ§Ã£o final': 'Inspeção final',
    'CirculaÃ§Ã£o do inibidor': 'Circulação do inibidor'
  };
  return map[value] || value;
}

function valueIsEmpty(value) {
  if (value == null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0 || value.every(valueIsEmpty);
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

function formatDatePt(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('pt-BR');
}

function formatMinutes(total) {
  const safe = Math.max(0, Number(total) || 0);
  const h = String(Math.floor(safe / 60)).padStart(2, '0');
  const m = String(safe % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function reportLabel(report) {
  const number = typeof report.sequenceNumber === 'number'
    ? String(report.sequenceNumber)
    : '---';
  return `${report.reportType} ${number}`;
}

function yesNo(value) {
  if (value === true) return 'Sim';
  if (value === false) return 'Não';
  return '—';
}

function emptyLookups() {
  return {
    counters: new Map(),
    manometers: new Map(),
    units: new Map()
  };
}

export function stringifyValue(key, value, lookups = emptyLookups()) {
  if (valueIsEmpty(value)) return '';
  const label = normalizeLabel(key);

  if (Array.isArray(value)) {
    return value.map(item => stringifyValue(label, item, lookups)).filter(Boolean).join(', ');
  }

  if (typeof value === 'object') {
    if (value.fileName) return value.fileName;
    for (const objectKey of ['names', 'codes', 'labels', 'ids']) {
      if (Array.isArray(value[objectKey])) {
        return value[objectKey].map(item => stringifyValue(label, item, lookups)).filter(Boolean).join(', ');
      }
    }
    if (value.name && value.role) return `${value.name} - ${value.role}`;
    if (value.name) return String(value.name);
    if (value.code) return String(value.code);
    return '';
  }

  if (label === 'Contador utilizado') {
    const counter = lookups.counters.get(value);
    return counter ? `${counter.code} - ${counter.serialNumber}` : String(value);
  }

  if (label === 'Manômetros utilizados') {
    const manometer = lookups.manometers.get(value);
    return manometer ? manometer.code : String(value);
  }

  if ([
    'Unidade de filtragem',
    'Unidade de Flushing',
    'Unidade de Limpeza Química',
    'Equipamento de desidratação',
    'Unidade de Teste Hidrostático (UTH)'
  ].includes(label)) {
    const unit = lookups.units.get(value);
    return unit ? unit.code : String(value);
  }

  if (typeof value === 'boolean') return yesNo(value);
  return String(value);
}

function particleAnalysisText(fields, stage, lookups) {
  const nas = stringifyValue(`Contagem ${stage} NAS`, getField(fields, [`Contagem ${stage} NAS`]), lookups);
  const iso = stringifyValue(`Contagem ${stage} ISO`, getField(fields, [`Contagem ${stage} ISO`]), lookups);
  const combined = [
    nas ? `NAS ${nas}` : '',
    iso ? `ISO ${iso}` : ''
  ].filter(Boolean).join(' | ');

  if (combined) return combined;

  return stringifyValue(
    `Contagem ${stage}`,
    getField(fields, stage === 'inicial'
      ? ['Contagem inicial', 'Classe ISO inicial', 'NAS inicial']
      : ['Contagem final', 'Classe ISO final', 'NAS final']),
    lookups
  );
}

function collectLookupIds(report) {
  const bag = { unitIds: [], counterIds: [], manometerIds: [] };
  for (const service of report.services || []) {
    const fields = service.extraData || {};
    for (const [rawKey, rawValue] of Object.entries(fields)) {
      const key = normalizeLabel(rawKey);
      const values = Array.isArray(rawValue) ? rawValue : [rawValue];
      if (key === 'Contador utilizado') bag.counterIds.push(...values.filter(Boolean));
      if (key === 'Manômetros utilizados') bag.manometerIds.push(...values.filter(Boolean));
      if ([
        'Unidade de filtragem',
        'Unidade de Flushing',
        'Unidade de Limpeza Química',
        'Equipamento de desidratação',
        'Unidade de Teste Hidrostático (UTH)'
      ].includes(key)) bag.unitIds.push(...values.filter(Boolean));
    }
  }
  return {
    unitIds: Array.from(new Set(bag.unitIds)),
    counterIds: Array.from(new Set(bag.counterIds)),
    manometerIds: Array.from(new Set(bag.manometerIds))
  };
}

function getField(fields, names) {
  for (const name of names) {
    if (fields[name] != null && fields[name] !== '') return fields[name];
    const foundKey = Object.keys(fields).find(key => normalizeLabel(key) === name);
    if (foundKey && fields[foundKey] != null && fields[foundKey] !== '') return fields[foundKey];
  }
  return '';
}

function getServiceSummary(service, lookups) {
  const fields = service.extraData || {};
  const type = service.serviceType;
  const common = {
    serviceName: SERVICE_NAMES[type] || type,
    equipment: stringifyValue('Equipamento', getField(fields, ['Equipamento']), lookups) || '—',
    system: stringifyValue('Sistema', getField(fields, ['Sistema']), lookups) || '—',
    startTime: stringifyValue('Hora de início', getField(fields, ['Hora de início']), lookups) || '—',
    endTime: stringifyValue('Hora de término/pausa', getField(fields, ['Hora de término/pausa']), lookups) || '—',
    status: service.finalized === true ? 'Finalizado' : (service.finalized === false ? 'Em andamento' : '—'),
    serviceCollaborators: stringifyValue('Colaboradores do serviço', getField(fields, ['Colaboradores do serviço']), lookups) || '—',
    steps: stringifyValue('Etapas realizadas no dia', getField(fields, ['Etapas realizadas no dia']), lookups) || '—',
    obs: stringifyValue('Observações', getField(fields, ['Observações', 'OBS.', 'Desenho/observações']), lookups) || ''
  };

  switch (type) {
    case 'pressao':
      return {
        ...common,
        statementOne: 'Pressão de trabalho',
        statementDataOne: stringifyValue('Pressão de trabalho', getField(fields, ['Pressão de trabalho']), lookups),
        statementTwo: 'Pressão de teste',
        statementDataTwo: stringifyValue('Pressão de teste', getField(fields, ['Pressão de teste']), lookups),
        infoStatement: 'Fluido',
        info: stringifyValue('Fluido de teste', getField(fields, ['Fluido de teste']), lookups)
      };
    case 'limpeza':
      return {
        ...common,
        statementOne: 'Material da tubulação',
        statementDataOne: stringifyValue('Material da tubulação', getField(fields, ['Material da tubulação']), lookups),
        statementTwo: '',
        statementDataTwo: '',
        infoStatement: '',
        info: ''
      };
    case 'flushing':
      return {
        ...common,
        statementOne: 'Análise inicial',
        statementDataOne: particleAnalysisText(fields, 'inicial', lookups),
        statementTwo: 'Análise final',
        statementDataTwo: particleAnalysisText(fields, 'final', lookups),
        infoStatement: 'Óleo',
        info: stringifyValue('Tipo de óleo', getField(fields, ['Tipo de óleo']), lookups)
      };
    case 'filtragem':
      return {
        ...common,
        statementOne: 'Análise inicial',
        statementDataOne: particleAnalysisText(fields, 'inicial', lookups),
        statementTwo: 'Análise final',
        statementDataTwo: particleAnalysisText(fields, 'final', lookups),
        infoStatement: 'Volume de óleo',
        info: stringifyValue('Volume de óleo', getField(fields, ['Volume de óleo']), lookups)
      };
    case 'mecanica':
      return {
        ...common,
        statementOne: 'Material do equipamento',
        statementDataOne: stringifyValue('Material do equipamento', getField(fields, ['Material do equipamento']), lookups),
        statementTwo: '',
        statementDataTwo: '',
        infoStatement: '',
        info: ''
      };
    case 'inibicao':
      return {
        ...common,
        serviceName: 'Flushing/Inibição',
        equipment: stringifyValue('Embarcação', getField(fields, ['ID da embarcação']), lookups) || '—',
        statementOne: 'Material da tubulação',
        statementDataOne: stringifyValue('Material da tubulação', getField(fields, ['Material da tubulação']), lookups),
        statementTwo: '',
        statementDataTwo: '',
        infoStatement: '',
        info: ''
      };
    default:
      return {
        ...common,
        statementOne: '',
        statementDataOne: '',
        statementTwo: '',
        statementDataTwo: '',
        infoStatement: '',
        info: ''
      };
  }
}

function wrapTextSegment(text, font, size, width) {
  const source = String(text || '').replace(/[^\S\r\n]+/g, ' ').trim();
  if (!source) return [''];
  const words = source.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const probe = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(probe, size) <= width) {
      current = probe;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

export function wrapPdfText(text, font, size, width) {
  const raw = String(text || '');
  if (!raw) return ['—'];
  const lines = raw
    .replace(/\r\n|\r/g, '\n')
    .split('\n')
    .flatMap(line => wrapTextSegment(line, font, size, width));
  return lines.some(line => line.trim()) ? lines : ['—'];
}

function splitPdfTextLines(text) {
  const raw = String(text || '');
  return raw ? raw.replace(/\r\n|\r/g, '\n').split('\n') : [''];
}

function wrapText(text, font, size, width) {
  return wrapPdfText(text, font, size, width);
}

async function loadImageBytes(src) {
  if (!src) return null;
  if (src.startsWith('data:')) {
    const base64 = src.split(',')[1] || '';
    return Buffer.from(base64, 'base64');
  }
  if (/^https?:\/\//i.test(src)) {
    const res = await fetch(src);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }
  try {
    return await fs.readFile(src);
  } catch {
    return null;
  }
}

export async function buildReportPdf(report, prisma) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const logoBytes = await fs.readFile(logoPath);
  const logo = await pdf.embedPng(logoBytes);

  const ids = collectLookupIds(report);
  const [units, counters, manometers] = await Promise.all([
    ids.unitIds.length ? prisma.unit.findMany({ where: { id: { in: ids.unitIds } } }) : [],
    ids.counterIds.length ? prisma.particleCounter.findMany({ where: { id: { in: ids.counterIds } } }) : [],
    ids.manometerIds.length ? prisma.manometer.findMany({ where: { id: { in: ids.manometerIds } } }) : []
  ]);

  const lookups = {
    units: new Map(units.map(item => [item.id, item])),
    counters: new Map(counters.map(item => [item.id, item])),
    manometers: new Map(manometers.map(item => [item.id, item]))
  };

  let page = pdf.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - MARGIN.top;

  function addPage() {
    page = pdf.addPage([PAGE.width, PAGE.height]);
    y = PAGE.height - MARGIN.top;
  }

  function ensureSpace(height) {
    if (y - height < MARGIN.bottom) addPage();
  }

  function drawRect(x, topY, width, height, options = {}) {
    page.drawRectangle({
      x,
      y: topY - height,
      width,
      height,
      color: options.fill || undefined,
      borderColor: options.border || COLORS.border,
      borderWidth: options.borderWidth == null ? 1 : options.borderWidth
    });
  }

  function drawText(text, x, topY, size, usedFont = font, color = COLORS.blue, maxWidth = null, lineGap = 2) {
    const lines = maxWidth ? wrapText(text, usedFont, size, maxWidth) : splitPdfTextLines(text);
    let cursor = topY - size;
    for (const line of lines) {
      page.drawText(line, { x, y: cursor, size, font: usedFont, color });
      cursor -= size + lineGap;
    }
    return lines.length * (size + lineGap);
  }

  function tableRow(cells, widths, topY, height, options = {}) {
    let x = MARGIN.left;
    cells.forEach((cell, index) => {
      drawRect(x, topY, widths[index], height, {
        fill: options.fill,
        border: options.border,
        borderWidth: options.borderWidth
      });
      const size = cell.size || 9;
      const usedFont = cell.bold ? bold : font;
      const color = cell.color || COLORS.blue;
      const innerX = x + 6;
      const innerW = widths[index] - 12;
      const lines = wrapText(cell.text || '', usedFont, size, innerW);
      let lineY = topY - 7;
      lines.forEach(line => {
        page.drawText(line, { x: innerX, y: lineY - size, size, font: usedFont, color });
        lineY -= size + 1;
      });
      x += widths[index];
    });
  }

  function drawHeader() {
    const logoScale = 0.05;
    const dims = logo.scale(logoScale);
    const bandHeight = 36;
    drawRect(MARGIN.left, y, PAGE.width - MARGIN.left - MARGIN.right, bandHeight, { fill: COLORS.green, border: COLORS.green });
    page.drawImage(logo, {
      x: MARGIN.left + 8,
      y: y - dims.height - 5,
      width: dims.width,
      height: dims.height
    });
    drawText('RELATÓRIO DIÁRIO DE OBRA', MARGIN.left + 118, y - 6, 13, bold, COLORS.light);
    drawText(reportLabel(report), PAGE.width - MARGIN.right - 90, y - 6, 13, bold, COLORS.light);
    y -= bandHeight + 6;

    const widths = [120, 167, 120, 132];
    tableRow([
      { text: 'Cliente', bold: true, color: COLORS.gray },
      { text: report.project.clientName || '—' },
      { text: 'Número do RDO', bold: true, color: COLORS.gray },
      { text: reportLabel(report) }
    ], widths, y, 22, { fill: COLORS.white });
    y -= 22;
    tableRow([
      { text: 'CNPJ', bold: true, color: COLORS.gray },
      { text: formatCnpj(report.project.clientCnpj) || '—' },
      { text: 'Data', bold: true, color: COLORS.gray },
      { text: formatDatePt(report.reportDate) }
    ], widths, y, 22, { fill: COLORS.white });
    y -= 22;
    tableRow([
      { text: 'Local', bold: true, color: COLORS.gray },
      { text: report.project.location || '—' },
      { text: 'Contrato', bold: true, color: COLORS.gray },
      { text: report.project.contractCode || '—' }
    ], widths, y, 22, { fill: COLORS.white });
    y -= 30;
  }

  function sectionBand(title) {
    ensureSpace(24);
    drawRect(MARGIN.left, y, PAGE.width - MARGIN.left - MARGIN.right, 24, { fill: COLORS.green, border: COLORS.border });
    drawText(title.toUpperCase(), MARGIN.left + 8, y - 4, 10, bold, COLORS.light);
    y -= 24;
  }

  function drawWorktimeSection() {
    const special = report.specialConditions || {};
    const night = special.noturnoDetails || {};
    const overtime = special.overtimeSummary || {};
    const overtimeRejected = special.overtimeAccepted === false;
    const widths = [132, 143, 132, 132];

    sectionBand('Jornada de trabalho');
    tableRow([
      { text: 'Turno Diurno', bold: true, color: COLORS.black },
      { text: '' },
      { text: 'Turno Noturno', bold: true, color: COLORS.black },
      { text: '' }
    ], widths, y, 22, { fill: COLORS.light });
    y -= 22;
    tableRow([
      { text: `Entrada: ${report.arrivalTime || '—'}` },
      { text: `Intervalo de almoço: ${report.lunchBreak || '—'}` },
      { text: `Entrada: ${night.inicio || '—'}` },
      { text: `Intervalo do jantar: ${night.intervalo || '—'}` }
    ], widths, y, 28, { fill: COLORS.white });
    y -= 28;
    tableRow([
      { text: `Saída: ${report.departureTime || '—'}` },
      { text: `Nº colaboradores: ${report.daytimeCount || (report.collaborators || []).length || 0}` },
      { text: `Saída: ${night.termino || '—'}` },
      { text: `Nº colaboradores: ${(night.colaboradores || []).length || 0}` }
    ], widths, y, 28, { fill: COLORS.white });
    y -= 28;
    tableRow([
      { text: overtimeRejected ? '' : `Horas extras (diurno): ${formatMinutes(report.daytimeOvertimeMinutes || overtime.daytimeOvertimeMinutes || 0)}` },
      { text: `Stand-by: ${(special.standbyDetails || {}).total || '—'}` },
      { text: overtimeRejected ? '' : `Horas extras (noturno): ${formatMinutes(report.nighttimeOvertimeMinutes || overtime.nighttimeOvertimeMinutes || 0)}` },
      { text: `Motivo stand-by: ${(special.standbyDetails || {}).motivo || '—'}` }
    ], widths, y, 28, { fill: COLORS.white });
    y -= 28;
    tableRow([
      { text: overtimeRejected ? '' : `Comentário hora extra: ${report.overtimeReason || '—'}`, color: COLORS.blue },
      { text: '', color: COLORS.blue },
      { text: '', color: COLORS.blue },
      { text: '', color: COLORS.blue }
    ], widths, y, 28, { fill: COLORS.white });
    y -= 34;
  }

  function drawCollaboratorsSection() {
    const rows = buildReportCollaboratorRows(report).map(row => ({
      name: row.collaboratorname || '—',
      role: row.collaboratorposition || '—',
      shift: row.collaboratorshift || '—'
    }));

    sectionBand('Colaboradores');
    const widths = [245, 190, 104];
    tableRow([
      { text: 'Nome', bold: true, color: COLORS.black },
      { text: 'Cargo', bold: true, color: COLORS.black },
      { text: 'Turno', bold: true, color: COLORS.black }
    ], widths, y, 22, { fill: COLORS.light });
    y -= 22;

    for (const row of rows.length ? rows : [{ name: '—', role: '—', shift: '—' }]) {
      ensureSpace(22);
      tableRow([
        { text: row.name },
        { text: row.role },
        { text: row.shift }
      ], widths, y, 22, { fill: COLORS.white });
      y -= 22;
    }
    y -= 8;
  }

  function serviceBoxHeight(summary) {
    const lines = [
      `${summary.statementOne ? `${summary.statementOne}: ${summary.statementDataOne || ''}` : ''}`,
      `${summary.statementTwo ? `${summary.statementTwo}: ${summary.statementDataTwo || ''}` : ''}`,
      `${summary.infoStatement ? `${summary.infoStatement}: ${summary.info || ''}` : ''}`,
      `Colaboradores: ${summary.serviceCollaborators || '—'}`,
      `Etapas: ${summary.steps || '—'}`,
      `OBS.: ${summary.obs || '—'}`
    ].filter(Boolean);
    let total = 26 + 20 + 6;
    total += 22;
    total += 22;
    total += lines.reduce((sum, line) => {
      const wrapped = wrapText(line, font, 9, PAGE.width - MARGIN.left - MARGIN.right - 24);
      return sum + Math.max(20, wrapped.length * 11 + 8);
    }, 0);
    return total + 8;
  }

  function drawServiceSection() {
    const widths = [130, 220, 110, 79];
    for (const [index, service] of (report.services || []).entries()) {
      const summary = getServiceSummary(service, lookups);
      const height = serviceBoxHeight(summary);
      ensureSpace(height + 8);

      drawRect(MARGIN.left, y, PAGE.width - MARGIN.left - MARGIN.right, 24, { fill: COLORS.green, border: COLORS.border });
      drawText(`SERVIÇO ${index + 1}`, MARGIN.left + 8, y - 4, 10, bold, COLORS.light);
      y -= 24;

      tableRow([
        { text: 'Serviço', bold: true, color: COLORS.gray },
        { text: summary.serviceName },
        { text: 'Status', bold: true, color: COLORS.gray },
        { text: summary.status }
      ], widths, y, 22, { fill: COLORS.white });
      y -= 22;
      tableRow([
        { text: 'Equipamento', bold: true, color: COLORS.gray },
        { text: summary.equipment },
        { text: 'Sistema', bold: true, color: COLORS.gray },
        { text: summary.system }
      ], widths, y, 22, { fill: COLORS.white });
      y -= 22;
      tableRow([
        { text: 'Hora de início', bold: true, color: COLORS.gray },
        { text: summary.startTime },
        { text: 'Hora de término', bold: true, color: COLORS.gray },
        { text: summary.endTime }
      ], widths, y, 22, { fill: COLORS.white });
      y -= 22;

      const fullWidth = [PAGE.width - MARGIN.left - MARGIN.right];
      const detailLines = [];
      if (summary.statementOne) detailLines.push(`${summary.statementOne}: ${summary.statementDataOne || ''}`);
      if (summary.statementTwo) detailLines.push(`${summary.statementTwo}: ${summary.statementDataTwo || ''}`);
      if (summary.infoStatement) detailLines.push(`${summary.infoStatement}: ${summary.info || ''}`);
      detailLines.push(`Colaboradores: ${summary.serviceCollaborators || '—'}`);
      detailLines.push(`Etapas: ${summary.steps || '—'}`);
      detailLines.push(`OBS.: ${summary.obs || '—'}`);

      for (const line of detailLines) {
        const wrapped = wrapText(line, font, 9, fullWidth[0] - 12);
        const rowHeight = Math.max(20, wrapped.length * 11 + 8);
        tableRow([{ text: line }], fullWidth, y, rowHeight, { fill: COLORS.white });
        y -= rowHeight;
      }
      y -= 8;
    }
  }

  async function drawSignatureSection() {
    ensureSpace(170);
    const leftWidth = 240;
    const rightWidth = PAGE.width - MARGIN.left - MARGIN.right - leftWidth - 18;
    const boxHeight = 150;

    drawRect(MARGIN.left, y, leftWidth, boxHeight, { fill: COLORS.white });
    drawRect(MARGIN.left + leftWidth + 18, y, rightWidth, boxHeight, { fill: COLORS.white });

    drawText('ASSINATURAS', MARGIN.left + 8, y - 8, 11, bold, COLORS.black);
    drawText('Cliente', MARGIN.left + leftWidth + 26, y - 8, 11, bold, COLORS.black);

    const leader = report.specialConditions?.__leaderSnapshot || report.project?.operator || {};
    const signatureSource = leader.signatureImage || null;
    const signatureBytes = await loadImageBytes(signatureSource);
    if (signatureBytes) {
      try {
        const image = signatureSource && signatureSource.toLowerCase().includes('png')
          ? await pdf.embedPng(signatureBytes)
          : await pdf.embedJpg(signatureBytes);
        const maxWidth = leftWidth - 30;
        const maxHeight = 60;
        const ratio = Math.min(maxWidth / image.width, maxHeight / image.height);
        const drawWidth = image.width * ratio;
        const drawHeight = image.height * ratio;
        page.drawImage(image, {
          x: MARGIN.left + 12,
          y: y - 80,
          width: drawWidth,
          height: drawHeight
        });
      } catch {}
    }

    page.drawLine({
      start: { x: MARGIN.left + 12, y: y - 94 },
      end: { x: MARGIN.left + leftWidth - 12, y: y - 94 },
      thickness: 1,
      color: COLORS.black
    });
    page.drawLine({
      start: { x: MARGIN.left + leftWidth + 30, y: y - 94 },
      end: { x: PAGE.width - MARGIN.right - 12, y: y - 94 },
      thickness: 1,
      color: COLORS.black
    });

    drawText(`Líder: ${leader.name || '—'}`, MARGIN.left + 12, y - 102, 10, bold, COLORS.blue);
    drawText(`Cargo: ${leader.role || '—'}`, MARGIN.left + 12, y - 118, 10, bold, COLORS.blue);
    drawText('Cliente:', MARGIN.left + leftWidth + 30, y - 102, 10, bold, COLORS.black);
    drawText('Cargo:', MARGIN.left + leftWidth + 30, y - 118, 10, bold, COLORS.black);
    y -= boxHeight + 6;
  }

  drawHeader();
  drawWorktimeSection();
  drawCollaboratorsSection();
  drawServiceSection();
  await drawSignatureSection();

  const pageCount = pdf.getPageCount();
  for (let i = 0; i < pageCount; i += 1) {
    const currentPage = pdf.getPage(i);
    currentPage.drawText(`Página ${i + 1} de ${pageCount}`, {
      x: PAGE.width - MARGIN.right - 62,
      y: 12,
      size: 8,
      font,
      color: COLORS.gray
    });
  }

  return pdf.save();
}
