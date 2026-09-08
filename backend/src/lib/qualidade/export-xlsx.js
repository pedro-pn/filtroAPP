import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import AdmZip from 'adm-zip';

import {
  QUALITY_DISPOSITION_OPTIONS,
  QUALITY_IMPACT_OPTIONS,
  QUALITY_STATUS_OPTIONS,
  QUALITY_TYPE_OPTIONS
} from '../../../../shared/schemas/qualidade.js';

const typeLabels = new Map(QUALITY_TYPE_OPTIONS.map(item => [item.value, item.label]));
const impactLabels = new Map(QUALITY_IMPACT_OPTIONS.map(item => [item.value, item.label]));
const dispositionLabels = new Map(QUALITY_DISPOSITION_OPTIONS.map(item => [item.value, item.label]));
const statusLabels = new Map(QUALITY_STATUS_OPTIONS.map(item => [item.value, item.label]));

const TEMPLATE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../Modelos/definitivos/qualidade/FR-3-4-11-01_1.xlsx'
);
const REGISTRO_SHEET_PATH = 'xl/worksheets/sheet1.xml';
const WORKBOOK_RELS_PATH = 'xl/_rels/workbook.xml.rels';
const CONTENT_TYPES_PATH = '[Content_Types].xml';
const CALC_CHAIN_PATH = 'xl/calcChain.xml';
const HEADER_LAST_ROW = 3;
const DATA_START_ROW = 4;
const LAST_COLUMN = 'S';
const DATA_ROW_HEIGHT = 'ht="57.75" customHeight="1" x14ac:dyDescent="0.25"';
const DATA_COLUMN_STYLES = [2, 3, 2, 4, 4, 3, 4, 4, 2, 5, 5, 2, 4, 4, 4, 3, 4, 4, 2];
const DATE_COLUMN_INDEXES = new Set([1, 5, 15]);
const NUMBER_COLUMN_INDEXES = new Set([9]);

export const QUALITY_EXPORT_HEADERS = [
  'Nº Registro',
  'Data do Registro',
  'Tipo',
  'Origem',
  'Obra / Projeto',
  'Data do Evento',
  'Natureza (categoria)',
  'Descrição do evento',
  'Impacto',
  'Ocorrências 12m\n(automático)',
  'Recorrente?\n(automático)',
  'RNC vinculada',
  'Disposição',
  'Ação definida',
  'Responsável\npela ação',
  'Prazo da ação',
  'Evidência\n(link/anexo)',
  'Verificação do resultado',
  'Status'
];

function xml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function excelDateSerial(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split('-').map(Number);
  const date = Date.UTC(year, month - 1, day);
  if (!Number.isFinite(date)) return null;
  return Math.round((date - Date.UTC(1899, 11, 30)) / 86400000);
}

function projectLabel(record) {
  if (!record.project) return 'Interno/SGQ';
  return [record.project.code, record.project.name].filter(Boolean).join(' - ');
}

