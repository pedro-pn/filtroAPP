#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { createCanvas } from '@napi-rs/canvas';
import { ReportAuditAction, ReportStatus, ReportType, ReportVersionStatus } from '@prisma/client';
import AdmZip from 'adm-zip';
import dotenv from 'dotenv';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createWorker } from 'tesseract.js';
import { DOMParser } from '@xmldom/xmldom';

import {
  MANUAL_REPORT_UPLOAD_KEY,
  buildManualReportOperationalFields,
  manualReportOperationalDataSchema
} from '../src/lib/reports/manual-operational-data.js';
import { reportCollaboratorCreateManyData } from '../src/lib/report-collaborators.js';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const DEFAULT_PDF_DIR = 'G:\\Meu Drive\\Drive Leandro\\Filtrovali\\Relatórios\\Missão 5719 - Ilha Solteira\\RDO';
const DEFAULT_COLLABORATORS_XLSX = '/mnt/c/Users/relat/Downloads/Colaboradores e obra 2026(1).xlsx';
const DEFAULT_WINDOWS_STAGING_DIR = 'C:\\Users\\relat\\Downloads\\newrdo-rdo-import-temp';
const MANUAL_REPORT_MAX_PDF_BYTES = 20 * 1024 * 1024;

dotenv.config();

