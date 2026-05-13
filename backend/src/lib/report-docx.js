import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import AdmZip from 'adm-zip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

import env from '../config/env.js';
import { formatCnpj } from './cnpj.js';
import { buildReportFileName } from './report-filename.js';
import { readStoredImageAsset } from './stored-image.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const templatePath = path.resolve(__dirname, '../../../Modelos/definitivos/Modelo definitivo.docx');

const SERVICE_NAMES = {
  limpeza: 'Limpeza química',
  pressao: 'Teste de pressão',
  filtragem: 'Filtragem',
  flushing: 'Flushing',
  mecanica: 'Limpeza mecânica',
  inibicao: 'Flushing/Inibição'
};

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

function weekdayNamePt(value) {
  const ymd = toYMD(value);
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-');
  return new Date(`${y}-${m}-${d}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long' });
}

function safeText(value) {
  if (value == null) return '';
  return String(value);
}

function safePath(value) {
  return safeText(value).replace(/[<>:"/\\|?*\n\r]/g, '_').trim();
}

function formatDatePt(value) {
  const ymd = toYMD(value);
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

function formatMinutes(total) {
  const safe = Math.max(0, Number(total) || 0);
  const h = String(Math.floor(safe / 60)).padStart(2, '0');
  const m = String(safe % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function maybeMinutes(total) {
  const safe = Math.max(0, Number(total) || 0);
  return safe > 0 ? formatMinutes(safe) : '';
}

function reportNumber(report) {
  return typeof report.sequenceNumber === 'number'
    ? String(report.sequenceNumber)
    : '---';
}

function normalizeLabel(value) {
  const map = {
    'Material da tubulaÃ§Ã£o': 'Material da tubulação',
    'Material da tubulação': 'Material da tubulação',
    'Hora de inÃ­cio': 'Hora de início',
    'Hora de início': 'Hora de início',
    'Hora de tÃ©rmino/pausa': 'Hora de término/pausa',
    'Hora de término/pausa': 'Hora de término/pausa',
    'Colaboradores do serviÃ§o': 'Colaboradores do serviço',
    'Colaboradores do serviço': 'Colaboradores do serviço',
    'Equipamento(s)': 'Equipamento(s)',
    'ServiÃ§o finalizado?': 'Serviço finalizado?',
    'Serviço finalizado?': 'Serviço finalizado?',
    'Tipo de Ã³leo': 'Tipo de óleo',
    'Tipo de óleo': 'Tipo de óleo',
    'Volume de Ã³leo': 'Volume de óleo',
    'Volume de óleo': 'Volume de óleo',
    'PressÃ£o de trabalho': 'Pressão de trabalho',
    'Pressão de trabalho': 'Pressão de trabalho',
    'PressÃ£o de teste': 'Pressão de teste',
    'Pressão de teste': 'Pressão de teste',
    'ObservaÃ§Ãµes': 'Observações',
    'Observações': 'Observações',
    'ID da embarcaÃ§Ã£o': 'ID da embarcação',
    'ID da embarcação': 'ID da embarcação',
    'AnÃ¡lise inicial': 'Análise inicial',
    'Análise inicial': 'Análise inicial',
    'AnÃ¡lise final': 'Análise final',
    'Análise final': 'Análise final',
    'Etapas realizadas no dia': 'Etapas realizadas no dia'
  };
  return map[value] || value;
}

function canonicalizeLabel(value) {
  return normalizeLabel(String(value || ''))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s/()-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function getField(fields, names) {
  for (const name of names) {
    if (fields[name] != null && fields[name] !== '') return fields[name];
    const wanted = canonicalizeLabel(name);
    const found = Object.keys(fields).find(key => canonicalizeLabel(key) === wanted);
    if (found && fields[found] != null && fields[found] !== '') return fields[found];
  }
  return '';
}

export function stringifyReportDocxValue(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (typeof value === 'object') {
    for (const key of ['names', 'codes', 'labels', 'ids']) {
      if (Array.isArray(value[key])) return value[key].map(stringifyReportDocxValue).filter(Boolean).join(', ');
    }
    if (value.fileName) return stringifyReportDocxValue(value.fileName);
    if (value.name && value.role) return `${stringifyReportDocxValue(value.name)} - ${stringifyReportDocxValue(value.role)}`;
    if (value.name) return stringifyReportDocxValue(value.name);
    if (value.code) return stringifyReportDocxValue(value.code);
    return '';
  }
  return String(value);
}

function stringify(value) {
  return stringifyReportDocxValue(value);
}

function emptyWhenZero(value) {
  return value === '0' ? '' : value;
}

function particleAnalysisText(fields, stage) {
  const nas = stringify(getField(fields, [`Contagem ${stage} NAS`]));
  const iso = stringify(getField(fields, [`Contagem ${stage} ISO`]));
  const combined = [
    nas ? `NAS ${nas}` : '',
    iso ? `ISO ${iso}` : ''
  ].filter(Boolean).join(' | ');

  if (combined) return combined;

  return stringify(getField(fields, stage === 'inicial'
    ? ['Contagem inicial', 'Classe ISO inicial', 'NAS inicial']
    : ['Contagem final', 'Classe ISO final', 'NAS final']));
}

function buildCollaboratorRows(report) {
  const byName = new Map();
  (report.collaborators || []).forEach(link => {
    const name = link.collaborator?.name || '';
    if (!name) return;
    byName.set(name, {
      collaboratorname: name,
      collaboratorname0: name,
      collaboratorposition: link.collaborator?.role || '',
      shifts: new Set(['Diurno'])
    });
  });
  (((report.specialConditions || {}).noturnoDetails || {}).colaboradores || []).forEach(name => {
    if (!name) return;
    const existing = byName.get(name);
    if (existing) {
      existing.shifts.add('Noturno');
    } else {
      byName.set(name, {
        collaboratorname: name,
        collaboratorname0: name,
        collaboratorposition: '',
        shifts: new Set(['Noturno'])
      });
    }
  });
  return Array.from(byName.values()).map(item => ({
    collaboratorname: item.collaboratorname,
    collaboratorname0: item.collaboratorname0,
    collaboratorposition: item.collaboratorposition,
    collaboratorshift: item.shifts.size === 2 ? 'Diurno e Noturno' : Array.from(item.shifts)[0]
  }));
}

function serviceTemplateData(service, index) {
  const fields = service.extraData || {};
  const common = {
    servicecount: String(index + 1),
    servicename: SERVICE_NAMES[service.serviceType] || service.serviceType,
    equipament: stringify(getField(fields, ['Equipamento(s)', 'Equipamento', 'ID da embarcação'])),
    system: stringify(getField(fields, ['Sistema'])),
    starttime: stringify(getField(fields, ['Hora de início'])),
    endtime: stringify(getField(fields, ['Hora de término/pausa'])),
    status: service.finalized === true ? 'Finalizado' : (service.finalized === false ? 'Em andamento' : ''),
    servicecollaborators: stringify(getField(fields, ['Colaboradores do serviço'])),
    steps: stringify(getField(fields, ['Etapas realizadas no dia'])),
    obs: stringify(getField(fields, ['Observações', 'OBS.', 'Desenho/observações']))
  };

  switch (service.serviceType) {
    case 'pressao':
      return {
        ...common,
        statementone: 'Pressão de trabalho',
        statementdataone: stringify(getField(fields, ['Pressão de trabalho'])),
        statementtwo: 'Pressão de teste',
        statementdatatwo: stringify(getField(fields, ['Pressão de teste'])),
        infostatement: 'Fluido',
        info: stringify(getField(fields, ['Fluido de teste']))
      };
    case 'limpeza':
      return {
        ...common,
        statementone: 'Material da tubulação',
        statementdataone: stringify(getField(fields, ['Material da tubulação'])),
        statementtwo: '',
        statementdatatwo: '',
        infostatement: '',
        info: ''
      };
    case 'flushing':
      return {
        ...common,
        statementone: 'Análise inicial',
        statementdataone: particleAnalysisText(fields, 'inicial'),
        statementtwo: 'Análise final',
        statementdatatwo: particleAnalysisText(fields, 'final'),
        infostatement: 'Óleo',
        info: stringify(getField(fields, ['Tipo de óleo'])),
      };
    case 'filtragem':
      return {
        ...common,
        statementone: 'Análise inicial',
        statementdataone: particleAnalysisText(fields, 'inicial'),
        statementtwo: 'Análise final',
        statementdatatwo: particleAnalysisText(fields, 'final'),
        infostatement: 'Volume de óleo',
        info: stringify(getField(fields, ['Volume de óleo'])),
      };
    case 'mecanica':
      return {
        ...common,
        statementone: 'Material do equipamento',
        statementdataone: stringify(getField(fields, ['Material do equipamento'])),
        statementtwo: '',
        statementdatatwo: '',
        infostatement: '',
        info: ''
      };
    case 'inibicao':
      return {
        ...common,
        servicename: 'Flushing/Inibição',
        equipament: stringify(getField(fields, ['ID da embarcação'])),
        statementone: 'Material da tubulação',
        statementdataone: stringify(getField(fields, ['Material da tubulação'])),
        statementtwo: '',
        statementdatatwo: '',
        infostatement: '',
        info: ''
      };
    default:
      return {
        ...common,
        statementone: '',
        statementdataone: '',
        statementtwo: '',
        statementdatatwo: '',
        infostatement: '',
        info: ''
      };
  }
}

function getTextNodes(node, out = []) {
  if (!node) return out;
  if (node.nodeType === 3) out.push(node);
  for (let child = node.firstChild; child; child = child.nextSibling) getTextNodes(child, out);
  return out;
}

function elementText(element) {
  return getTextNodes(element).map(node => node.data || '').join('');
}

function replaceTokenInElement(element, token, replacement) {
  const nodes = getTextNodes(element);
  let full = nodes.map(node => node.data || '').join('');
  let idx = full.indexOf(token);

  while (idx >= 0) {
    const end = idx + token.length;
    let offset = 0;
    let firstHit = true;

    for (const node of nodes) {
      const text = node.data || '';
      const startPos = offset;
      const endPos = offset + text.length;
      const overlapStart = Math.max(startPos, idx);
      const overlapEnd = Math.min(endPos, end);

      if (overlapStart < overlapEnd) {
        const localStart = overlapStart - startPos;
        const localEnd = overlapEnd - startPos;
        const prefix = text.slice(0, localStart);
        const suffix = text.slice(localEnd);
        node.data = firstHit ? `${prefix}${replacement}${suffix}` : `${prefix}${suffix}`;
        firstHit = false;
      }
      offset = endPos;
    }

    full = nodes.map(node => node.data || '').join('');
    idx = full.indexOf(token);
  }
}

function replacePlaceholders(element, values) {
  Object.entries(values).forEach(([key, value]) => {
    const safe = safeText(value);
    [
      `{{${key}}}`,
      `{{ ${key} }}`,
      `{{${key} }}`,
      `{{ ${key}}}`
    ].forEach(token => replaceTokenInElement(element, token, safe));
  });
  preserveWordTextLineBreaks(element);
}

function preserveWordTextLineBreaks(element) {
  const textNodes = Array.from(element.getElementsByTagName('w:t'));
  textNodes.forEach(node => {
    const content = node.textContent || '';
    if (!/[\r\n]/.test(content)) return;
    const doc = node.ownerDocument;
    const parent = node.parentNode;
    const lines = content.split(/\r\n|\r|\n/);
    lines.forEach((line, index) => {
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
  const nodes = Array.from(root.getElementsByTagName(tagName));
  return nodes.find(node => elementText(node).includes(token)) || null;
}

function removeNode(node) {
  if (node && node.parentNode) node.parentNode.removeChild(node);
}

function setParagraphText(doc, paragraph, text) {
  if (!paragraph) return;
  const content = String(text || '');
  let pPr = null;
  for (let child = paragraph.firstChild; child; child = child.nextSibling) {
    if (child.nodeName === 'w:pPr') {
      pPr = child.cloneNode(true);
      break;
    }
  }
  while (paragraph.firstChild) paragraph.removeChild(paragraph.firstChild);
  if (pPr) paragraph.appendChild(pPr);

  const lines = content.split(/\r\n|\r|\n/);
  const run = doc.createElement('w:r');
  lines.forEach((line, index) => {
    if (index > 0) run.appendChild(doc.createElement('w:br'));
    const textNode = doc.createElement('w:t');
    if (/^\s|\s$/.test(line)) textNode.setAttribute('xml:space', 'preserve');
    textNode.appendChild(doc.createTextNode(line));
    run.appendChild(textNode);
  });
  paragraph.appendChild(run);
}

function setPlaceholderCellParagraphs(doc, token, text) {
  const paragraph = findFirstByText(doc, 'w:p', token);
  if (!paragraph) return;
  const cell = paragraph.parentNode?.nodeName === 'w:tc' ? paragraph.parentNode : null;
  if (!cell) {
    setParagraphText(doc, paragraph, text);
    return;
  }

  let pPr = null;
  let rPr = null;
  for (let child = paragraph.firstChild; child; child = child.nextSibling) {
    if (child.nodeName === 'w:pPr') pPr = child.cloneNode(true);
    if (!rPr && child.nodeName === 'w:r') {
      for (let runChild = child.firstChild; runChild; runChild = runChild.nextSibling) {
        if (runChild.nodeName === 'w:rPr') {
          rPr = runChild.cloneNode(true);
          break;
        }
      }
    }
  }

  const lines = String(text || '').split(/\r\n|\r|\n/);
  lines.forEach(line => {
    const newParagraph = doc.createElement('w:p');
    if (pPr) newParagraph.appendChild(pPr.cloneNode(true));
    const run = doc.createElement('w:r');
    if (rPr) run.appendChild(rPr.cloneNode(true));
    const textNode = doc.createElement('w:t');
    if (/^\s|\s$/.test(line)) textNode.setAttribute('xml:space', 'preserve');
    textNode.appendChild(doc.createTextNode(line));
    run.appendChild(textNode);
    newParagraph.appendChild(run);
    cell.insertBefore(newParagraph, paragraph);
  });
  cell.removeChild(paragraph);
}

function cloneBefore(node, clones) {
  const parent = node.parentNode;
  clones.forEach(clone => parent.insertBefore(clone, node));
}

function buildDocxData(report) {
  const special = report.specialConditions || {};
  const night = special.noturnoDetails || {};
  const standby = special.standbyDetails || {};
  const hasNight = !!special.noturno;
  const primaryService = (report.services || [])[0] || null;
  const primaryFields = (primaryService && primaryService.extraData) || {};
  const leaderSnapshot = report.specialConditions?.__leaderSnapshot || null;
  const projectLeader = leaderSnapshot || report.project?.operator || {};
  return {
    missiontitle: `Missão ${report.project.code} - ${report.project.name}`,
    client: report.project.clientName || '',
    cnpj: formatCnpj(report.project.clientCnpj) || '',
    local: report.project.location || '',
    proposal: report.project.contractCode || '',
    rdo: reportNumber(report),
    date: formatDatePt(report.reportDate),
    daystarttime: report.arrivalTime || '',
    dayexittime: report.departureTime || '',
    lunchinterval: report.lunchBreak || '',
    daycollaboratorscount: String(report.daytimeCount || (report.collaborators || []).length || 0),
    nightstarttime: hasNight ? (night.inicio || '') : '',
    nightexittime: hasNight ? (night.termino || '') : '',
    dinnerinterval: hasNight ? (night.intervalo || '') : '',
    nightcollaboratoscount: hasNight ? emptyWhenZero(String((night.colaboradores || []).length || 0)) : '',
    nightcollaboratorscount: hasNight ? emptyWhenZero(String((night.colaboradores || []).length || 0)) : '',
    dayovertime: maybeMinutes(report.daytimeOvertimeMinutes || 0),
    nightovertime: maybeMinutes(report.nighttimeOvertimeMinutes || 0),
    standby: standby.total || '',
    overtimecomment: report.overtimeReason || '',
    standbymotive: standby.motivo || '',
    activities: report.dailyDescription || '',
    system: stringify(getField(primaryFields, ['Sistema'])) || primaryService?.system || '',
    leadername: projectLeader.name || report.createdBy?.collaborator?.name || report.createdBy?.name || '',
    leaderposition: projectLeader.role || report.createdBy?.collaborator?.role || ''
  };
}

function ensureContentType(zip, extension, mimeType) {
  const entry = zip.getEntry('[Content_Types].xml');
  if (!entry) return;
  const doc = new DOMParser().parseFromString(zip.readAsText(entry), 'text/xml');
  const types = doc.documentElement;
  const defaults = Array.from(types.getElementsByTagName('Default'));
  const exists = defaults.some(node => String(node.getAttribute('Extension') || '').toLowerCase() === extension.toLowerCase());
  if (!exists) {
    const node = doc.createElement('Default');
    node.setAttribute('Extension', extension.toLowerCase());
    node.setAttribute('ContentType', mimeType);
    types.appendChild(node);
    zip.updateFile('[Content_Types].xml', Buffer.from(new XMLSerializer().serializeToString(doc), 'utf8'));
  }
}

function parsePngSize(buffer) {
  if (buffer.length < 24) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function parseJpegSize(buffer) {
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xFF) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const size = buffer.readUInt16BE(offset + 2);
    if ([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF].includes(marker)) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7)
      };
    }
    offset += 2 + size;
  }
  return null;
}

function parseGifSize(buffer) {
  if (buffer.length < 10) return null;
  return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
}

function getImageMeta(buffer, fileName) {
  const ext = path.extname(fileName || '').toLowerCase();
  if (ext === '.png') return { ...parsePngSize(buffer), extension: 'png', mimeType: 'image/png' };
  if (ext === '.jpg' || ext === '.jpeg') return { ...parseJpegSize(buffer), extension: 'jpeg', mimeType: 'image/jpeg' };
  if (ext === '.gif') return { ...parseGifSize(buffer), extension: 'gif', mimeType: 'image/gif' };
  return { width: 100, height: 40, extension: ext.replace('.', '') || 'png', mimeType: 'image/png' };
}

function nextRelationshipId(relsDoc) {
  const rels = Array.from(relsDoc.getElementsByTagName('Relationship'));
  let max = 0;
  rels.forEach(node => {
    const id = String(node.getAttribute('Id') || '');
    const match = id.match(/^rId(\d+)$/);
    if (match) max = Math.max(max, Number(match[1]));
  });
  return `rId${max + 1}`;
}

async function getSignatureAsset(report) {
  const source = report.specialConditions?.__leaderSnapshot?.signatureImage
    || report.project?.operator?.signatureImage
    || report.createdBy?.collaborator?.signatureImage;
  return getUploadAsset(source);
}

async function getUploadAsset(source) {
  return readStoredImageAsset(source);
}

function buildSignatureDrawingXml(relId, cx, cy) {
  return `
    <w:r xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
      <w:drawing>
        <wp:inline distT="0" distB="0" distL="0" distR="0">
          <wp:extent cx="${cx}" cy="${cy}"/>
          <wp:effectExtent l="0" t="0" r="0" b="0"/>
          <wp:docPr id="5000" name="Assinatura"/>
          <wp:cNvGraphicFramePr/>
          <a:graphic>
            <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
              <pic:pic>
                <pic:nvPicPr>
                  <pic:cNvPr id="0" name="Assinatura"/>
                  <pic:cNvPicPr/>
                </pic:nvPicPr>
                <pic:blipFill>
                  <a:blip r:embed="${relId}"/>
                  <a:stretch><a:fillRect/></a:stretch>
                </pic:blipFill>
                <pic:spPr>
                  <a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>
                  <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                </pic:spPr>
              </pic:pic>
            </a:graphicData>
          </a:graphic>
        </wp:inline>
      </w:drawing>
    </w:r>
  `;
}

function buildInlineImageDrawingXml(relId, cx, cy, name) {
  return `
    <w:r xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
      <w:drawing>
        <wp:inline distT="0" distB="0" distL="0" distR="0">
          <wp:extent cx="${cx}" cy="${cy}"/>
          <wp:effectExtent l="0" t="0" r="0" b="0"/>
          <wp:docPr id="5001" name="${safeText(name || 'Foto')}"/>
          <wp:cNvGraphicFramePr/>
          <a:graphic>
            <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
              <pic:pic>
                <pic:nvPicPr>
                  <pic:cNvPr id="0" name="${safeText(name || 'Foto')}"/>
                  <pic:cNvPicPr/>
                </pic:nvPicPr>
                <pic:blipFill>
                  <a:blip r:embed="${relId}"/>
                  <a:stretch><a:fillRect/></a:stretch>
                </pic:blipFill>
                <pic:spPr>
                  <a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>
                  <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                </pic:spPr>
              </pic:pic>
            </a:graphicData>
          </a:graphic>
        </wp:inline>
      </w:drawing>
    </w:r>
  `;
}

function embedSignature(zip, doc, asset) {
  if (!asset) return;
  const targetParagraph = findFirstByText(doc, 'w:p', '{{sign}}');
  if (!targetParagraph) return;

  const relsEntry = zip.getEntry('word/_rels/document.xml.rels');
  if (!relsEntry) return;
  const relsDoc = new DOMParser().parseFromString(zip.readAsText(relsEntry), 'text/xml');
  const relId = nextRelationshipId(relsDoc);
  const mediaName = `signature-${Date.now()}.${asset.extension}`;
  const mediaPath = `word/media/${mediaName}`;

  zip.addFile(mediaPath, asset.bytes);
  ensureContentType(zip, asset.extension, asset.mimeType);

  const relNode = relsDoc.createElement('Relationship');
  relNode.setAttribute('Id', relId);
  relNode.setAttribute('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image');
  relNode.setAttribute('Target', `media/${mediaName}`);
  relsDoc.documentElement.appendChild(relNode);
  zip.updateFile('word/_rels/document.xml.rels', Buffer.from(new XMLSerializer().serializeToString(relsDoc), 'utf8'));

  while (targetParagraph.firstChild) targetParagraph.removeChild(targetParagraph.firstChild);
  const widthEmu = 952500;
  const heightEmu = Math.max(1, Math.round(widthEmu * (asset.height / asset.width)));
  const drawingDoc = new DOMParser().parseFromString(buildSignatureDrawingXml(relId, widthEmu, heightEmu), 'text/xml');
  targetParagraph.appendChild(drawingDoc.documentElement);
}

function createImageRelationship(zip, relsDoc, asset, prefix = 'image') {
  const relId = nextRelationshipId(relsDoc);
  const mediaName = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${asset.extension}`;
  const mediaPath = `word/media/${mediaName}`;

  zip.addFile(mediaPath, asset.bytes);
  ensureContentType(zip, asset.extension, asset.mimeType);

  const relNode = relsDoc.createElement('Relationship');
  relNode.setAttribute('Id', relId);
  relNode.setAttribute('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image');
  relNode.setAttribute('Target', `media/${mediaName}`);
  relsDoc.documentElement.appendChild(relNode);
  return relId;
}

async function getGeneralPhotoAssets(report) {
  const uploads = (((report.specialConditions || {}).generalUploads) || []).filter(Boolean);
  const assets = [];
  for (const upload of uploads) {
    const source = upload?.url || upload?.storagePath || upload?.fileName;
    const asset = await getUploadAsset(source);
    if (asset) assets.push({ ...asset, label: upload?.label || upload?.fileName || 'Foto' });
  }
  return assets;
}

function embedGeneralPhotos(zip, doc, assets) {
  const table = findFirstByText(doc, 'w:tbl', '{{photos}}');
  if (!table) return;
  if (!assets.length) {
    removeNode(table);
    return;
  }

  const targetParagraph = findFirstByText(table, 'w:p', '{{photos}}');
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
    const jc = doc.createElement('w:jc');
    jc.setAttribute('w:val', 'center');
    pPr.appendChild(jc);
    paragraph.appendChild(pPr);

    group.forEach((asset, index) => {
      const relId = createImageRelationship(zip, relsDoc, asset, 'report-photo');
      const heightEmu = Math.max(1, Math.round(maxWidthEmu * (asset.height / asset.width)));
      const drawingDoc = new DOMParser().parseFromString(
        buildInlineImageDrawingXml(relId, maxWidthEmu, heightEmu, asset.label),
        'text/xml'
      );
      paragraph.appendChild(drawingDoc.documentElement);
      if (index < group.length - 1) {
        const spacerRun = doc.createElement('w:r');
        const spacerText = doc.createElement('w:t');
        spacerText.appendChild(doc.createTextNode('   '));
        spacerRun.appendChild(spacerText);
        paragraph.appendChild(spacerRun);
      }
    });

    cell.appendChild(paragraph);
  }

  zip.updateFile('word/_rels/document.xml.rels', Buffer.from(new XMLSerializer().serializeToString(relsDoc), 'utf8'));
}

