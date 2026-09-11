#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DOMParser } from '@xmldom/xmldom';
import AdmZip from 'adm-zip';

const __filename = fileURLToPath(import.meta.url);
const DEFAULT_SPREADSHEET_ID = '14-xyYoJOGmdccRliNykCFdxAkKUhYx_K_iy0QkeoiY0';
const DEFAULT_GID = '2111631473';
const DEFAULT_SHEET_NAME = 'Histórico de manutenções';
const DEFAULT_OUTPUT = path.resolve(
  path.dirname(__filename),
  'data/legacy-maintenance-history.json'
);

function usage() {
  return [
    'Uso:',
    '  node scripts/extract-legacy-maintenance-history.js --input <arquivo.xlsx>',
    '',
    'Opções:',
    `  --output <arquivo.json>       Padrão: ${DEFAULT_OUTPUT}`,
    `  --sheet <nome>                Padrão: ${DEFAULT_SHEET_NAME}`,
    `  --spreadsheet-id <id>         Padrão: ${DEFAULT_SPREADSHEET_ID}`,
    `  --gid <gid>                   Padrão: ${DEFAULT_GID}`,
    '  --source-url <url>            Sobrescreve a URL registrada no JSON'
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    input: '',
    output: DEFAULT_OUTPUT,
    sheetName: DEFAULT_SHEET_NAME,
    spreadsheetId: DEFAULT_SPREADSHEET_ID,
    gid: DEFAULT_GID,
    sourceUrl: '',
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    const value = argv[index + 1];
    if (!arg.startsWith('--') || value == null || value.startsWith('--')) {
      throw new Error(`Argumento inválido: ${arg}`);
    }
    index += 1;
    switch (arg.slice(2)) {
      case 'input':
        options.input = value;
        break;
      case 'output':
        options.output = value;
        break;
      case 'sheet':
        options.sheetName = value;
        break;
      case 'spreadsheet-id':
        options.spreadsheetId = value;
        break;
      case 'gid':
        options.gid = value;
        break;
      case 'source-url':
        options.sourceUrl = value;
        break;
      default:
        throw new Error(`Opção desconhecida: ${arg}`);
    }
  }

  if (!options.help && !options.input) {
    throw new Error('Informe o XLSX com --input.');
  }
  return options;
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function xmlText(node) {
  if (!node) return '';
  let output = '';
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 3 || child.nodeType === 4) output += child.nodeValue;
    else output += xmlText(child);
  }
  return output;
}

function parseXml(xml) {
  return new DOMParser().parseFromString(xml, 'application/xml');
}

function columnLetters(cellRef) {
  return String(cellRef || '').match(/[A-Z]+/)?.[0] || '';
}

function sharedStrings(zip) {
  const entry = zip.getEntry('xl/sharedStrings.xml');
  if (!entry) return [];
  const document = parseXml(entry.getData().toString('utf8'));
  return Array.from(document.getElementsByTagName('si')).map(xmlText);
}

function workbookSheets(zip) {
  const workbook = parseXml(
    zip.getEntry('xl/workbook.xml').getData().toString('utf8')
  );
  const relationships = parseXml(
    zip.getEntry('xl/_rels/workbook.xml.rels').getData().toString('utf8')
  );
  const targets = new Map(
    Array.from(relationships.getElementsByTagName('Relationship')).map(
      (relationship) => [
        relationship.getAttribute('Id'),
        relationship.getAttribute('Target')
      ]
    )
  );

  return Array.from(workbook.getElementsByTagName('sheet')).map((sheet) => {
    const target = targets.get(sheet.getAttribute('r:id')) || '';
    return {
      name: sheet.getAttribute('name') || '',
      path: target.startsWith('xl/') ? target : `xl/${target}`
    };
  });
}

