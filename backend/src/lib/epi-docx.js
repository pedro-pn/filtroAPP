import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import AdmZip from 'adm-zip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

import env from '../config/env.js';
import { parseSignatureImageDataUrl } from './signatures/common.js';
import { convertDocxToPdf } from './report-pdf-from-docx.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const templatePath = path.resolve(__dirname, '../../../Modelos/definitivos/Ficha de Controle de EPIs.docx');

function safeText(value) {
  if (value == null) return '';
  return String(value);
}

function safePath(value) {
  return safeText(value).replace(/[<>:"/\\|?*\n\r]/g, '_').trim();
}

function formatDatePt(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
  return formatter.format(date);
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
    width: size?.width || 360,
    height: size?.height || 120
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

function drawingXml(relId, cx, cy) {
  return `
    <w:r xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
      <w:drawing>
        <wp:inline distT="0" distB="0" distL="0" distR="0">
          <wp:extent cx="${cx}" cy="${cy}"/>
          <wp:effectExtent l="0" t="0" r="0" b="0"/>
          <wp:docPr id="7000" name="Assinatura EPI"/>
          <wp:cNvGraphicFramePr/>
          <a:graphic>
            <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
              <pic:pic>
                <pic:nvPicPr><pic:cNvPr id="0" name="Assinatura EPI"/><pic:cNvPicPr/></pic:nvPicPr>
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

function ensureParagraphCentered(paragraph) {
  if (!paragraph) return;
  const doc = paragraph.ownerDocument;
  let pPr = null;
  for (let child = paragraph.firstChild; child; child = child.nextSibling) {
    if (child.nodeName === 'w:pPr') {
      pPr = child;
      break;
    }
  }
  if (!pPr) {
    pPr = doc.createElement('w:pPr');
    paragraph.insertBefore(pPr, paragraph.firstChild);
  }

  let jc = null;
  for (let child = pPr.firstChild; child; child = child.nextSibling) {
    if (child.nodeName === 'w:jc') {
      jc = child;
      break;
    }
  }
  if (!jc) {
    jc = doc.createElement('w:jc');
    pPr.appendChild(jc);
  }
  jc.setAttribute('w:val', 'center');
}

function createImageRelationship(zip, relsDoc, asset) {
  const relId = nextRelationshipId(relsDoc);
  const mediaName = `epi-signature-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${asset.extension}`;
  zip.addFile(`word/media/${mediaName}`, asset.bytes);
  ensureContentType(zip, asset.extension, asset.mimeType);
  const relNode = relsDoc.createElement('Relationship');
  relNode.setAttribute('Id', relId);
  relNode.setAttribute('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image');
  relNode.setAttribute('Target', `media/${mediaName}`);
  relsDoc.documentElement.appendChild(relNode);
  return relId;
}

function setParagraphToSignature(zip, relsDoc, paragraph, signatureImageDataUrl, maxWidthEmu = 900000) {
  if (!paragraph) return;
  const parsed = parseSignatureImageDataUrl(signatureImageDataUrl);
  if (!parsed) {
    replaceTokenInElement(paragraph, '<<ass>>', '');
    return;
  }
  const asset = imageMeta(parsed);
  const relId = createImageRelationship(zip, relsDoc, asset);
  const heightEmu = Math.max(1, Math.round(maxWidthEmu * (asset.height / asset.width)));
  replaceTokenInElement(paragraph, '<<ass>>', '');
  ensureParagraphCentered(paragraph);
  const drawingDoc = new DOMParser().parseFromString(drawingXml(relId, maxWidthEmu, heightEmu), 'text/xml');
  paragraph.appendChild(drawingDoc.documentElement);
}

export function redactedEpiCollaboratorForPublicPdf(collaborator) {
  return {
    ...collaborator,
    cpf: '',
    registrationNumber: '',
    admissionDate: null
  };
}

function buildBaseData(collaborator, createdAt) {
  return {
    collaborator: collaborator.name || '',
    cpf: collaborator.cpf || '',
    admissiondate: formatDatePt(collaborator.admissionDate),
    number: collaborator.registrationNumber || '',
    POSITION: collaborator.role || '',
    date: formatDatePt(createdAt || new Date())
  };
}

function recordData(record) {
  return {
    epi: record.epiName || '',
    ca: record.ca || '',
    quantity: String(record.quantity || 1),
    qtd: String(record.quantity || 1),
    lenddate: formatDatePt(record.lendDate),
    devolutiondate: formatDatePt(record.devolutionDate)
  };
}

function recordSignatureImageDataUrl(record) {
  return record?.signatureImageDataUrl || record?.signatureRequest?.signatureImageDataUrl || '';
}

function populateGlobalSignature(zip, relsDoc, doc, records) {
  const firstSigned = records.find(record => recordSignatureImageDataUrl(record));
  const paragraph = findFirstByText(doc, 'w:p', '<<ass>>');
  if (!paragraph) return;
  setParagraphToSignature(zip, relsDoc, paragraph, recordSignatureImageDataUrl(firstSigned), 1050000);
}

function populateEpiRows(zip, relsDoc, doc, records) {
  const templateRow = findFirstByText(doc, 'w:tr', '<<epi>>')
    || findFirstByText(doc, 'w:tr', '<<lenddate>>');
  if (!templateRow) return;

  if (!records.length) {
    replacePlaceholders(templateRow, {
      epi: '',
      ca: '',
      quantity: '',
      qtd: '',
      lenddate: '',
      devolutiondate: ''
    });
    replaceTokenInElement(templateRow, '<<ass>>', '');
    return;
  }

  const clones = records.map(record => {
    const clone = templateRow.cloneNode(true);
    replacePlaceholders(clone, recordData(record));
    const paragraph = findFirstByText(clone, 'w:p', '<<ass>>');
    setParagraphToSignature(zip, relsDoc, paragraph, recordSignatureImageDataUrl(record));
    replaceTokenInElement(clone, '<<ass>>', '');
    return clone;
  });
  cloneBefore(templateRow, clones);
  removeNode(templateRow);
}

function clearRemainingPlaceholders(xml) {
  return xml.replace(/<<[^>]+>>/g, '');
}

export async function buildEpiDocx(collaborator, options = {}) {
  const source = options.redactCollaboratorFields ? redactedEpiCollaboratorForPublicPdf(collaborator) : collaborator;
  const records = [...(source.epiRecords || [])]
    .sort((a, b) => new Date(a.lendDate).getTime() - new Date(b.lendDate).getTime());
  const createdAt = records[0]?.createdAt || source.createdAt || new Date();
  const buffer = await fs.readFile(templatePath);
  const zip = new AdmZip(buffer);
  const relsEntry = zip.getEntry('word/_rels/document.xml.rels');
  const relsDoc = relsEntry
    ? new DOMParser().parseFromString(zip.readAsText(relsEntry), 'text/xml')
    : null;

  const entries = zip.getEntries()
    .map(entry => entry.entryName)
    .filter(name => /^word\/(document|header\d+)\.xml$/i.test(name));

  for (const entryName of entries) {
    const entry = zip.getEntry(entryName);
    const doc = new DOMParser().parseFromString(zip.readAsText(entry), 'text/xml');
    replacePlaceholders(doc, buildBaseData(source, createdAt));
    if (entryName === 'word/document.xml' && relsDoc) {
      populateGlobalSignature(zip, relsDoc, doc, records);
      populateEpiRows(zip, relsDoc, doc, records);
    }
    replacePlaceholders(doc, buildBaseData(source, createdAt));
    zip.updateFile(entryName, Buffer.from(clearRemainingPlaceholders(new XMLSerializer().serializeToString(doc)), 'utf8'));
  }

  if (relsDoc) {
    zip.updateFile('word/_rels/document.xml.rels', Buffer.from(new XMLSerializer().serializeToString(relsDoc), 'utf8'));
  }

  return zip.toBuffer();
}

export async function saveEpiPdf(collaborator, options = {}) {
  const bytes = await buildEpiDocx(collaborator, options);
  const collaboratorFolder = safePath(`${collaborator.code || 'COL'} - ${collaborator.name || 'Colaborador'}`) || collaborator.id;
  const dir = path.join(env.uploadDir, 'EPI', collaboratorFolder);
  await fs.mkdir(dir, { recursive: true });
  const suffix = new Date().toISOString().replace(/[:.]/g, '-');
  const variant = safePath(options.variantLabel || '');
  const variantPart = variant ? ` - ${variant}` : '';
  const baseName = `Ficha de Controle de EPIs${variantPart} - ${safePath(collaborator.name || collaborator.id)} - ${suffix}`;
  const docxPath = path.join(dir, `${baseName}.docx`);
  const pdfPath = path.join(dir, `${baseName}.pdf`);
  await fs.writeFile(docxPath, bytes);
  await convertDocxToPdf(docxPath, pdfPath);
  return {
    docxPath,
    pdfPath,
    fileName: `${baseName}.pdf`
  };
}