function expandCollaborators(doc, report) {
  const templateRow = findFirstByText(doc, 'w:tr', '{{collaboratorname}}')
    || findFirstByText(doc, 'w:tr', '{{collaboratorname0}}');
  if (!templateRow) return;
  const collaborators = buildCollaboratorRows(report);

  if (!collaborators.length) {
    replacePlaceholders(templateRow, {
      collaboratorname: '',
      collaboratorname0: '',
      collaboratorposition: '',
      collaboratorshift: ''
    });
    return;
  }

  const clones = collaborators.map(item => {
    const clone = templateRow.cloneNode(true);
    replacePlaceholders(clone, item);
    return clone;
  });
  cloneBefore(templateRow, clones);
  removeNode(templateRow);
}

function expandServices(doc, report) {
  const templateTable = findFirstByText(doc, 'w:tbl', '{{servicecount}}');
  if (!templateTable) return;
  const services = (report.services || []).map((service, index) => {
    const item = serviceTemplateData(service, index);
    ['statementone', 'statementtwo', 'infostatement'].forEach(key => {
      if (item[key] && !String(item[key]).trim().endsWith(':')) item[key] = `${item[key]}:`;
    });
    return item;
  });

  if (!services.length) {
    const parent = templateTable.parentNode;
    if (parent) {
      const para = doc.createElement('w:p');
      const run = doc.createElement('w:r');
      const text = doc.createElement('w:t');
      text.appendChild(doc.createTextNode('Não há serviços adicionados.'));
      run.appendChild(text);
      para.appendChild(run);
      parent.insertBefore(para, templateTable);
    }
    removeNode(templateTable);
    return;
  }

  const clones = services.map(item => {
    const clone = templateTable.cloneNode(true);
    replacePlaceholders(clone, item);
    return clone;
  });
  cloneBefore(templateTable, clones);
  removeNode(templateTable);
}