function isHttpUrl(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  try {
    const url = new URL(text);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function evidenceLabel(record) {
  const items = Array.isArray(record.evidences) ? record.evidences : [];
  if (!items.length) return isHttpUrl(record.evidence) ? record.evidence : '';
  return items.map(item => {
    if (item.kind === 'LINK') return isHttpUrl(item.url) ? item.url : '';
    return item.publicUrl || item.fileName || '';
  }).filter(Boolean).join('\n');
}

function recordRow(record) {
  return [
    record.number,
    record.registeredAt,
    typeLabels.get(record.type) || record.type,
    record.origin || '',
    projectLabel(record),
    record.eventDate,
    record.nature?.name || '',
    record.description || '',
    impactLabels.get(record.impact) || record.impact || '',
    record.occurrences12m,
    record.recurrent ? 'SIM' : 'não',
    record.linkedRnc || '-',
    dispositionLabels.get(record.disposition) || record.disposition || '',
    record.definedAction || '',
    record.actionOwner || '',
    record.actionDeadline,
    evidenceLabel(record),
    record.resultVerification || '',
    statusLabels.get(record.status) || record.status || ''
  ];
}

function columnName(index) {
  let name = '';
  let current = index + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}

function cellXml(value, colIndex, rowNumber) {
  const style = DATA_COLUMN_STYLES[colIndex];
  const ref = `${columnName(colIndex)}${rowNumber}`;
  if (value === null || value === undefined || value === '') return `<c r="${ref}" s="${style}"/>`;

  if (DATE_COLUMN_INDEXES.has(colIndex)) {
    const serial = excelDateSerial(value);
    if (serial !== null) return `<c r="${ref}" s="${style}"><v>${serial}</v></c>`;
  }

  if (NUMBER_COLUMN_INDEXES.has(colIndex) && Number.isFinite(Number(value))) {
    return `<c r="${ref}" s="${style}"><v>${Number(value)}</v></c>`;
  }

  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
}

function dataRowXml(values, rowNumber) {
  const cells = values.map((value, colIndex) => cellXml(value, colIndex, rowNumber)).join('');
  return `<row r="${rowNumber}" spans="1:19" ${DATA_ROW_HEIGHT}>${cells}</row>`;
}

function extractTemplateHeaderRows(sheetXml) {
  return Array.from({ length: HEADER_LAST_ROW }, (_, index) => {
    const rowNumber = index + 1;
    const match = sheetXml.match(new RegExp(`<row\\b[^>]*r="${rowNumber}"[\\s\\S]*?</row>`));
    if (!match) throw new Error(`Linha ${rowNumber} não encontrada no modelo FR-3-4-11-01_1.xlsx.`);
    return match[0];
  });
}

function replaceZipText(zip, entryName, text) {
  zip.deleteFile(entryName);
  zip.addFile(entryName, Buffer.from(text, 'utf8'));
}

function removeCalcChain(zip) {
  zip.deleteFile(CALC_CHAIN_PATH);

  const rels = zip.readAsText(WORKBOOK_RELS_PATH)
    .replace(/<Relationship\b[^>]*Target="calcChain\.xml"[^>]*\/>/, '');
  replaceZipText(zip, WORKBOOK_RELS_PATH, rels);

  const contentTypes = zip.readAsText(CONTENT_TYPES_PATH)
    .replace(/<Override\b[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/, '');
  replaceZipText(zip, CONTENT_TYPES_PATH, contentTypes);
}

function updateDataValidationRanges(sheetXml, maxRow) {
  if (maxRow < DATA_START_ROW) {
    return sheetXml.replace(/<dataValidations\b[\s\S]*?<\/dataValidations>/, '');
  }
  return sheetXml
    .replace(/sqref="C4:C\d+"/g, `sqref="C4:C${maxRow}"`)
    .replace(/sqref="I4:I\d+"/g, `sqref="I4:I${maxRow}"`)
    .replace(/sqref="M4:M\d+"/g, `sqref="M4:M${maxRow}"`)
    .replace(/sqref="S4:S\d+"/g, `sqref="S4:S${maxRow}"`);
}

function worksheetXmlFromTemplate(sheetXml, records) {
  const headerRows = extractTemplateHeaderRows(sheetXml);
  const dataRows = (records || []).map((record, index) => dataRowXml(recordRow(record), DATA_START_ROW + index));
  const maxRow = HEADER_LAST_ROW + dataRows.length;
  const sheetData = `<sheetData>${[...headerRows, ...dataRows].join('')}</sheetData>`;

  return updateDataValidationRanges(sheetXml, maxRow)
    .replace(/<dimension\b[^>]*\/>/, `<dimension ref="A1:${LAST_COLUMN}${maxRow}"/>`)
    .replace(/<sheetData>[\s\S]*?<\/sheetData>/, sheetData);
}

export function buildQualityRecordsXlsx(records) {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(`Modelo de exportação não encontrado: ${TEMPLATE_PATH}`);
  }
  const zip = new AdmZip(fs.readFileSync(TEMPLATE_PATH));
  const sheetXml = zip.readAsText(REGISTRO_SHEET_PATH);

  replaceZipText(zip, REGISTRO_SHEET_PATH, worksheetXmlFromTemplate(sheetXml, records || []));
  removeCalcChain(zip);

  return zip.toBuffer();
}
