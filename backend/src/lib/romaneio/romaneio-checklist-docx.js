import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import AdmZip from 'adm-zip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

import env from '../../config/env.js';
import { checklistItemStatusFromSnapshot } from '../equipamentos/equipment-checklist.js';
import { convertDocxToPdf } from '../report-pdf-from-docx.js';
import { parseSignatureImageDataUrl } from '../signatures/common.js';
import { formatDateOnly } from '../../../../shared/modules/date-only.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const templatePath = path.resolve(__dirname, '../../../../Modelos/definitivos/Checklist.docx');
const CHECKLIST_STATUS_LABELS = {
  CONFORME: 'CONFORME',
  NAO_CONFORME: 'NÃO CONFORME',
  NAO_APLICAVEL: 'NÃO APLICÁVEL'
};
const CHECKLIST_STATUS_COLORS = {
  CONFORME: '00B050',
  NAO_CONFORME: 'FF0000',
  NAO_APLICAVEL: '808080'
};

function safeText(value) {
  if (value == null) return '';
  return String(value);
}

function safePath(value) {
  return safeText(value).replace(/[<>:"/\\|?*\n\r]/g, '_').trim();
}

function formatDatePt(value) {
  return formatDateOnly(value, '');
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
    replaceTokenInElement(element, `<<${key}>>`, safeText(value));
  });
}

function findFirstByText(root, tagName, token) {
  const nodes = Array.from(root.getElementsByTagName(tagName));
  return nodes.find(node => elementText(node).includes(token)) || null;
}

function removeNode(node) {
  if (node?.parentNode) node.parentNode.removeChild(node);
}

function cloneBefore(node, clones) {
  const parent = node.parentNode;
  clones.forEach(clone => parent.insertBefore(clone, node));
}