function applyClientNotesTable(doc, report) {
  const table = findFirstByText(doc, 'w:tbl', 'Notas do cliente:');
  if (!table) return;

  const approvedReview = ((report.clientReviews || []).find(item => item.action === 'APPROVED')) || null;
  const comment = String(approvedReview?.comment || '').trim();
  if (!comment) {
    removeNode(table);
    return;
  }

  const rows = Array.from(table.getElementsByTagName('w:tr'));
  const noteRow = rows[1] || null;
  if (!noteRow) return;
  const cell = noteRow.getElementsByTagName('w:tc')[0] || null;
  if (!cell) return;
  const paragraph = cell.getElementsByTagName('w:p')[0] || null;
  if (!paragraph) return;
  setParagraphText(doc, paragraph, comment);
}

async function buildTemplateZip() {
  const bytes = await fs.readFile(templatePath);
  return new AdmZip(bytes);
}

function updateXmlEntry(zip, entryName, transform) {
  const entry = zip.getEntry(entryName);
  if (!entry) return;
  const xml = zip.readAsText(entry);
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');
  transform(doc);
  const out = new XMLSerializer().serializeToString(doc);
  zip.updateFile(entryName, Buffer.from(out, 'utf8'));
}

function clearRemainingPlaceholders(xml) {
  return xml.replace(/\{\{[^}]+\}\}/g, '');
}