function sheetRows(zip, sheetPath, strings) {
  const document = parseXml(zip.getEntry(sheetPath).getData().toString('utf8'));
  const rows = [];
  for (const row of Array.from(document.getElementsByTagName('row'))) {
    const rowNumber = Number(row.getAttribute('r'));
    const cells = new Map();
    for (const cell of Array.from(row.getElementsByTagName('c'))) {
      const column = columnLetters(cell.getAttribute('r'));
      const type = cell.getAttribute('t');
      const raw = type === 'inlineStr'
        ? xmlText(cell)
        : xmlText(cell.getElementsByTagName('v')[0]);
      const value = type === 's' ? strings[Number(raw)] ?? raw : raw;
      const formula = xmlText(cell.getElementsByTagName('f')[0]);
      cells.set(column, {
        value: String(value || '').trim(),
        formula: String(formula || '').trim()
      });
    }
    rows.push({ rowNumber, cells });
  }
  return rows;
}

function excelSerialToDateKey(value) {
  const serial = Number(value);
  if (!Number.isFinite(serial)) return '';
  const milliseconds = Math.round((serial - 25569) * 86400 * 1000);
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function extractHyperlink(formula) {
  const match = String(formula || '').match(/^HYPERLINK\("([^"]+)"/i);
  return match?.[1] || '';
}

function driveFileId(value) {
  const text = String(value || '').trim();
  return (
    text.match(/\/file\/d\/([^/?#]+)/i)?.[1]
    || text.match(/[?&]id=([^&#]+)/i)?.[1]
    || (/^[A-Za-z0-9_-]{15,}$/.test(text) ? text : '')
  );
}

function splitServices(value) {
  return String(value || '')
    .split(/\s*,\s*/)
    .map((label) => label.trim())
    .filter(Boolean)
    .map((label, index) => ({ label, order: index + 1 }));
}

function parseThirdPartyServices(value, rowNumber) {
  const lines = String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line, index) => {
    const match = line.match(
      /^(\d{4}-\d{2}-\d{2})\s+-\s+(.+?)\s+-\s+(.+)$/
    );
    if (!match) {
      throw new Error(
        `Serviço de terceiros inválido na linha ${rowNumber}: ${line}`
      );
    }
    return {
      serviceDate: match[1],
      location: match[2].trim(),
      description: match[3].trim(),
      order: index + 1
    };
  });
}

function assertHeaders(row) {
  const expected = new Map([
    ['A', 'data'],
    ['B', 'colaborador'],
    ['C', 'equipamento tag'],
    ['D', 'itens verificados'],
    ['E', 'registro'],
    ['F', 'fotos'],
    ['G', 'servicos de terceiros'],
    ['H', 'observacoes']
  ]);
  for (const [column, label] of expected) {
    const actual = normalizeText(row.cells.get(column)?.value);
    if (actual !== label) {
      throw new Error(
        `Cabeçalho inesperado em ${column}${row.rowNumber}: "${actual}"; esperado "${label}".`
      );
    }
  }
}

function sourceUrl(options) {
  return options.sourceUrl || (
    `https://docs.google.com/spreadsheets/d/${options.spreadsheetId}`
    + `/edit?gid=${options.gid}#gid=${options.gid}`
  );
}

function extractLegacyMaintenanceHistory(filePath, options = {}) {
  const spreadsheetId = options.spreadsheetId || DEFAULT_SPREADSHEET_ID;
  const gid = options.gid || DEFAULT_GID;
  const sheetName = options.sheetName || DEFAULT_SHEET_NAME;
  const zip = new AdmZip(filePath);
  const strings = sharedStrings(zip);
  const sheet = workbookSheets(zip).find((item) => item.name === sheetName);
  if (!sheet) throw new Error(`Aba não encontrada: ${sheetName}`);
  const rows = sheetRows(zip, sheet.path, strings);
  const header = rows.find((row) => row.rowNumber === 2);
  if (!header) throw new Error('A linha de cabeçalho 2 não foi encontrada.');
  assertHeaders(header);

  const records = [];
  for (const row of rows.filter((item) => item.rowNumber >= 3)) {
    const value = (column) => row.cells.get(column)?.value || '';
    if (!['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].some(value)) continue;

    const maintenanceDate = excelSerialToDateKey(value('A'));
    const responsibleName = value('B').trim();
    const equipmentCode = value('C').trim();
    const selectedServices = splitServices(value('D'));
    if (!maintenanceDate || !responsibleName || !equipmentCode || !selectedServices.length) {
      throw new Error(
        `Linha ${row.rowNumber} sem data, colaborador, equipamento ou itens verificados.`
      );
    }

    const documentUrl = extractHyperlink(row.cells.get('E')?.formula);
    const documentId = driveFileId(documentUrl);
    if (documentUrl && !documentId) {
      throw new Error(`Link de registro inválido na linha ${row.rowNumber}.`);
    }

    const photoIds = value('F')
      .split(/\s*,\s*/)
      .map(driveFileId)
      .filter(Boolean);
    const rawPhotoCount = value('F')
      .split(/\s*,\s*/)
      .filter(Boolean).length;
    if (photoIds.length !== rawPhotoCount) {
      throw new Error(`ID de foto inválido na linha ${row.rowNumber}.`);
    }

    records.push({
      sourceKey: `google-sheets:${spreadsheetId}:${gid}:${row.rowNumber}`,
      sourceRow: row.rowNumber,
      maintenanceDate,
      responsibleName,
      equipmentCode,
      selectedServices,
      observations: value('H') || null,
      thirdPartyServices: parseThirdPartyServices(value('G'), row.rowNumber),
      document: documentId
        ? {
            driveFileId: documentId,
            sourceUrl: documentUrl,
            label: value('E') || 'Registro de manutenção'
          }
        : null,
      photos: photoIds.map((id, index) => ({
        driveFileId: id,
        order: index + 1
      }))
    });
  }

  const documentIds = records.flatMap((record) =>
    record.document ? [record.document.driveFileId] : []
  );
  const photoIds = records.flatMap((record) =>
    record.photos.map((photo) => photo.driveFileId)
  );
  const dates = records.map((record) => record.maintenanceDate).sort();
  const equipmentCodes = new Set(records.map((record) => record.equipmentCode));

  return {
    version: 1,
    source: {
      spreadsheetId,
      gid,
      sheetName,
      url: options.sourceUrl || (
        `https://docs.google.com/spreadsheets/d/${spreadsheetId}`
        + `/edit?gid=${gid}#gid=${gid}`
      )
    },
    extractedAt: new Date().toISOString(),
    summary: {
      records: records.length,
      equipmentCodes: equipmentCodes.size,
      firstMaintenanceDate: dates[0] || null,
      lastMaintenanceDate: dates.at(-1) || null,
      documents: documentIds.length,
      uniqueDocuments: new Set(documentIds).size,
      photoReferences: photoIds.length,
      uniquePhotos: new Set(photoIds).size,
      recordsWithThirdPartyServices: records.filter(
        (record) => record.thirdPartyServices.length
      ).length,
      recordsWithObservations: records.filter((record) => record.observations)
        .length
    },
    records
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const dataset = extractLegacyMaintenanceHistory(path.resolve(options.input), {
    spreadsheetId: options.spreadsheetId,
    gid: options.gid,
    sheetName: options.sheetName,
    sourceUrl: sourceUrl(options)
  });
  const outputPath = path.resolve(options.output);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(dataset, null, 2)}\n`);
  console.log(
    `[extração] ${dataset.summary.records} registros, `
    + `${dataset.summary.documents} PDFs e `
    + `${dataset.summary.photoReferences} referências de fotos.`
  );
  console.log(`[extração] Arquivo: ${outputPath}`);
}

export {
  driveFileId,
  excelSerialToDateKey,
  extractHyperlink,
  extractLegacyMaintenanceHistory,
  parseThirdPartyServices,
  splitServices
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
}