function ensureRunColor(run, color) {
  if (!run) return;
  const doc = run.ownerDocument;
  let rPr = null;
  for (let child = run.firstChild; child; child = child.nextSibling) {
    if (child.nodeName === 'w:rPr') {
      rPr = child;
      break;
    }
  }
  if (!rPr) {
    rPr = doc.createElement('w:rPr');
    run.insertBefore(rPr, run.firstChild);
  }

  let colorNode = null;
  for (let child = rPr.firstChild; child; child = child.nextSibling) {
    if (child.nodeName === 'w:color') {
      colorNode = child;
      break;
    }
  }
  if (!colorNode) {
    colorNode = doc.createElement('w:color');
    rPr.appendChild(colorNode);
  }
  colorNode.setAttribute('w:val', color);
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

function imageMeta(parsed) {
  const size = parsed.mimeType === 'image/png' ? parsePngSize(parsed.bytes) : parseJpegSize(parsed.bytes);
  return {
    bytes: parsed.bytes,
    extension: parsed.mimeType === 'image/png' ? 'png' : 'jpeg',
    mimeType: parsed.mimeType,
    width: size?.width || parsed.width || 360,
    height: size?.height || parsed.height || 120
  };
}

function ensureContentType(zip, extension, mimeType) {
  const entry = zip.getEntry('[Content_Types].xml');
  if (!entry) return;
  const doc = new DOMParser().parseFromString(zip.readAsText(entry), 'text/xml');
  const defaults = Array.from(doc.getElementsByTagName('Default'));
  const exists = defaults.some(node => String(node.getAttribute('Extension') || '').toLowerCase() === extension);
  if (exists) return;
  const node = doc.createElement('Default');
  node.setAttribute('Extension', extension);
  node.setAttribute('ContentType', mimeType);
  doc.documentElement.appendChild(node);
  zip.updateFile('[Content_Types].xml', Buffer.from(new XMLSerializer().serializeToString(doc), 'utf8'));
}

function nextRelationshipId(relsDoc) {
  const rels = Array.from(relsDoc.getElementsByTagName('Relationship'));
  let max = 0;
  rels.forEach(node => {
    const match = String(node.getAttribute('Id') || '').match(/^rId(\d+)$/);
    if (match) max = Math.max(max, Number(match[1]));
  });
  return `rId${max + 1}`;
}

function createImageRelationship(zip, relsDoc, asset) {
  const relId = nextRelationshipId(relsDoc);
  const mediaName = `checklist-signature-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${asset.extension}`;
  zip.addFile(`word/media/${mediaName}`, asset.bytes);
  ensureContentType(zip, asset.extension, asset.mimeType);
  const relNode = relsDoc.createElement('Relationship');
  relNode.setAttribute('Id', relId);
  relNode.setAttribute('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image');
  relNode.setAttribute('Target', `media/${mediaName}`);
  relsDoc.documentElement.appendChild(relNode);
  return relId;
}

function drawingXml(relId, cx, cy) {
  return `
    <w:r xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
      <w:drawing>
        <wp:inline distT="0" distB="0" distL="0" distR="0">
          <wp:extent cx="${cx}" cy="${cy}"/>
          <wp:effectExtent l="0" t="0" r="0" b="0"/>
          <wp:docPr id="7100" name="Assinatura Checklist"/>
          <wp:cNvGraphicFramePr/>
          <a:graphic>
            <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
              <pic:pic>
                <pic:nvPicPr><pic:cNvPr id="0" name="Assinatura Checklist"/><pic:cNvPicPr/></pic:nvPicPr>
                <pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
                <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
              </pic:pic>
            </a:graphicData>
          </a:graphic>
        </wp:inline>
      </w:drawing>
    </w:r>
  `;
}

function setParagraphToSignature(zip, relsDoc, paragraph, signatureImage, maxWidthEmu = 1050000) {
  if (!paragraph) return;
  const parsed = parseSignatureImageDataUrl(signatureImage);
  if (!parsed || !relsDoc) {
    replaceTokenInElement(paragraph, '<<assinatura>>', '');
    return;
  }
  const asset = imageMeta(parsed);
  const relId = createImageRelationship(zip, relsDoc, asset);
  const heightEmu = Math.max(1, Math.round(maxWidthEmu * (asset.height / asset.width)));
  replaceTokenInElement(paragraph, '<<assinatura>>', '');
  const drawingDoc = new DOMParser().parseFromString(drawingXml(relId, maxWidthEmu, heightEmu), 'text/xml');
  paragraph.appendChild(drawingDoc.documentElement);
}

function populateChecklistRows(doc, checklist) {
  const templateRow = findFirstByText(doc, 'w:tr', '<<item>>') || findFirstByText(doc, 'w:tr', '<<status>>');
  const items = Array.isArray(checklist.items) ? checklist.items : [];
  if (!templateRow) return;

  if (!items.length) {
    replacePlaceholders(templateRow, { item: '', status: '' });
    return;
  }

  const rows = items.map(item => {
    const clone = templateRow.cloneNode(true);
    const status = checklistItemStatusFromSnapshot(item);
    const statusRun = findFirstByText(clone, 'w:r', '<<status>>');
    ensureRunColor(statusRun, CHECKLIST_STATUS_COLORS[status]);
    replacePlaceholders(clone, {
      item: item?.text || '',
      status: CHECKLIST_STATUS_LABELS[status]
    });
    return clone;
  });
  cloneBefore(templateRow, rows);
  removeNode(templateRow);
}

function checklistSnapshots(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

function findChecklistTemplateTable(doc) {
  const tables = Array.from(doc.getElementsByTagName('w:tbl'));
  return tables.find(table => {
    const text = elementText(table);
    return text.includes('<<categoria>>')
      && text.includes('<<nomeoutag>>')
      && (text.includes('<<item>>') || text.includes('<<status>>'));
  }) || findFirstByText(doc, 'w:tbl', '<<item>>') || findFirstByText(doc, 'w:tbl', '<<status>>');
}

function checklistDisplayValue(checklist) {
  return safeText(checklist?.displayNameOrTag || checklist?.equipmentCode || checklist?.equipmentName);
}

function populateChecklistTable(table, checklist) {
  replacePlaceholders(table, {
    categoria: checklist?.categoryName || '',
    nomeoutag: checklistDisplayValue(checklist)
  });
  populateChecklistRows(table, checklist);
}

function populateChecklistTables(doc, checklists) {
  const templateTable = findChecklistTemplateTable(doc);
  const snapshots = checklistSnapshots(checklists);
  if (!templateTable) return;

  if (!snapshots.length) {
    replacePlaceholders(templateTable, {
      categoria: '',
      nomeoutag: '',
      item: '',
      status: ''
    });
    return;
  }

  const tables = snapshots.map(checklist => {
    const clone = templateTable.cloneNode(true);
    populateChecklistTable(clone, checklist);
    return clone;
  });
  cloneBefore(templateTable, tables);
  removeNode(templateTable);
}

export function buildChecklistProjectLabel(romaneio) {
  const project = romaneio?.project || {};
  const code = safeText(project.code).trim();
  const name = safeText(project.name).trim();
  return [code, name].filter(Boolean).join(' - ');
}

export function buildChecklistFileName(romaneio) {
  const projectCode = safePath(romaneio?.project?.code || '');
  const datePart = formatDatePt(romaneio?.romaneioDate).replace(/\//g, '-');
  return safePath(`Checklist - Missão ${projectCode} - ${datePart}`) + '.pdf';
}

export function shouldRegenerateChecklistPdf(document, romaneio) {
  const recordedLabel = document?.checklistProjectLabel ?? document?.projectLabel;
  return safeText(recordedLabel).trim() !== buildChecklistProjectLabel(romaneio);
}

export async function buildRomaneioChecklistDocx(romaneio, checklists = romaneio?.checklists || []) {
  const buffer = await fs.readFile(templatePath);
  const zip = new AdmZip(buffer);
  const relsEntry = zip.getEntry('word/_rels/document.xml.rels');
  const relsDoc = relsEntry
    ? new DOMParser().parseFromString(zip.readAsText(relsEntry), 'text/xml')
    : null;
  const entry = zip.getEntry('word/document.xml');
  const doc = new DOMParser().parseFromString(zip.readAsText(entry), 'application/xml');
  const snapshots = checklistSnapshots(checklists);

  replacePlaceholders(doc, {
    projeto: buildChecklistProjectLabel(romaneio),
    data: formatDatePt(romaneio.romaneioDate),
    responsavel: romaneio.checklistResponsibleName || ''
  });
  populateChecklistTables(doc, snapshots);
  setParagraphToSignature(zip, relsDoc, findFirstByText(doc, 'w:p', '<<assinatura>>'), romaneio.checklistSignatureImage || '');
  replaceTokenInElement(doc, '<<assinatura>>', '');

  zip.updateFile('word/document.xml', Buffer.from(new XMLSerializer().serializeToString(doc), 'utf8'));
  if (relsDoc) {
    zip.updateFile('word/_rels/document.xml.rels', Buffer.from(new XMLSerializer().serializeToString(relsDoc), 'utf8'));
  }
  return zip.toBuffer();
}

export async function saveRomaneioChecklistPdf(romaneio, checklists = romaneio?.checklists || []) {
  const snapshots = checklistSnapshots(checklists);
  const bytes = await buildRomaneioChecklistDocx(romaneio, snapshots);
  const projectFolderName = safePath(`Missão ${romaneio.project.code} - ${romaneio.project.name}`);
  const dir = path.join(env.uploadDir, projectFolderName, 'ROMANEIO');
  await fs.mkdir(dir, { recursive: true });

  const fileName = buildChecklistFileName(romaneio);
  const pdfPath = path.join(dir, fileName);
  const docxPath = pdfPath.replace(/\.pdf$/i, '.docx');
  await fs.writeFile(docxPath, bytes);
  await convertDocxToPdf(docxPath, pdfPath);
  await fs.unlink(docxPath).catch(() => undefined);

  return {
    fileName,
    targetPath: pdfPath,
    publicUrl: `/relatorios/${encodeURIComponent(projectFolderName)}/ROMANEIO/${encodeURIComponent(fileName)}`,
    projectLabel: buildChecklistProjectLabel(romaneio)
  };
}