export async function buildReportDocx(report) {
  const zip = await buildTemplateZip();
  const baseData = buildDocxData(report);
  const signatureAsset = await getSignatureAsset(report);
  const generalPhotoAssets = await getGeneralPhotoAssets(report);
  const headerEntries = zip.getEntries()
    .map(entry => entry.entryName)
    .filter(name => /^word\/header\d+\.xml$/i.test(name));

  headerEntries.forEach(entryName => {
    updateXmlEntry(zip, entryName, doc => {
      replacePlaceholders(doc, baseData);
    });
  });

  updateXmlEntry(zip, 'word/document.xml', doc => {
    setPlaceholderCellParagraphs(doc, '{{activities}}', baseData.activities);
    replacePlaceholders(doc, baseData);
    expandCollaborators(doc, report);
    expandServices(doc, report);
    replacePlaceholders(doc, baseData);
    applyClientNotesTable(doc, report);
    embedGeneralPhotos(zip, doc, generalPhotoAssets);
    embedSignature(zip, doc, signatureAsset);
  });

  headerEntries.concat(['word/document.xml']).forEach(entryName => {
    const entry = zip.getEntry(entryName);
    if (!entry) return;
    zip.updateFile(entryName, Buffer.from(clearRemainingPlaceholders(zip.readAsText(entry)), 'utf8'));
  });

  return zip.toBuffer();
}