function usage() {
  return [
    'Usage:',
    '  node scripts/import-manual-rdo-pdfs.js --database-url <url> [--apply]',
    '',
    'Main options:',
    `  --pdf-dir <path>              Default: ${DEFAULT_PDF_DIR}`,
    `  --collaborators-xlsx <path>   Default: ${DEFAULT_COLLABORATORS_XLSX}`,
    '  --project-code <code>         Default: 5719',
    '  --from <n>                    Default: 21',
    '  --to <n>                      Default: 100',
    '  --database-url <url>          Overrides DATABASE_URL before Prisma loads',
    '  --reports-dir <path>          Overrides REPORTS_DIR/UPLOAD_DIR for --apply',
    '  --user-id <id>                User to record as creator/reviewer; default: first active RDO manager',
    '  --summary-out <path>          Writes detailed JSON summary',
    '  --windows-staging-dir <path>  Used when --pdf-dir is a Windows drive path',
    '  --time-source <mode>          entrada-saida | servico. Default: entrada-saida',
    '  --collaborator-alias <a=b>    Maps a spreadsheet name to a collaborator code/name; may repeat',
    '  --ignore-collaborator <name>  Leaves a spreadsheet collaborator unlinked; may repeat',
    '  --apply                      Writes reports and copies PDFs; otherwise dry-run only'
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    pdfDir: DEFAULT_PDF_DIR,
    collaboratorsXlsx: DEFAULT_COLLABORATORS_XLSX,
    projectCode: '5719',
    from: 21,
    to: 100,
    apply: false,
    databaseUrl: '',
    reportsDir: '',
    userId: '',
    summaryOut: '',
    windowsStagingDir: DEFAULT_WINDOWS_STAGING_DIR,
    timeSource: 'entrada-saida',
    ocrScale: 2,
    ocrCacheDir: path.join(os.tmpdir(), 'newrdo-tesseract-cache'),
    projectMatch: [],
    collaboratorAliases: new Map(),
    ignoredCollaborators: new Set()
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.apply = false;
      continue;
    }
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (value == null || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    index += 1;
    switch (key) {
      case 'pdf-dir':
        options.pdfDir = value;
        break;
      case 'collaborators-xlsx':
        options.collaboratorsXlsx = value;
        break;
      case 'project-code':
        options.projectCode = value;
        break;
      case 'from':
        options.from = Number.parseInt(value, 10);
        break;
      case 'to':
        options.to = Number.parseInt(value, 10);
        break;
      case 'database-url':
        options.databaseUrl = value;
        break;
      case 'reports-dir':
        options.reportsDir = value;
        break;
      case 'user-id':
        options.userId = value;
        break;
      case 'summary-out':
        options.summaryOut = value;
        break;
      case 'windows-staging-dir':
        options.windowsStagingDir = value;
        break;
      case 'time-source':
        options.timeSource = value;
        break;
      case 'ocr-scale':
        options.ocrScale = Number(value);
        break;
      case 'ocr-cache-dir':
        options.ocrCacheDir = value;
        break;
      case 'project-match':
        options.projectMatch = value.split(',').map(item => item.trim()).filter(Boolean);
        break;
      case 'collaborator-alias': {
        const separator = value.indexOf('=');
        if (separator <= 0 || separator === value.length - 1) {
          throw new Error('--collaborator-alias must use "spreadsheet name=collaborator code or name".');
        }
        const inputName = value.slice(0, separator).trim();
        const target = value.slice(separator + 1).trim();
        options.collaboratorAliases.set(compactText(inputName), target);
        break;
      }
      case 'ignore-collaborator':
        options.ignoredCollaborators.add(compactText(value));
        break;
      default:
        throw new Error(`Unknown option: --${key}`);
    }
  }

  if (!Number.isInteger(options.from) || !Number.isInteger(options.to) || options.from < 1 || options.to < options.from) {
    throw new Error('Invalid --from/--to range.');
  }
  if (!['entrada-saida', 'servico'].includes(options.timeSource)) {
    throw new Error('--time-source must be entrada-saida or servico.');
  }
  if (!Number.isFinite(options.ocrScale) || options.ocrScale < 1 || options.ocrScale > 4) {
    throw new Error('--ocr-scale must be between 1 and 4.');
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

function compactText(value) {
  return normalizeText(value).replace(/\s+/g, '');
}

function normalizeTime(value) {
  const match = String(value || '').match(/(\d{1,2})\s*:\s*(\d{2})(?::\d{2})?/);
  if (!match) return '';
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return '';
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function normalizeDuration(value) {
  const text = String(value || '').trim();
  if (!text || /^[\s\-–—]+$/.test(text)) return '';
  const hm = text.match(/^(\d{1,3})\s*:\s*(\d{2})(?::(\d{2}))?$/);
  if (hm) {
    const hours = Number(hm[1]);
    const minutes = Number(hm[2]);
    const seconds = hm[3] == null ? 0 : Number(hm[3]);
    if (minutes > 59 || seconds > 59) return '';
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  const hText = normalizeText(text);
  const hourMatch = hText.match(/^(\d{1,3})\s*h(?:ora|oras)?(?:\s*(\d{1,2}))?$/);
  if (hourMatch) {
    const hours = Number(hourMatch[1]);
    const minutes = Number(hourMatch[2] || 0);
    if (minutes > 59) return '';
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
  }
  const minMatch = hText.match(/^(\d{1,4})\s*min$/);
  if (minMatch) {
    const total = Number(minMatch[1]);
    const hours = Math.floor(total / 60);
    const minutes = total % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
  }
  return '';
}

function dateKeyFromPt(value) {
  const match = String(value || '').match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (!match) return '';
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (year < 2000 || month < 1 || month > 12 || day < 1 || day > 31) return '';
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseReportFileName(fileName) {
  const match = String(fileName || '').match(/\bRDO\s+(\d{1,4})\s*-\s*(\d{1,2})-(\d{1,2})-(\d{4})\b/i);
  if (!match) return null;
  return {
    sequenceNumber: Number(match[1]),
    reportDate: dateKeyFromPt(`${match[2]}/${match[3]}/${match[4]}`)
  };
}

function parseFirst(regex, text) {
  const match = text.match(regex);
  return match ? match[1] : '';
}

function parseReportFieldsFromOcrText(text, fallback = {}, options = {}) {
  const normalized = String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const flat = normalized.replace(/[ \t]+/g, ' ');
  const compact = flat.replace(/\s*\n+\s*/g, ' ');

  const sequenceNumber = Number.parseInt(parseFirst(/\bRDO\s*(?:n\s*[oº°.]*)?\s*[:.-]?\s*(\d{1,4})\b/i, compact), 10);
  const reportDate = dateKeyFromPt(parseFirst(/\bData\s*[:.-]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{4})\b/i, compact));
  const entrada = normalizeTime(parseFirst(/\bEntrada\s*[:.-]?\s*(\d{1,2}\s*:\s*\d{2})\b/i, compact));
  const saida = normalizeTime(parseFirst(/\bSaida\s*[:.-]?\s*(\d{1,2}\s*:\s*\d{2})\b/i, compact));
  const serviceStart = normalizeTime(parseFirst(/\bInicio\s*[:.-]?\s*(\d{1,2}\s*:\s*\d{2})\b/i, compact));
  const serviceEnd = normalizeTime(parseFirst(/\bTermino\s*[:.-]?\s*(\d{1,2}\s*:\s*\d{2})\b/i, compact));

  const standbyRaw = parseFirst(/\b(?:Stand\s*[- ]?\s*by|Standby|Tempo\s+(?:total\s+)?(?:de\s+)?stand\s*[- ]?\s*by)\s*[:.-]?\s*([0-9]{1,3}\s*:\s*[0-9]{2}(?::[0-9]{2})?|[0-9]{1,3}\s*h(?:ora|oras)?(?:\s*[0-9]{1,2})?|[0-9]{1,4}\s*min)\b/i, compact);
  const standbyTotal = normalizeDuration(standbyRaw);

  let standbyMotivo = '';
  const motiveMatch = compact.match(/\bMotivo\s*(?:stand\s*[- ]?\s*by|standby)?\s*[:.-]?\s*(.+?)(?:\s+(?:Lider|Cargo|Ass\.?|Assinatura|Horas extras|Comentario|Coment\.|Servico)\b|$)/i);
  if (motiveMatch) {
    standbyMotivo = motiveMatch[1].trim().replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, '');
    if (/^(nao|n a o|sem|[-–—])$/i.test(normalizeText(standbyMotivo))) standbyMotivo = '';
  }

  const timeSource = options.timeSource || 'entrada-saida';
  const arrivalTime = timeSource === 'servico' ? serviceStart || entrada : entrada || serviceStart;
  const departureTime = timeSource === 'servico' ? serviceEnd || saida : saida || serviceEnd;

  return {
    sequenceNumber: Number.isInteger(sequenceNumber) ? sequenceNumber : fallback.sequenceNumber || null,
    reportDate: reportDate || fallback.reportDate || '',
    arrivalTime,
    departureTime,
    lunchBreak: '01:00:00',
    serviceStartTime: serviceStart,
    serviceEndTime: serviceEnd,
    standby: standbyTotal
      ? {
          enabled: true,
          total: standbyTotal,
          motivo: standbyMotivo
        }
      : {
          enabled: false,
          total: '',
          motivo: ''
        }
  };
}

function excelSerialToDateKey(value) {
  const serial = Number(value);
  if (!Number.isFinite(serial)) return '';
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function xmlText(node) {
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

function columnIndex(cellRef) {
  const match = String(cellRef || '').match(/[A-Z]+/);
  if (!match) return 0;
  let value = 0;
  for (const char of match[0]) value = value * 26 + (char.charCodeAt(0) - 64);
  return value;
}

function rowIndex(cellRef) {
  return Number(String(cellRef || '').match(/\d+/)?.[0] || 0);
}

function workbookSheets(zip) {
  const workbook = parseXml(zip.getEntry('xl/workbook.xml').getData().toString('utf8'));
  const rels = parseXml(zip.getEntry('xl/_rels/workbook.xml.rels').getData().toString('utf8'));
  const relMap = new Map();
  for (const rel of Array.from(rels.getElementsByTagName('Relationship'))) {
    relMap.set(rel.getAttribute('Id'), rel.getAttribute('Target'));
  }
  return Array.from(workbook.getElementsByTagName('sheet')).map(sheet => {
    const target = relMap.get(sheet.getAttribute('r:id')) || '';
    return {
      name: sheet.getAttribute('name') || '',
      path: target.startsWith('xl/') ? target : `xl/${target}`
    };
  });
}

function sharedStrings(zip) {
  const entry = zip.getEntry('xl/sharedStrings.xml');
  if (!entry) return [];
  const doc = parseXml(entry.getData().toString('utf8'));
  return Array.from(doc.getElementsByTagName('si')).map(item => xmlText(item));
}

function sheetCells(zip, sheetPath, strings) {
  const doc = parseXml(zip.getEntry(sheetPath).getData().toString('utf8'));
  const cells = new Map();
  for (const cell of Array.from(doc.getElementsByTagName('c'))) {
    const ref = cell.getAttribute('r');
    const type = cell.getAttribute('t');
    const raw = type === 'inlineStr'
      ? xmlText(cell)
      : xmlText(cell.getElementsByTagName('v')[0] || cell);
    const value = type === 's' ? strings[Number(raw)] ?? raw : raw;
    if (String(value || '').trim() === '') continue;
    const row = rowIndex(ref);
    const col = columnIndex(ref);
    if (!cells.has(row)) cells.set(row, new Map());
    cells.get(row).set(col, String(value).trim());
  }
  return cells;
}

function valueMatchesProject(value, project, extraMatches = []) {
  const normalized = normalizeText(value);
  if (!normalized) return false;
  const candidates = [
    project?.code,
    project?.name,
    project?.clientName,
    ...extraMatches
  ].filter(Boolean);
  return candidates.some(candidate => {
    const needle = normalizeText(candidate);
    return needle && normalized.includes(needle);
  });
}

function readCollaboratorAllocationsFromWorkbook(filePath, project, options = {}) {
  const zip = new AdmZip(filePath);
  const strings = sharedStrings(zip);
  const allocations = new Map();

  for (const sheet of workbookSheets(zip)) {
    const cells = sheetCells(zip, sheet.path, strings);
    const header = cells.get(1);
    if (!header) continue;

    const collaboratorColumns = Array.from(header.entries())
      .filter(([col, value]) => col >= 2 && normalizeText(value) && !['projeto', 'cnpj'].includes(normalizeText(value)))
      .map(([col, value]) => ({ col, name: value }));

    for (const [rowNumber, row] of cells.entries()) {
      if (rowNumber <= 2) continue;
      const dateKey = excelSerialToDateKey(row.get(1));
      if (!dateKey) continue;

      for (const collaborator of collaboratorColumns) {
        const projectText = row.get(collaborator.col) || '';
        const cnpjText = row.get(collaborator.col + 1) || '';
        if (!valueMatchesProject(projectText, project, options.projectMatch)) continue;
        const current = allocations.get(dateKey) || [];
        current.push({
          name: collaborator.name,
          sheet: sheet.name,
          row: rowNumber,
          projectText,
          cnpjText
        });
        allocations.set(dateKey, current);
      }
    }
  }

  return allocations;
}

function levenshtein(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let last = i - 1;
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const old = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        last + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      last = old;
    }
  }
  return previous[b.length];
}

function nameTokens(value) {
  return normalizeText(value).split(/\s+/).filter(Boolean);
}

function resolveCollaboratorName(name, collaborators, aliases = new Map()) {
  const wanted = normalizeText(name);
  const wantedCompact = compactText(name);
  const wantedTokens = nameTokens(name);
  const activeFirst = [...collaborators].sort((left, right) => Number(right.isActive) - Number(left.isActive));
  const alias = aliases.get(wantedCompact);

  if (alias) {
    const aliasCompact = compactText(alias);
    const byAlias = activeFirst.filter(collaborator => (
      compactText(collaborator.code) === aliasCompact
      || compactText(collaborator.name) === aliasCompact
    ));
    if (byAlias.length === 1) return { status: 'matched', collaborator: byAlias[0], strategy: 'alias' };
    if (byAlias.length > 1) return { status: 'ambiguous', candidates: byAlias, strategy: 'alias' };
    return { status: 'missing', candidates: [], strategy: 'alias' };
  }

  const exact = activeFirst.filter(collaborator => compactText(collaborator.name) === wantedCompact);
  if (exact.length === 1) return { status: 'matched', collaborator: exact[0], strategy: 'exact' };
  if (exact.length > 1) return { status: 'ambiguous', candidates: exact, strategy: 'exact' };

  const allTokens = activeFirst.filter(collaborator => {
    const tokens = nameTokens(collaborator.name);
    return wantedTokens.length > 1 && wantedTokens.every(token => tokens.includes(token));
  });
  if (allTokens.length === 1) return { status: 'matched', collaborator: allTokens[0], strategy: 'tokens' };
  if (allTokens.length > 1) return { status: 'ambiguous', candidates: allTokens, strategy: 'tokens' };

  const first = wantedTokens[0] || wanted;
  if (first) {
    const firstToken = activeFirst.filter(collaborator => nameTokens(collaborator.name)[0] === first);
    if (firstToken.length === 1) return { status: 'matched', collaborator: firstToken[0], strategy: 'first-token' };
    if (firstToken.length > 1) return { status: 'ambiguous', candidates: firstToken, strategy: 'first-token' };

    const nearFirstToken = activeFirst.filter(collaborator => {
      const candidate = nameTokens(collaborator.name)[0] || '';
      return candidate && levenshtein(first, candidate) <= 1;
    });
    if (nearFirstToken.length === 1) return { status: 'matched', collaborator: nearFirstToken[0], strategy: 'near-first-token' };
    if (nearFirstToken.length > 1) return { status: 'ambiguous', candidates: nearFirstToken, strategy: 'near-first-token' };
  }

  return { status: 'missing', candidates: [], strategy: 'none' };
}

function resolveCollaboratorsForAllocations(allocations, collaborators, options = {}) {
  const resolvedByName = new Map();
  const output = new Map();

  for (const [dateKey, rows] of allocations.entries()) {
    const ids = [];
    const names = [];
    const issues = [];
    const ignored = [];
    for (const row of rows) {
      if (options.ignoredCollaborators?.has(compactText(row.name))) {
        ignored.push({
          input: row.name,
          sheet: row.sheet,
          row: row.row,
          projectText: row.projectText
        });
        continue;
      }
      if (!resolvedByName.has(row.name)) {
        resolvedByName.set(row.name, resolveCollaboratorName(row.name, collaborators, options.collaboratorAliases));
      }
      const resolution = resolvedByName.get(row.name);
      if (resolution.status === 'matched') {
        if (!ids.includes(resolution.collaborator.id)) ids.push(resolution.collaborator.id);
        names.push({
          input: row.name,
          matched: resolution.collaborator.name,
          code: resolution.collaborator.code,
          isActive: resolution.collaborator.isActive,
          strategy: resolution.strategy
        });
      } else {
        issues.push({
          input: row.name,
          status: resolution.status,
          strategy: resolution.strategy,
          candidates: (resolution.candidates || []).map(candidate => ({
            id: candidate.id,
            code: candidate.code,
            name: candidate.name,
            isActive: candidate.isActive
          })),
          sheet: row.sheet,
          row: row.row,
          projectText: row.projectText
        });
      }
    }
    output.set(dateKey, {
      collaboratorIds: ids,
      matches: names,
      ignored,
      issues
    });
  }

  return output;
}

function isWindowsDrivePath(value) {
  return /^[A-Za-z]:[\\/]/.test(String(value || ''));
}

function windowsPathToWsl(value) {
  const match = String(value || '').match(/^([A-Za-z]):[\\/](.*)$/);
  if (!match) return value;
  return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, '/')}`;
}

function toLocalReadablePath(value) {
  if (process.platform === 'linux' && isWindowsDrivePath(value)) {
    const wslPath = windowsPathToWsl(value);
    return wslPath;
  }
  return value;
}

function powerShellString(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

async function copyWindowsPdfToStaging(sourceDir, sequenceNumber, stagingDir) {
  const command = [
    '$ErrorActionPreference = "Stop"',
    `$source = ${powerShellString(String(sourceDir || '').replace(/[\\/]+$/, ''))}`,
    `$target = ${powerShellString(String(stagingDir || '').replace(/[\\/]+$/, ''))}`,
    'New-Item -ItemType Directory -Force -Path $target | Out-Null',
    `$files = Get-ChildItem -LiteralPath $source -File -Filter '*.pdf' | Where-Object { $_.Name -match ${powerShellString(`\\bRDO\\s+${sequenceNumber}\\s+-`)} }`,
    `if (-not $files) { throw ${powerShellString(`No PDF found for RDO ${sequenceNumber}`)} }`,
    'foreach ($file in $files) { Copy-Item -LiteralPath $file.FullName -Destination $target -Force }'
  ].join('; ');
  await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command], {
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });
}

async function cleanStagedSequence(stagingWslDir, sequenceNumber) {
  await fs.mkdir(stagingWslDir, { recursive: true });
  const files = await fs.readdir(stagingWslDir).catch(() => []);
  await Promise.all(files
    .filter(fileName => parseReportFileName(fileName)?.sequenceNumber === sequenceNumber)
    .map(fileName => fs.unlink(path.join(stagingWslDir, fileName)).catch(() => undefined)));
}

async function discoverPdfFiles(options) {
  const issues = [];
  let scanDir = toLocalReadablePath(options.pdfDir);
  const sourceIsWindows = isWindowsDrivePath(options.pdfDir) && !(await pathExists(scanDir));

  if (sourceIsWindows) {
    const stagingWslDir = windowsPathToWsl(options.windowsStagingDir);
    await fs.mkdir(stagingWslDir, { recursive: true });
    for (let sequence = options.from; sequence <= options.to; sequence += 1) {
      await cleanStagedSequence(stagingWslDir, sequence);
      try {
        await copyWindowsPdfToStaging(options.pdfDir, sequence, options.windowsStagingDir);
      } catch (error) {
        issues.push({
          type: 'copy-failed',
          sequenceNumber: sequence,
          message: error.stderr || error.stdout || error.message
        });
      }
    }
    scanDir = stagingWslDir;
  }

  const files = await fs.readdir(scanDir);
  const bySequence = new Map();
  for (const fileName of files) {
    if (!/\.pdf$/i.test(fileName)) continue;
    const parsed = parseReportFileName(fileName);
    if (!parsed || parsed.sequenceNumber < options.from || parsed.sequenceNumber > options.to) continue;
    const current = bySequence.get(parsed.sequenceNumber) || [];
    current.push({
      fileName,
      filePath: path.join(scanDir, fileName),
      filenameFields: parsed
    });
    bySequence.set(parsed.sequenceNumber, current);
  }

  const selected = [];
  for (let sequence = options.from; sequence <= options.to; sequence += 1) {
    const matches = (bySequence.get(sequence) || []).sort((left, right) => left.fileName.localeCompare(right.fileName));
    if (!matches.length) {
      issues.push({ type: 'missing-pdf', sequenceNumber: sequence });
      continue;
    }
    if (matches.length > 1) {
      issues.push({ type: 'duplicate-pdf', sequenceNumber: sequence, files: matches.map(item => item.fileName) });
    }
    selected.push(matches[0]);
  }

  return { files: selected, issues, sourceIsWindows, scanDir };
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function renderFirstPagePng(pdfPath, scale = 2) {
  const data = new Uint8Array(await fs.readFile(pdfPath));
  const loadingTask = pdfjsLib.getDocument({
    data,
    disableWorker: true,
    useSystemFonts: true,
    verbosity: pdfjsLib.VerbosityLevel.ERRORS
  });
  const pdf = await loadingTask.promise;
  try {
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const canvasContext = canvas.getContext('2d');
    await page.render({ canvasContext, viewport }).promise;
    return canvas.toBuffer('image/png');
  } finally {
    await pdf.cleanup?.();
    await loadingTask.destroy?.();
  }
}

async function createOcrWorker(options) {
  const porData = require('@tesseract.js-data/por');
  await fs.mkdir(options.ocrCacheDir, { recursive: true });
  return createWorker('por', 1, {
    langPath: porData.langPath,
    gzip: porData.gzip,
    cachePath: options.ocrCacheDir
  });
}

async function isLikelyCompletePdf(pdfPath) {
  let handle;
  try {
    handle = await fs.open(pdfPath, 'r');
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 16 || stat.size > MANUAL_REPORT_MAX_PDF_BYTES) return false;
    const header = Buffer.alloc(5);
    await handle.read(header, 0, header.length, 0);
    if (header.toString('latin1') !== '%PDF-') return false;
    const tailLength = Math.min(2048, stat.size);
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tailLength, stat.size - tailLength);
    return tail.toString('latin1').includes('%%EOF');
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function safePath(value) {
  return String(value ?? '')
    .replace(/[<>:"/\\|?*\n\r]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

function reportDateKey(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function manualReportOriginalFileName(value) {
  const parsed = path.parse(String(value || '').trim());
  return safePath(parsed.name || String(value || '').trim().replace(/\.pdf$/i, '')) || 'relatorio-antigo';
}

function manualReportTarget(project, fields, sourceFileName, reportsDir) {
  const projectFolderName = safePath(`Missão ${project.code} - ${project.name}`) || safePath(project.id);
  const targetDir = path.join(reportsDir, projectFolderName, ReportType.RDO, 'uploads-manuais');
  const sequencePart = Number.isInteger(fields.sequenceNumber) ? String(fields.sequenceNumber).padStart(4, '0') : 'sem-numero';
  const dayPart = fields.reportDate || new Date().toISOString().slice(0, 10);
  const baseName = manualReportOriginalFileName(sourceFileName);
  const targetFileName = `${dayPart}-${sequencePart}-${Date.now()}-${crypto.randomUUID()}-${baseName}.pdf`;
  const targetPath = path.join(targetDir, targetFileName);
  return {
    targetDir,
    targetPath,
    publicUrl: path.relative(reportsDir, targetPath).split(path.sep).join('/')
  };
}

async function resolveImportUser(prisma, userId) {
  if (userId) {
    return prisma.user.findFirstOrThrow({
      where: { id: userId, isActive: true },
      select: { id: true, username: true, name: true, role: true, accountType: true }
    });
  }
  const user = await prisma.user.findFirst({
    where: {
      isActive: true,
      OR: [
        { role: 'MANAGER' },
        { moduleRoles: { some: { role: 'RDO_MANAGER' } } }
      ]
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, username: true, name: true, role: true, accountType: true }
  });
  if (!user) throw new Error('No active RDO manager user found. Pass --user-id.');
  return user;
}

function summaryIssueMap(reports, key) {
  const byInput = new Map();
  for (const report of reports) {
    for (const issue of report[key] || []) {
      const id = issue.input || issue.type || issue.message || 'unknown';
      const current = byInput.get(id) || { count: 0, reports: [], issue };
      current.count += 1;
      current.reports.push(report.sequenceNumber);
      byInput.set(id, current);
    }
  }
  return Array.from(byInput.values()).map(item => ({
    ...item.issue,
    count: item.count,
    reports: item.reports
  }));
}

async function prepareReports({ prisma, options, project, collaborators }) {
  const discovery = await discoverPdfFiles(options);
  const allocations = readCollaboratorAllocationsFromWorkbook(options.collaboratorsXlsx, project, options);
  const resolvedAllocations = resolveCollaboratorsForAllocations(allocations, collaborators, options);
  const worker = await createOcrWorker(options);
  const reports = [];

  try {
    let processed = 0;
    for (const file of discovery.files) {
      processed += 1;
      process.stdout.write(`[ocr] ${processed}/${discovery.files.length} ${file.fileName}\n`);
      const completePdf = await isLikelyCompletePdf(file.filePath);
      const image = completePdf ? await renderFirstPagePng(file.filePath, options.ocrScale) : null;
      const ocr = image ? await worker.recognize(image) : { data: { text: '' } };
      const fields = parseReportFieldsFromOcrText(ocr.data.text, file.filenameFields, {
        timeSource: options.timeSource
      });
      const dateAllocation = resolvedAllocations.get(fields.reportDate) || {
        collaboratorIds: [],
        matches: [],
        ignored: [],
        issues: []
      };
      const existing = await prisma.report.findFirst({
        where: {
          projectId: project.id,
          reportType: ReportType.RDO,
          sequenceNumber: file.filenameFields.sequenceNumber,
          deletedAt: null
        },
        select: { id: true, reportDate: true, status: true }
      });
      const issues = [];

      if (!completePdf) issues.push({ type: 'invalid-pdf', message: 'PDF incomplete, too large, or invalid.' });
      if (fields.sequenceNumber !== file.filenameFields.sequenceNumber) {
        issues.push({
          type: 'sequence-mismatch',
          expected: file.filenameFields.sequenceNumber,
          ocr: fields.sequenceNumber
        });
      }
      if (fields.reportDate !== file.filenameFields.reportDate) {
        issues.push({
          type: 'date-mismatch',
          expected: file.filenameFields.reportDate,
          ocr: fields.reportDate
        });
      }
      if (!fields.arrivalTime || !fields.departureTime) {
        issues.push({
          type: 'missing-time',
          arrivalTime: fields.arrivalTime,
          departureTime: fields.departureTime
        });
      }
      if (fields.standby.enabled && !fields.standby.motivo) {
        issues.push({
          type: 'missing-standby-reason',
          standbyTotal: fields.standby.total
        });
      }
      if (!dateAllocation.collaboratorIds.length) {
        issues.push({
          type: 'missing-allocation',
          message: `No collaborator allocation found for ${fields.reportDate}.`
        });
      }
      if (existing) {
        issues.push({
          type: 'existing-report',
          reportId: existing.id,
          reportDate: reportDateKey(existing.reportDate),
          status: existing.status
        });
      }

      reports.push({
        sequenceNumber: file.filenameFields.sequenceNumber,
        fileName: file.fileName,
        filePath: file.filePath,
        filenameFields: file.filenameFields,
        ocrText: ocr.data.text,
        fields,
        collaborators: dateAllocation,
        ignoredCollaborators: dateAllocation.ignored,
        collaboratorIssues: dateAllocation.issues,
        issues,
        existingReport: existing
      });
    }
  } finally {
    await worker.terminate();
  }

  return {
    discovery,
    reports,
    ignoredCollaborators: summaryIssueMap(reports, 'ignoredCollaborators'),
    unresolvedCollaborators: summaryIssueMap(reports, 'collaboratorIssues'),
    importIssues: reports.flatMap(report => report.issues.map(issue => ({
      sequenceNumber: report.sequenceNumber,
      reportDate: report.fields.reportDate,
      fileName: report.fileName,
      ...issue
    })))
  };
}

function fatalIssues(prepared) {
  const reportNumbersToCreate = new Set(
    prepared.reports
      .filter(report => !report.existingReport)
      .map(report => report.sequenceNumber)
  );
  const unresolvedForNewReports = summaryIssueMap(
    prepared.reports.filter(report => !report.existingReport),
    'collaboratorIssues'
  );

  return [
    ...prepared.discovery.issues,
    ...prepared.importIssues.filter(issue => issue.type !== 'existing-report' && reportNumbersToCreate.has(issue.sequenceNumber)),
    ...unresolvedForNewReports
  ];
}

function operationalDataForReport(report) {
  const fields = report.fields;
  return manualReportOperationalDataSchema.parse({
    reportDate: fields.reportDate,
    arrivalTime: fields.arrivalTime,
    departureTime: fields.departureTime,
    lunchBreak: fields.lunchBreak,
    collaboratorIds: report.collaborators.collaboratorIds,
    standby: fields.standby.enabled
      ? {
          enabled: true,
          total: fields.standby.total,
          motivo: fields.standby.motivo || 'Motivo nao identificado no OCR'
        }
      : undefined
  });
}

async function saveImportedPdf(sourcePath, target) {
  const pdfBytes = await fs.readFile(sourcePath);
  await fs.mkdir(target.targetDir, { recursive: true });
  const tempPath = `${target.targetPath}.tmp`;
  try {
    await fs.writeFile(tempPath, pdfBytes, { flag: 'wx' });
    if (!(await isLikelyCompletePdf(tempPath))) throw new Error('Copied PDF failed integrity check.');
    await fs.rename(tempPath, target.targetPath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => undefined);
    throw error;
  }
  return {
    sourceDocumentHash: sha256Hex(pdfBytes),
    publicUrl: target.publicUrl,
    targetPath: target.targetPath
  };
}

async function applyReports({ prisma, options, project, user, prepared, reportsDir }) {
  const created = [];
  const skipped = [];

  for (const report of prepared.reports) {
    if (report.existingReport) {
      skipped.push({ sequenceNumber: report.sequenceNumber, reason: 'existing-report', reportId: report.existingReport.id });
      continue;
    }

    const target = manualReportTarget(project, report.fields, report.fileName, reportsDir);
    const savedPdf = await saveImportedPdf(report.filePath, target);
    try {
      const createdReport = await prisma.$transaction(async tx => {
        const operationalData = operationalDataForReport(report);
        const operationalFields = await buildManualReportOperationalFields(tx, project, new Date(`${report.fields.reportDate}T12:00:00.000Z`), operationalData, ReportType.RDO);
        const reportCollaborators = await reportCollaboratorCreateManyData(tx, operationalFields.collaboratorIds);
        const now = new Date();
        const specialConditions = {
          source: 'MANUAL_UPLOAD',
          ...operationalFields.specialConditions,
          [MANUAL_REPORT_UPLOAD_KEY]: {
            originalFileName: report.fileName,
            uploadedAt: now.toISOString(),
            uploadedByUserId: user.id,
            collaboratorSource: 'POINT_WORKBOOK',
            signedOnUpload: false,
            requiresSignature: false,
            allowsOptionalSignature: true,
            signatureMode: 'APPROVED',
            importedByScript: 'import-manual-rdo-pdfs'
          }
        };

        const item = await tx.report.create({
          data: {
            projectId: project.id,
            createdByUserId: user.id,
            reviewedByUserId: user.id,
            reportType: ReportType.RDO,
            sequenceNumber: report.sequenceNumber,
            status: ReportStatus.APPROVED,
            reportDate: new Date(`${report.fields.reportDate}T12:00:00.000Z`),
            ...operationalFields.data,
            approvedAt: now,
            specialConditions,
            pendingDerivedTypes: [],
            collaborators: {
              create: reportCollaborators
            }
          },
          select: { id: true }
        });

        const version = await tx.reportVersion.create({
          data: {
            reportId: item.id,
            versionNumber: 1,
            sourcePdfUrl: savedPdf.publicUrl,
            sourceDocumentHash: savedPdf.sourceDocumentHash,
            finalPdfUrl: null,
            finalDocumentHash: null,
            validationCode: null,
            status: ReportVersionStatus.ACTIVE,
            createdByUserId: user.id
          },
          select: { id: true }
        });

        await tx.reportAuditLog.create({
          data: {
            reportId: item.id,
            versionId: version.id,
            userId: user.id,
            action: ReportAuditAction.VERSION_CREATED,
            description: 'Upload manual importado por script em lote.'
          }
        });

        const sequenceKey = {
          projectId_reportType: {
            projectId: project.id,
            reportType: ReportType.RDO
          }
        };
        const [sequenceState, maxReportSequence] = await Promise.all([
          tx.projectReportSeq.findUnique({
            where: sequenceKey,
            select: { nextNumber: true }
          }),
          tx.report.aggregate({
            where: {
              projectId: project.id,
              reportType: ReportType.RDO,
              deletedAt: null
            },
            _max: { sequenceNumber: true }
          })
        ]);
        const lastUsedNumber = Math.max(
          sequenceState?.nextNumber || 0,
          maxReportSequence._max.sequenceNumber || 0,
          report.sequenceNumber
        );

        if (sequenceState) {
          await tx.projectReportSeq.update({
            where: sequenceKey,
            data: { nextNumber: lastUsedNumber }
          });
        } else {
          await tx.projectReportSeq.create({
            data: {
              projectId: project.id,
              reportType: ReportType.RDO,
              nextNumber: lastUsedNumber
            }
          });
        }

        return item;
      });
      created.push({
        id: createdReport.id,
        sequenceNumber: report.sequenceNumber,
        reportDate: report.fields.reportDate,
        sourcePdfUrl: savedPdf.publicUrl
      });
    } catch (error) {
      await fs.unlink(savedPdf.targetPath).catch(() => undefined);
      throw error;
    }
  }

  return { created, skipped };
}

function reportsDirFromEnvironment(options) {
  if (options.reportsDir) return toLocalReadablePath(options.reportsDir);
  const configured = process.env.REPORTS_DIR || process.env.UPLOAD_DIR || '';
  if (configured) return toLocalReadablePath(configured);
  return path.resolve(process.cwd(), 'Relatorios');
}

function summaryForOutput({ options, project, user, reportsDir, prepared, applyResult }) {
  return {
    mode: options.apply ? 'apply' : 'dry-run',
    project,
    user,
    reportsDir,
    source: {
      pdfDir: options.pdfDir,
      scanDir: prepared.discovery.scanDir,
      collaboratorsXlsx: options.collaboratorsXlsx
    },
    counts: {
      discovered: prepared.discovery.files.length,
      prepared: prepared.reports.length,
      existing: prepared.reports.filter(report => report.existingReport).length,
      created: applyResult?.created?.length || 0,
      skipped: applyResult?.skipped?.length || 0,
      discoveryIssues: prepared.discovery.issues.length,
      importIssues: prepared.importIssues.length,
      ignoredCollaborators: prepared.ignoredCollaborators.length,
      unresolvedCollaborators: prepared.unresolvedCollaborators.length
    },
    discoveryIssues: prepared.discovery.issues,
    importIssues: prepared.importIssues,
    ignoredCollaborators: prepared.ignoredCollaborators,
    unresolvedCollaborators: prepared.unresolvedCollaborators,
    reports: prepared.reports.map(report => ({
      sequenceNumber: report.sequenceNumber,
      fileName: report.fileName,
      reportDate: report.fields.reportDate,
      arrivalTime: report.fields.arrivalTime,
      departureTime: report.fields.departureTime,
      serviceStartTime: report.fields.serviceStartTime,
      serviceEndTime: report.fields.serviceEndTime,
      standby: report.fields.standby,
      collaboratorIds: report.collaborators.collaboratorIds,
      collaboratorMatches: report.collaborators.matches,
      ignoredCollaborators: report.ignoredCollaborators,
      collaboratorIssues: report.collaboratorIssues,
      issues: report.issues,
      existingReport: report.existingReport
    })),
    applyResult
  };
}

function printSummary(summary) {
  console.log('');
  console.log(`[summary] mode=${summary.mode}`);
  console.log(`[summary] project=${summary.project.code} ${summary.project.name}`);
  console.log(`[summary] prepared=${summary.counts.prepared} existing=${summary.counts.existing} created=${summary.counts.created}`);
  console.log(`[summary] discoveryIssues=${summary.counts.discoveryIssues} importIssues=${summary.counts.importIssues} unresolvedCollaborators=${summary.counts.unresolvedCollaborators}`);
  if (summary.unresolvedCollaborators.length) {
    console.log('[summary] unresolved collaborators:');
    for (const issue of summary.unresolvedCollaborators) {
      console.log(`  - ${issue.input} (${issue.status}) reports=${issue.reports.join(',')}`);
    }
  }
  if (summary.ignoredCollaborators.length) {
    console.log('[summary] ignored collaborators:');
    for (const issue of summary.ignoredCollaborators) {
      console.log(`  - ${issue.input} reports=${issue.reports.join(',')}`);
    }
  }
  if (summary.importIssues.length) {
    console.log('[summary] import issues:');
    for (const issue of summary.importIssues.slice(0, 30)) {
      console.log(`  - RDO ${issue.sequenceNumber}: ${issue.type}`);
    }
    if (summary.importIssues.length > 30) console.log(`  - ... ${summary.importIssues.length - 30} more`);
  }
}

export {
  compactText,
  dateKeyFromPt,
  excelSerialToDateKey,
  normalizeDuration,
  normalizeText,
  normalizeTime,
  parseReportFieldsFromOcrText,
  parseReportFileName,
  readCollaboratorAllocationsFromWorkbook,
  resolveCollaboratorsForAllocations,
  resolveCollaboratorName
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  if (options.databaseUrl) process.env.DATABASE_URL = options.databaseUrl;
  if (options.reportsDir) process.env.REPORTS_DIR = options.reportsDir;

  const { default: prisma } = await import('../src/lib/prisma.js');
  try {
    const [project, collaborators, user] = await Promise.all([
      prisma.project.findFirstOrThrow({
        where: { code: options.projectCode, deletedAt: null },
        select: {
          id: true,
          code: true,
          name: true,
          clientName: true,
          clientCnpj: true,
          workdayHours: true,
          weekendWorkdayHours: true,
          includesSaturday: true,
          includesSunday: true
        }
      }),
      prisma.collaborator.findMany({
        select: { id: true, code: true, name: true, jobRoleId: true, jobRole: { select: { id: true, name: true } }, isActive: true },
        orderBy: { name: 'asc' }
      }),
      resolveImportUser(prisma, options.userId)
    ]);

    const prepared = await prepareReports({ prisma, options, project, collaborators });
    const blockers = fatalIssues(prepared);
    const reportsDir = reportsDirFromEnvironment(options);

    let applyResult = null;
    if (options.apply) {
      if (blockers.length) {
        const error = new Error(`Refusing to apply with ${blockers.length} unresolved issue(s). Run dry-run and inspect --summary-out.`);
        error.blockers = blockers;
        throw error;
      }
      applyResult = await applyReports({ prisma, options, project, user, prepared, reportsDir });
    }

    const summary = summaryForOutput({ options, project, user, reportsDir, prepared, applyResult });
    if (options.summaryOut) {
      await fs.mkdir(path.dirname(path.resolve(options.summaryOut)), { recursive: true });
      await fs.writeFile(options.summaryOut, `${JSON.stringify(summary, null, 2)}\n`);
    }
    printSummary(summary);

    if (!options.apply) {
      console.log('');
      console.log('[dry-run] No database rows or PDF files were written. Re-run with --apply after reviewing the summary.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch(error => {
    console.error(error?.message || error);
    if (error?.blockers) console.error(JSON.stringify(error.blockers, null, 2));
    process.exit(1);
  });
}
