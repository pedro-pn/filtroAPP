import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import AdmZip from 'adm-zip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

import env from '../config/env.js';
import { formatCnpj } from './cnpj.js';
import { convertDocxToPdf } from './report-pdf-from-docx.js';
import { readStoredImageAsset } from './stored-image.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rcpTemplatePath = (() => {
  const rcpuPath = path.resolve(__dirname, '../../../Modelos/definitivos/Modelo - RCPU.docx');
  return fsSync.existsSync(rcpuPath)
    ? rcpuPath
    : path.resolve(__dirname, '../../../Modelos/definitivos/Modelo - RCP.docx');
})();
const execFileAsync = promisify(execFile);

// ── Shared helpers ──

function toYMD(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function formatDatePt(value) {
  const ymd = toYMD(value);
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

function safeText(value) {
  if (value == null) return '';
  return String(value);
}

function safePath(value) {
  return safeText(value).replace(/[<>:"/\\|?*\n\r]/g, '_').trim();
}

function stringify(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (typeof value === 'object' && value.labels) return Array.isArray(value.labels) ? value.labels.filter(Boolean).join(', ') : '';
  return String(value);
}

function canonicalize(name) {
  return String(name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s/()-]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function getField(fields, names) {
  for (const name of names) {
    const v = fields[name];
    if (v != null && v !== '') return v;
    const wanted = canonicalize(name);
    const found = Object.keys(fields).find(k => canonicalize(k) === wanted);
    if (found && fields[found] != null && fields[found] !== '') return fields[found];
  }
  return '';
}

function reportNumber(report) {
  return typeof report.sequenceNumber === 'number'
    ? String(report.sequenceNumber)
    : '---';
}

// ── XML utilities ──

function getTextNodes(node, out = []) {
  if (!node) return out;
  if (node.nodeType === 3) out.push(node);
  for (let child = node.firstChild; child; child = child.nextSibling) getTextNodes(child, out);
  return out;
}

function elementText(element) {
  return getTextNodes(element).map(n => n.data || '').join('');
}

function replaceTokenInElement(element, token, replacement) {
  const nodes = getTextNodes(element);
  let full = nodes.map(n => n.data || '').join('');
  let idx = full.indexOf(token);
  while (idx >= 0) {
    const end = idx + token.length;
    let offset = 0; let firstHit = true;
    for (const node of nodes) {
      const text = node.data || '';
      const startPos = offset; const endPos = offset + text.length;
      const overlapStart = Math.max(startPos, idx); const overlapEnd = Math.min(endPos, end);
      if (overlapStart < overlapEnd) {
        const ls = overlapStart - startPos; const le = overlapEnd - startPos;
        node.data = firstHit
          ? `${text.slice(0, ls)}${replacement}${text.slice(le)}`
          : `${text.slice(0, ls)}${text.slice(le)}`;
        firstHit = false;
      }
      offset = endPos;
    }
    full = nodes.map(n => n.data || '').join('');
    idx = full.indexOf(token);
  }
}

function replacePlaceholders(element, values) {
  Object.entries(values).forEach(([key, value]) => {
    const safe = safeText(value);
    [`{{${key}}}`, `{{ ${key} }}`, `{{${key} }}`, `{{ ${key}}}`].forEach(
      token => replaceTokenInElement(element, token, safe)
    );
  });
  preserveWordTextLineBreaks(element);
}

function preserveWordTextLineBreaks(element) {
  Array.from(element.getElementsByTagName('w:t')).forEach(node => {
    const content = node.textContent || '';
    if (!/[\r\n]/.test(content)) return;
    const doc = node.ownerDocument;
    const parent = node.parentNode;
    content.split(/\r\n|\r|\n/).forEach((line, index) => {
      if (index > 0) parent.insertBefore(doc.createElement('w:br'), node);
      const textNode = doc.createElement('w:t');
      if (/^\s|\s$/.test(line)) textNode.setAttribute('xml:space', 'preserve');
      textNode.appendChild(doc.createTextNode(line));
      parent.insertBefore(textNode, node);
    });
    parent.removeChild(node);
  });
}

function findFirstByText(root, tagName, token) {
  return Array.from(root.getElementsByTagName(tagName)).find(n => elementText(n).includes(token)) || null;
}

function removeNode(node) {
  if (node && node.parentNode) node.parentNode.removeChild(node);
}

function findAncestor(node, tagName) {
  let current = node;
  while (current) {
    if (current.tagName === tagName) return current;
    current = current.parentNode;
  }
  return null;
}

function cloneBefore(node, clones) {
  const parent = node.parentNode;
  clones.forEach(clone => parent.insertBefore(clone, node));
}

function updateXmlEntry(zip, entryName, transform) {
  const entry = zip.getEntry(entryName);
  if (!entry) return;
  const doc = new DOMParser().parseFromString(zip.readAsText(entry), 'text/xml');
  transform(doc);
  zip.updateFile(entryName, Buffer.from(new XMLSerializer().serializeToString(doc), 'utf8'));
}

function clearRemainingPlaceholders(xml) {
  return xml.replace(/\{\{[^}]+\}\}/g, '');
}

// ── Image utilities ──

function parsePngSize(buf) {
  if (buf.length < 24) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function parseJpegSize(buf) {
  let offset = 2;
  while (offset < buf.length) {
    if (buf[offset] !== 0xFF) { offset++; continue; }
    const marker = buf[offset + 1];
    const size = buf.readUInt16BE(offset + 2);
    if ([0xC0,0xC1,0xC2,0xC3,0xC5,0xC6,0xC7,0xC9,0xCA,0xCB,0xCD,0xCE,0xCF].includes(marker)) {
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    offset += 2 + size;
  }
  return null;
}

function getImageMeta(buf, fileName) {
  const ext = path.extname(fileName || '').toLowerCase();
  if (ext === '.png') return { ...parsePngSize(buf), extension: 'png', mimeType: 'image/png' };
  if (ext === '.jpg' || ext === '.jpeg') return { ...parseJpegSize(buf), extension: 'jpeg', mimeType: 'image/jpeg' };
  return { width: 100, height: 40, extension: ext.replace('.', '') || 'png', mimeType: 'image/png' };
}

function ensureContentType(zip, extension, mimeType) {
  const entry = zip.getEntry('[Content_Types].xml');
  if (!entry) return;
  const doc = new DOMParser().parseFromString(zip.readAsText(entry), 'text/xml');
  const defaults = Array.from(doc.documentElement.getElementsByTagName('Default'));
  if (defaults.some(n => String(n.getAttribute('Extension') || '').toLowerCase() === extension.toLowerCase())) return;
  const node = doc.createElement('Default');
  node.setAttribute('Extension', extension.toLowerCase());
  node.setAttribute('ContentType', mimeType);
  doc.documentElement.appendChild(node);
  zip.updateFile('[Content_Types].xml', Buffer.from(new XMLSerializer().serializeToString(doc), 'utf8'));
}

function nextRelId(relsDoc) {
  let max = 0;
  Array.from(relsDoc.getElementsByTagName('Relationship')).forEach(n => {
    const m = String(n.getAttribute('Id') || '').match(/^rId(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return `rId${max + 1}`;
}

function addImageRel(zip, relsDoc, asset, prefix) {
  const relId = nextRelId(relsDoc);
  const mediaName = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${asset.extension}`;
  zip.addFile(`word/media/${mediaName}`, asset.bytes);
  ensureContentType(zip, asset.extension, asset.mimeType);
  const rel = relsDoc.createElement('Relationship');
  rel.setAttribute('Id', relId);
  rel.setAttribute('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image');
  rel.setAttribute('Target', `media/${mediaName}`);
  relsDoc.documentElement.appendChild(rel);
  return relId;
}

function inlineImageXml(relId, cx, cy, name) {
  const n = safeText(name || 'Foto');
  return `<w:r xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="5010" name="${n}"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="${n}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

function signatureXml(relId, cx, cy) {
  return `<w:r xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="5000" name="Assinatura"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="Assinatura"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

async function getUploadAsset(source) {
  return readStoredImageAsset(source);
}

async function resolvePhotoAssets(uploads) {
  const assets = [];
  for (const u of (uploads || [])) {
    if (!u) continue;
    const source = u?.url || u?.storagePath || u?.fileName;
    const asset = await getUploadAsset(source);
    if (asset) assets.push({ ...asset, label: u?.label || u?.fileName || 'Foto' });
  }
  return assets;
}

function embedPhotos(zip, doc, placeholder, assets) {
  const table = findFirstByText(doc, 'w:tbl', placeholder);
  if (!table) return;
  if (!assets.length) { removeNode(table); return; }
  const targetParagraph = findFirstByText(table, 'w:p', placeholder);
  if (!targetParagraph) return;
  const cell = targetParagraph.parentNode;
  if (!cell) return;
  const relsEntry = zip.getEntry('word/_rels/document.xml.rels');
  if (!relsEntry) return;
  const relsDoc = new DOMParser().parseFromString(zip.readAsText(relsEntry), 'text/xml');
  while (cell.firstChild) cell.removeChild(cell.firstChild);
  const maxWidthEmu = 2857500;
  for (let i = 0; i < assets.length; i += 2) {
    const group = assets.slice(i, i + 2);
    const paragraph = doc.createElement('w:p');
    const pPr = doc.createElement('w:pPr');
    const jc = doc.createElement('w:jc'); jc.setAttribute('w:val', 'center');
    pPr.appendChild(jc); paragraph.appendChild(pPr);
    group.forEach((asset, idx) => {
      const relId = addImageRel(zip, relsDoc, asset, 'rcp-photo');
      const heightEmu = Math.max(1, Math.round(maxWidthEmu * (asset.height / asset.width)));
      const drawingDoc = new DOMParser().parseFromString(inlineImageXml(relId, maxWidthEmu, heightEmu, asset.label), 'text/xml');
      paragraph.appendChild(drawingDoc.documentElement);
      if (idx < group.length - 1) {
        const spacer = doc.createElement('w:r');
        const t = doc.createElement('w:t');
        t.appendChild(doc.createTextNode('   '));
        spacer.appendChild(t); paragraph.appendChild(spacer);
      }
    });
    cell.appendChild(paragraph);
  }
  zip.updateFile('word/_rels/document.xml.rels', Buffer.from(new XMLSerializer().serializeToString(relsDoc), 'utf8'));
}

function embedSignature(zip, doc, asset) {
  if (!asset) return;
  const targetParagraph = findFirstByText(doc, 'w:p', '{{sign}}');
  if (!targetParagraph) return;
  const relsEntry = zip.getEntry('word/_rels/document.xml.rels');
  if (!relsEntry) return;
  const relsDoc = new DOMParser().parseFromString(zip.readAsText(relsEntry), 'text/xml');
  const relId = nextRelId(relsDoc);
  const mediaName = `signature-rcp-${Date.now()}.${asset.extension}`;
  zip.addFile(`word/media/${mediaName}`, asset.bytes);
  ensureContentType(zip, asset.extension, asset.mimeType);
  const rel = relsDoc.createElement('Relationship');
  rel.setAttribute('Id', relId);
  rel.setAttribute('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image');
  rel.setAttribute('Target', `media/${mediaName}`);
  relsDoc.documentElement.appendChild(rel);
  zip.updateFile('word/_rels/document.xml.rels', Buffer.from(new XMLSerializer().serializeToString(relsDoc), 'utf8'));
  while (targetParagraph.firstChild) targetParagraph.removeChild(targetParagraph.firstChild);
  const widthEmu = 952500;
  const heightEmu = Math.max(1, Math.round(widthEmu * (asset.height / asset.width)));
  const drawingDoc = new DOMParser().parseFromString(signatureXml(relId, widthEmu, heightEmu), 'text/xml');
  targetParagraph.appendChild(drawingDoc.documentElement);
}

// ── Helpers de tempo ──

export function calcServiceMinutes(startTime, endTime) {
  if (!startTime || !endTime) return 0;
  const parseHHMM = s => {
    const parts = String(s).split(':').map(Number);
    return !isNaN(parts[0]) && !isNaN(parts[1]) ? parts[0] * 60 + parts[1] : null;
  };
  const start = parseHHMM(startTime);
  const end = parseHHMM(endTime);
  if (start === null || end === null) return 0;
  let diff = end - start;
  if (diff < 0) diff += 24 * 60; // serviço passou da meia-noite
  return diff;
}

function minutesToHHMMSS(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

// ── RCPU data building ──

function buildRcpBaseData(report) {
  const sc = report.specialConditions || {};
  const sd = sc.serviceData || {};
  const serviceType = sc.serviceType || 'flushing';
  const resolvedUnits = sc.resolvedUnits || [];
  const resolvedThermoUnit = sc.resolvedThermoUnit || '';
  const resolvedCounter = sc.resolvedCounter || null;
  const totalMinutes = sc.totalMinutes || 0;

  // {{service}}
  const service = serviceType === 'filtragem' ? 'Filtragem' : 'Flushing';

  // {{servicelist}}
  const tipoFlushing = stringify(getField(sd, ['Tipo de flushing']));
  const houveDesidratacao = /sim/i.test(stringify(getField(sd, ['Houve desidratação?', 'Houve desidratacao?'])));
  let servicelist;
  if (serviceType === 'filtragem') {
    servicelist = houveDesidratacao ? 'Filtragem absoluta e desidratação' : 'Filtragem absoluta';
  } else {
    const tipoStr = /secund/i.test(tipoFlushing) ? 'Flushing secundário' : 'Flushing primário';
    servicelist = houveDesidratacao ? `${tipoStr} e desidratação` : tipoStr;
  }

  // {{status}}
  const approvedRaw = stringify(getField(sd, ['Aprovado pelo cliente?']));
  const status = /sim/i.test(approvedRaw) ? 'APROVADO' : (/n[ãa]o/i.test(approvedRaw) ? 'REPROVADO' : '');

  // {{particlecounterserial}}
  const particlecounterserial = resolvedCounter
    ? `${resolvedCounter.code} - ${resolvedCounter.serialNumber}`
    : '';

  // Contagem de partículas
  const houvePart = /sim/i.test(stringify(getField(sd, ['Houve contagem de partículas?', 'Houve contagem de particulas?'])));
  const startnas  = houvePart ? stringify(getField(sd, ['Contagem inicial NAS'])) : '';
  const endnas    = houvePart ? stringify(getField(sd, ['Contagem final NAS'])) : '';
  const startiso  = houvePart ? stringify(getField(sd, ['Contagem inicial ISO'])) : '';
  const endiso    = houvePart ? stringify(getField(sd, ['Contagem final ISO'])) : '';

  // Análise de umidade
  const houveUmid = /sim/i.test(stringify(getField(sd, ['Houve análise de umidade?', 'Houve analise de umidade?'])));
  const startppm  = houveUmid ? `${stringify(getField(sd, ['Umidade inicial (ppm)']))} ppm` : '';
  const endppm    = houveUmid ? `${stringify(getField(sd, ['Umidade final (ppm)']))} ppm` : '';

  return {
    missiontitle: `Missão ${report.project.code} - ${report.project.name}`,
    client: safeText(report.project.clientName),
    cnpj: safeText(formatCnpj(report.project.clientCnpj)),
    local: safeText(report.project.location),
    proposal: safeText(report.project.contractCode),
    rcpu: reportNumber(report),
    date: formatDatePt(report.reportDate),
    service,
    equipament: stringify(getField(sd, ['Equipamento(s)', 'Equipamento'])),
    system: stringify(getField(sd, ['Sistema'])),
    oil: stringify(getField(sd, ['Tipo de óleo', 'Tipo de oleo'])),
    volume: stringify(getField(sd, ['Volume de óleo', 'Volume de oleo'])),
    flushingunit: resolvedUnits.join(', '),
    servicelist,
    thermounit: resolvedThermoUnit,
    particlecounterserial,
    starttime: stringify(getField(sd, ['Hora de início', 'Hora de inicio'])),
    endtime: stringify(getField(sd, ['Hora de término/pausa', 'Hora de termino/pausa'])),
    status,
    tags: stringify(getField(sd, ['Desenhos / TAGs', 'Desenhos / Tags'])),
    obs: stringify(getField(sd, ['Observações', 'Observacoes'])),
    startnas,
    endnas,
    startiso,
    endiso,
    totaltime: minutesToHHMMSS(totalMinutes),
    startppm,
    endppm,
    leadername: safeText(sc.__leaderSnapshot?.name || report.project?.operator?.name || report.createdBy?.collaborator?.name || report.createdBy?.name),
    leaderposition: safeText(sc.__leaderSnapshot?.role || report.project?.operator?.role || report.createdBy?.collaborator?.role)
  };
}

function expandTubeRows(doc, sd, serviceType) {
  const templateRow = findFirstByText(doc, 'w:tr', '{{diameter}}');
  if (!templateRow) return;
  if (serviceType === 'filtragem') {
    removeNode(findAncestor(templateRow, 'w:tbl') || templateRow);
    return;
  }
  const tubesRaw = getField(sd, ['Diâmetros e comprimentos', 'Diametros e comprimentos']);
  const tubes = Array.isArray(tubesRaw) ? tubesRaw.filter(t => t && (t.d || t.c)) : [];
  if (!tubes.length) {
    replacePlaceholders(templateRow, { diameter: '', length: '' });
    return;
  }
  const clones = tubes.map(t => {
    const clone = templateRow.cloneNode(true);
    const unit = t.unit || 'pol';
    replacePlaceholders(clone, {
      diameter: t.d ? `${t.d} ${unit}` : '',
      length: t.c ? `${t.c} m` : ''
    });
    return clone;
  });
  cloneBefore(templateRow, clones);
  removeNode(templateRow);
}

function expandRcpCollaborators(doc, collaborators) {
  const templateRow = findFirstByText(doc, 'w:tr', '{{collaboratorname}}');
  if (!templateRow) return;
  if (!collaborators.length) {
    replacePlaceholders(templateRow, { collaboratorname: '', collaboratorposition: '' });
    return;
  }
  const clones = collaborators.map(c => {
    const clone = templateRow.cloneNode(true);
    replacePlaceholders(clone, {
      collaboratorname: c.name || '',
      collaboratorposition: c.role || ''
    });
    return clone;
  });
  cloneBefore(templateRow, clones);
  removeNode(templateRow);
}

// ── PDF conversion ──

async function convertWithWord(docxPath, pdfPath) {
  const script = `
param([string]$DocxPath,[string]$PdfPath)
$ErrorActionPreference = 'Stop'
$word = $null; $document = $null
try {
  $pdfDir = Split-Path -Parent $PdfPath
  if(!(Test-Path $pdfDir)){ New-Item -ItemType Directory -Path $pdfDir | Out-Null }
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $document = $word.Documents.Open($DocxPath, $false, $true)
  $document.ExportAsFixedFormat($PdfPath, 17)
} finally {
  if($document -ne $null){ $document.Close([ref]$false) }
  if($word -ne $null){ $word.Quit() }
}
`;
  const scriptPath = path.join(env.uploadDir, `tmp-rcpu-pdf-${Date.now()}.ps1`);
  await fs.writeFile(scriptPath, script, 'utf8');
  try {
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, docxPath, pdfPath],
      { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }
    );
  } finally {
    await fs.rm(scriptPath, { force: true });
  }
}

// ── File organization ──

function resolveUploadFilePath(source) {
  if (!source) return null;
  let fileName = source;
  try {
    if (/^https?:\/\//i.test(source)) {
      const pathname = new URL(source).pathname;
      if (pathname.startsWith('/relatorios/')) fileName = decodeURIComponent(pathname.slice('/relatorios/'.length));
      else if (pathname.startsWith('/uploads/')) fileName = decodeURIComponent(pathname.slice('/uploads/'.length));
    } else if (source.startsWith('/relatorios/')) {
      fileName = decodeURIComponent(source.slice('/relatorios/'.length));
    } else if (source.startsWith('/uploads/')) {
      fileName = decodeURIComponent(source.slice('/uploads/'.length));
    }
  } catch { return null; }
  if (!fileName) return null;
  const targetPath = path.join(env.uploadDir, fileName);
  return fsSync.existsSync(targetPath) ? targetPath : null;
}

function extractUrlBase(source) {
  try {
    if (source && /^https?:\/\//i.test(source)) return new URL(source).origin;
  } catch {}
  return '';
}

function buildPhotoUrl(urlBase, projectFolder, subfolder, destName) {
  const encoded = [projectFolder, 'Registros Fotográficos', subfolder, destName]
    .map(s => encodeURIComponent(s)).join('/');
  return (urlBase || '') + '/relatorios/' + encoded;
}

export async function organizeRcpPhotos(report, projectFolderName) {
  const urlMap = new Map();
  const sc = report.specialConditions || {};
  const sd = sc.serviceData || {};
  const equip = safePath(stringify(getField(sd, ['Equipamento(s)', 'Equipamento'])) || 'Equipamento');
  const sys = safePath(stringify(getField(sd, ['Sistema'])) || 'Sistema');
  const photosDir = path.join(env.uploadDir, projectFolderName, 'Registros Fotográficos', 'RCPU');
  await fs.mkdir(photosDir, { recursive: true });

  const countUploads = (() => {
    const v = getField(sd, ['Foto do laudo do contador']);
    return Array.isArray(v) ? v : [];
  })();
  const humidUploads = (() => {
    const v = getField(sd, ['Fotos da desidratação', 'Fotos da desidratacao']);
    return Array.isArray(v) ? v : [];
  })();

  let count = 1;
  for (const upload of [...countUploads, ...humidUploads]) {
    const source = upload?.url || upload?.storagePath || upload?.fileName;
    const srcPath = resolveUploadFilePath(source);
    if (!srcPath) continue;
    const ext = path.extname(srcPath) || '.jpg';
    const destName = `${equip} - ${sys} - foto ${count}${ext}`;
    const destPath = path.join(photosDir, destName);
    if (path.resolve(srcPath) === path.resolve(destPath)) { count++; continue; }
    try {
      await fs.rename(srcPath, destPath);
      const newUrl = buildPhotoUrl(extractUrlBase(source), projectFolderName, 'RCPU', destName);
      if (source) urlMap.set(source, newUrl);
      count++;
    } catch { /* skip missing */ }
  }

  return urlMap;
}

// ── Main exports ──

export async function buildRcpDocx(report) {
  const sc = report.specialConditions || {};
  const sd = sc.serviceData || {};
  const serviceType = sc.serviceType || '';
  const collabs = sc.resolvedCollaborators || [];

  const baseData = buildRcpBaseData(report);
  const signatureAsset = await getUploadAsset(sc.__leaderSnapshot?.signatureImage || report.project?.operator?.signatureImage || report.createdBy?.collaborator?.signatureImage);

  const countUploads = (() => {
    const v = getField(sd, ['Foto do laudo do contador']);
    return Array.isArray(v) ? v : [];
  })();
  const humidUploads = (() => {
    const v = getField(sd, ['Fotos da desidratação', 'Fotos da desidratacao']);
    return Array.isArray(v) ? v : [];
  })();
  const countAssets = await resolvePhotoAssets(countUploads);
  const humidAssets = await resolvePhotoAssets(humidUploads);

  const bytes = await fs.readFile(rcpTemplatePath);
  const zip = new AdmZip(bytes);

  const headerEntries = zip.getEntries()
    .map(e => e.entryName)
    .filter(name => /^word\/header\d+\.xml$/i.test(name));

  headerEntries.forEach(name => {
    updateXmlEntry(zip, name, doc => replacePlaceholders(doc, baseData));
  });

  updateXmlEntry(zip, 'word/document.xml', doc => {
    replacePlaceholders(doc, baseData);
    expandTubeRows(doc, sd, serviceType);
    expandRcpCollaborators(doc, collabs);
    embedPhotos(zip, doc, '{{countphotos}}', countAssets);
    embedPhotos(zip, doc, '{{humidityphotos}}', humidAssets);
    embedSignature(zip, doc, signatureAsset);
  });

  headerEntries.concat(['word/document.xml']).forEach(name => {
    const entry = zip.getEntry(name);
    if (!entry) return;
    zip.updateFile(name, Buffer.from(clearRemainingPlaceholders(zip.readAsText(entry)), 'utf8'));
  });

  return zip.toBuffer();
}

export async function saveRcpDocx(report) {
  const bytes = await buildRcpDocx(report);
  const sc = report.specialConditions || {};
  const sd = sc.serviceData || {};
  const equip = safePath(stringify(getField(sd, ['Equipamento(s)', 'Equipamento'])) || 'Equipamento');
  const sys = safePath(stringify(getField(sd, ['Sistema'])) || 'Sistema');
  const serviceLabel = sc.serviceType === 'filtragem' ? 'Filtragem' : 'Flushing';
  const projectFolderName = safePath(`Missão ${report.project.code} - ${report.project.name}`);
  const dir = path.join(env.uploadDir, projectFolderName, 'RCPU');
  await fs.mkdir(dir, { recursive: true });
  const fileName = safePath(`Missão ${report.project.code} - ${report.project.name} - RCPU ${reportNumber(report)} - ${serviceLabel} - ${equip} - ${sys}.docx`);
  const targetPath = path.join(dir, fileName);
  await fs.writeFile(targetPath, bytes);
  return {
    fileName,
    targetPath,
    publicUrl: `/relatorios/${encodeURIComponent(projectFolderName)}/RCPU/${encodeURIComponent(fileName)}`
  };
}

export async function saveRcpPdf(report) {
  const docx = await saveRcpDocx(report);
  const pdfFileName = docx.fileName.replace(/\.docx$/i, '.pdf');
  const pdfPath = path.join(path.dirname(docx.targetPath), pdfFileName);
  await convertDocxToPdf(docx.targetPath, pdfPath);
  return {
    fileName: pdfFileName,
    targetPath: pdfPath,
    publicUrl: docx.publicUrl.replace(/\.docx$/i, '.pdf'),
  };
}