function resolveUploadSourcePath(source) {
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
  } catch {
    return null;
  }
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

export async function organizePhotos(report, projectFolderName) {
  const urlMap = new Map();
  const dateStr = formatDatePt(report.reportDate).replace(/\//g, '-');
  const rdoNum = reportNumber(report);
  const reportType = report.reportType;
  const photosDir = path.join(env.uploadDir, projectFolderName, 'Registros Fotográficos', reportType);
  await fs.mkdir(photosDir, { recursive: true });

  // General uploads (RDO photos)
  const generalUploads = (((report.specialConditions || {}).generalUploads) || []).filter(Boolean);
  let count = 1;
  for (const upload of generalUploads) {
    const source = upload?.url || upload?.storagePath || upload?.fileName;
    const srcPath = resolveUploadSourcePath(source);
    if (!srcPath) continue;
    const ext = path.extname(srcPath) || '.jpg';
    const destName = `${reportType} ${rdoNum} - ${dateStr} - foto ${count}${ext}`;
    try {
      await fs.rename(srcPath, path.join(photosDir, destName));
      const newUrl = buildPhotoUrl(extractUrlBase(source), projectFolderName, reportType, destName);
      if (source) urlMap.set(source, newUrl);
      count++;
    } catch { /* skip missing */ }
  }

  // Service attachment photos
  for (const service of (report.services || [])) {
    const fields = service.extraData || {};
    const equipment = safePath(stringify(getField(fields, ['Equipamento(s)', 'Equipamento', 'ID da embarcação'])) || 'Equipamento');
    const system = safePath(service.system || stringify(getField(fields, ['Sistema'])) || 'Sistema');
    let svcCount = 1;
    for (const attachment of (service.attachments || [])) {
      const source = attachment?.url || attachment?.storagePath || attachment?.fileName;
      const srcPath = resolveUploadSourcePath(source);
      if (!srcPath) continue;
      const ext = path.extname(srcPath) || '.jpg';
      const destName = `${equipment} - ${system} - ${dateStr} - foto ${svcCount}${ext}`;
      try {
        await fs.rename(srcPath, path.join(photosDir, destName));
        const newUrl = buildPhotoUrl(extractUrlBase(source), projectFolderName, reportType, destName);
        if (source) urlMap.set(source, newUrl);
        svcCount++;
      } catch { /* skip missing */ }
    }
  }

  return urlMap;
}

export async function saveReportDocx(report) {
  const bytes = await buildReportDocx(report);
  const projectFolderName = safePath(`Missão ${report.project.code} - ${report.project.name}`);
  const dir = path.join(env.uploadDir, projectFolderName, report.reportType);
  await fs.mkdir(dir, { recursive: true });
  const fileName = buildReportFileName(report, 'docx');
  const targetPath = path.join(dir, fileName);
  await fs.writeFile(targetPath, bytes);
  return {
    fileName,
    targetPath,
    publicUrl: `/relatorios/${encodeURIComponent(projectFolderName)}/${report.reportType}/${encodeURIComponent(fileName)}`
  };
}
