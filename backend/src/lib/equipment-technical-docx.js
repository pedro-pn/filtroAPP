// Preenchimento do template Datasheet.docx + conversão para PDF (Etapa D).
//
// Consome o modelo achatado de equipment-technical-doc.js e produz o .docx final:
//  - substitui os tokens {{...}} da Tabela 1 (identificação) e do cabeçalho;
//  - clona as linhas-modelo da Tabela 2 (faixa de seção + linha rótulo/valor) por
//    bloco/campo, no padrão de clone de `w:tr` usado em report-rlm.js;
//  - limpa placeholders remanescentes e converte DOCX -> PDF (fila serial).
//
// Helpers de XML mantidos locais (auto-contido) para não acoplar a report-rlm.js.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import AdmZip from 'adm-zip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

import env from '../config/env.js';
import { convertDocxToPdf } from './report-pdf-from-docx.js';
import { buildTechnicalDocModel } from './equipment-technical-doc.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const templatePath = path.resolve(__dirname, '../../../Modelos/definitivos/Datasheet.docx');

function safeText(value) {
  return value == null ? '' : String(value);
}

function safePath(value) {
  return safeText(value).replace(/[<>:"/\\|?*\n\r]/g, '_').replace(/\s+/g, ' ').trim();
}

// ── Utilidades de XML (DOCX) ──

function getTextNodes(node, out = []) {
  if (!node) return out;
  if (node.nodeType === 3) out.push(node);
  for (let child = node.firstChild; child; child = child.nextSibling) getTextNodes(child, out);
  return out;
}

function elementText(element) {
  return getTextNodes(element).map(n => n.data || '').join('');
}

// Substitui um token mesmo que o Word o tenha quebrado em vários runs: opera sobre
// o texto concatenado dos nós e redistribui o resultado entre eles.
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
}

function findFirstByText(root, tagName, token) {
  return Array.from(root.getElementsByTagName(tagName)).find(n => elementText(n).includes(token)) || null;
}

function removeNode(node) {
  if (node && node.parentNode) node.parentNode.removeChild(node);
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

// Clona as duas linhas-modelo da Tabela 2 (faixa de seção + linha rótulo/valor)
// uma vez por bloco e por campo. Mantém a ordem dos blocos.
function expandTechnicalBlocks(doc, blocks) {
  const titleRow = findFirstByText(doc, 'w:tr', '{{secao_titulo}}');
  const fieldRow = findFirstByText(doc, 'w:tr', '{{campo_rotulo}}');
  if (!titleRow || !fieldRow) return;

  const clones = [];
  for (const block of blocks) {
    const titleClone = titleRow.cloneNode(true);
    replacePlaceholders(titleClone, { secao_titulo: block.title || 'Dados' });
    clones.push(titleClone);
    for (const row of block.rows) {
      const fieldClone = fieldRow.cloneNode(true);
      replacePlaceholders(fieldClone, { campo_rotulo: row.label, campo_valor: row.value });
      clones.push(fieldClone);
    }
  }

  cloneBefore(titleRow, clones);
  removeNode(titleRow);
  removeNode(fieldRow);
}

// Remove a linha de dimensões da Tabela 1 (Altura/Largura/Comprimento) quando as três
// estão vazias — feito ANTES da substituição, localizando a linha pelo token {{altura}}.
function removeEmptyDimensionsRow(doc, tokens) {
  const hasDim = [tokens.altura, tokens.largura, tokens.comprimento]
    .some(v => String(v ?? '').trim() !== '');
  if (hasDim) return;
  const row = findFirstByText(doc, 'w:tr', '{{altura}}');
  if (row) removeNode(row);
}

// ── Imagens (fotos dos Dados Técnicos) ──

function nextRelId(relsDoc) {
  let max = 0;
  Array.from(relsDoc.getElementsByTagName('Relationship')).forEach(n => {
    const m = String(n.getAttribute('Id') || '').match(/^rId(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return `rId${max + 1}`;
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

function addImageRel(zip, relsDoc, asset) {
  const relId = nextRelId(relsDoc);
  const mediaName = `tech-${Date.now()}-${randomUUID().slice(0, 8)}.${asset.extension}`;
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
  return `<w:r xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="6010" name="${n}"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="${n}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

// Embute as fotos na célula {{fotos}} (2 por linha, centralizadas). Sem fotos, remove a
// Tabela 3 (FOTOS) inteira do documento.
function embedOrRemovePhotos(zip, doc, assets) {
  const table = findFirstByText(doc, 'w:tbl', '{{fotos}}');
  if (!table) return;
  if (!assets || assets.length === 0) { removeNode(table); return; }
  const targetParagraph = findFirstByText(table, 'w:p', '{{fotos}}');
  const cell = targetParagraph?.parentNode;
  const relsEntry = zip.getEntry('word/_rels/document.xml.rels');
  if (!cell || !relsEntry) { removeNode(table); return; }

  const relsDoc = new DOMParser().parseFromString(zip.readAsText(relsEntry), 'text/xml');
  while (cell.firstChild) cell.removeChild(cell.firstChild);
  const maxWidthEmu = 2857500; // ~7,5 cm: cabem 2 lado a lado na largura da tabela

  for (let i = 0; i < assets.length; i += 2) {
    const group = assets.slice(i, i + 2);
    const paragraph = doc.createElement('w:p');
    const pPr = doc.createElement('w:pPr');
    const jc = doc.createElement('w:jc'); jc.setAttribute('w:val', 'center');
    pPr.appendChild(jc); paragraph.appendChild(pPr);
    group.forEach((asset, idx) => {
      const relId = addImageRel(zip, relsDoc, asset);
      const w = asset.width || 100; const h = asset.height || 100;
      const heightEmu = Math.max(1, Math.round(maxWidthEmu * (h / w)));
      const drawing = new DOMParser().parseFromString(inlineImageXml(relId, maxWidthEmu, heightEmu, asset.label), 'text/xml');
      paragraph.appendChild(drawing.documentElement);
      if (idx < group.length - 1) {
        const spacer = doc.createElement('w:r');
        const t = doc.createElement('w:t'); t.appendChild(doc.createTextNode('   '));
        spacer.appendChild(t); paragraph.appendChild(spacer);
      }
    });
    cell.appendChild(paragraph);
  }
  zip.updateFile('word/_rels/document.xml.rels', Buffer.from(new XMLSerializer().serializeToString(relsDoc), 'utf8'));
}

// ── Geração ──

export async function buildTechnicalDatasheetDocx(equipment, category, photoAssets = []) {
  const model = buildTechnicalDocModel(equipment, category);
  const bytes = await fs.readFile(templatePath);
  const zip = new AdmZip(bytes);

  const xmlEntries = zip.getEntries()
    .map(e => e.entryName)
    .filter(name => /^word\/(document|header\d+|footer\d+)\.xml$/i.test(name));

  xmlEntries.forEach(name => {
    updateXmlEntry(zip, name, doc => {
      if (/document\.xml$/i.test(name)) {
        removeEmptyDimensionsRow(doc, model.tokens);
      }
      replacePlaceholders(doc, model.tokens);
      if (/document\.xml$/i.test(name)) {
        expandTechnicalBlocks(doc, model.blocks);
        embedOrRemovePhotos(zip, doc, photoAssets);
      }
    });
  });

  xmlEntries.forEach(name => {
    const entry = zip.getEntry(name);
    if (!entry) return;
    zip.updateFile(name, Buffer.from(clearRemainingPlaceholders(zip.readAsText(entry)), 'utf8'));
  });

  return zip.toBuffer();
}

export function technicalDatasheetFileName(equipment, revision = null) {
  const revPart = revision != null && revision !== '' ? ` - Rev ${revision}` : '';
  const base = safePath(`Datasheet - ${equipment?.code || ''} - ${equipment?.name || ''}${revPart}`)
    .replace(/^-+|-+$/g, '').trim();
  return `${base || 'Datasheet'}.pdf`;
}

// Gera o datasheet em PDF e devolve os bytes (sem persistir como anexo).
// `revision`, quando informado, é incluído no nome do arquivo ("… - Rev N.pdf").
export async function generateTechnicalDatasheetPdf(equipment, category, photoAssets = [], revision = null) {
  const docxBytes = await buildTechnicalDatasheetDocx(equipment, category, photoAssets);
  const tmpDir = path.join(env.uploadDir, 'Equipamentos', 'tmp');
  await fs.mkdir(tmpDir, { recursive: true });
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const docxPath = path.join(tmpDir, `datasheet-${stamp}.docx`);
  const pdfPath = docxPath.replace(/\.docx$/i, '.pdf');
  await fs.writeFile(docxPath, docxBytes);
  try {
    await convertDocxToPdf(docxPath, pdfPath);
    const bytes = await fs.readFile(pdfPath);
    return { bytes, fileName: technicalDatasheetFileName(equipment, revision) };
  } finally {
    await fs.rm(docxPath, { force: true }).catch(() => {});
    await fs.rm(pdfPath, { force: true }).catch(() => {});
  }
}
