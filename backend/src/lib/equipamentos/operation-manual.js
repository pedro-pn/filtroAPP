// Manual de Operação do equipamento: passos de uso em texto livre, gerados em PDF
// a partir do template "Manual de Operacao.docx" (mesmo esquema do Datasheet).
//
// Herança: a categoria guarda um modelo de passos (`operationSteps`, array) que vale
// para todos os equipamentos dela. O equipamento pode sobrescrever com passos próprios
// (`operationSteps` array); `null` = herda da categoria.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import AdmZip from 'adm-zip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

import { formatTimestampDate } from '../../../../shared/modules/date-only.js';
import env from '../../config/env.js';
import { addImageRel, inlineImageXml } from '../equipment-technical-docx.js';
import { convertDocxToPdf } from '../report-pdf-from-docx.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.resolve(__dirname, '../../../../Modelos/definitivos/Manual de Operacao.docx');

export const MAX_OPERATION_STEPS = 100;
export const MAX_OPERATION_STEP_LENGTH = 1000;
export const MAX_OPERATION_STEP_PHOTOS = 10;

function normalizeStepText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_OPERATION_STEP_LENGTH);
}

// Passos com fotos: cada item guarda o texto e os ids (EquipmentAttachment) das fotos
// logo abaixo do passo. Aceita string simples (sem fotos) ou { text, photoIds }.
export function normalizeOperationStepItems(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => {
      if (item && typeof item === 'object') {
        const photoIds = Array.isArray(item.photoIds)
          ? [...new Set(item.photoIds.map(id => String(id || '').trim()).filter(Boolean))].slice(0, MAX_OPERATION_STEP_PHOTOS)
          : [];
        return { text: normalizeStepText(item.text), photoIds };
      }
      return { text: normalizeStepText(item), photoIds: [] };
    })
    .filter(item => item.text)
    .slice(0, MAX_OPERATION_STEPS);
}

// Só o texto dos passos (modelo da categoria e comparações simples).
export function normalizeOperationSteps(value) {
  return normalizeOperationStepItems(value).map(item => item.text);
}

// Forma gravada no JSON: string quando não há fotos, objeto quando há.
export function serializeOperationStepItems(items) {
  return items.map(item => (item.photoIds.length ? { text: item.text, photoIds: item.photoIds } : item.text));
}

export function resolveEffectiveOperationStepItems(equipment, category) {
  const own = Array.isArray(equipment?.operationSteps) ? normalizeOperationStepItems(equipment.operationSteps) : [];
  if (own.length) return own;
  return normalizeOperationStepItems(category?.operationSteps);
}

// Passos válidos do equipamento ou, se não houver, os do modelo da categoria.
export function resolveEffectiveOperationSteps(equipment, category) {
  return resolveEffectiveOperationStepItems(equipment, category).map(item => item.text);
}

export function operationStepsSource(equipment) {
  return Array.isArray(equipment?.operationSteps) && normalizeOperationStepItems(equipment.operationSteps).length
    ? 'EQUIPMENT'
    : 'CATEGORY';
}

export function buildOperationManualModel(equipment, category) {
  const steps = resolveEffectiveOperationStepItems(equipment, category);
  const generatedAt = equipment?.operationUpdatedAt ? new Date(equipment.operationUpdatedAt) : new Date();
  return {
    steps,
    tokens: {
      equip_codigo: equipment?.code || '',
      equip_nome: equipment?.name || '',
      categoria: category?.name || '',
      revisao: String(equipment?.operationRevision ?? 0),
      data_geracao: formatTimestampDate(generatedAt, '')
    }
  };
}

// ── XML (DOCX) ──

function getTextNodes(node, out = []) {
  if (!node) return out;
  if (node.nodeType === 3) out.push(node);
  for (let child = node.firstChild; child; child = child.nextSibling) getTextNodes(child, out);
  return out;
}

function elementText(element) {
  return getTextNodes(element).map(n => n.data || '').join('');
}

function replaceToken(element, token, replacement) {
  const nodes = getTextNodes(element);
  let full = nodes.map(n => n.data || '').join('');
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
        const ls = overlapStart - startPos;
        const le = overlapEnd - startPos;
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
    const safe = value == null ? '' : String(value);
    [`{{${key}}}`, `{{ ${key} }}`].forEach(token => replaceToken(element, token, safe));
  });
}

function findFirstByText(root, tagName, token) {
  return Array.from(root.getElementsByTagName(tagName)).find(n => elementText(n).includes(token)) || null;
}

const PHOTO_MAX_WIDTH_EMU = 2800000; // ~7,8 cm: duas fotos lado a lado na célula do passo
const PHOTO_MAX_HEIGHT_EMU = 2700000; // ~7,5 cm

function removeNode(node) {
  if (node?.parentNode) node.parentNode.removeChild(node);
}

// Preenche o parágrafo {{passo_fotos}} com as fotos do passo (logo abaixo do texto)
// ou o remove quando o passo não tem fotos.
function fillStepPhotos(doc, zip, relsDoc, row, assets, stepNumber) {
  const paragraph = Array.from(row.getElementsByTagName('w:p')).find(p => elementText(p).includes('{{passo_fotos}}'));
  if (!paragraph) return;
  if (!assets.length) { removeNode(paragraph); return; }
  Array.from(paragraph.childNodes).forEach(child => { if (child.nodeName !== 'w:pPr') removeNode(child); });
  assets.forEach((asset, idx) => {
    const relId = addImageRel(zip, relsDoc, asset);
    const scale = Math.min(PHOTO_MAX_WIDTH_EMU / asset.width, PHOTO_MAX_HEIGHT_EMU / asset.height);
    const cx = Math.max(1, Math.round(asset.width * scale));
    const cy = Math.max(1, Math.round(asset.height * scale));
    const run = new DOMParser().parseFromString(inlineImageXml(relId, cx, cy, `Foto passo ${stepNumber}`), 'text/xml');
    paragraph.appendChild(doc.importNode ? doc.importNode(run.documentElement, true) : run.documentElement);
    if (idx < assets.length - 1) {
      const spacer = doc.createElement('w:r');
      const t = doc.createElement('w:t');
      t.setAttribute('xml:space', 'preserve');
      t.appendChild(doc.createTextNode('   '));
      spacer.appendChild(t);
      paragraph.appendChild(spacer);
    }
  });
  // Passo com muitas fotos pode passar de uma página: deixa a linha quebrar.
  if (assets.length > 2) Array.from(row.getElementsByTagName('w:cantSplit')).forEach(removeNode);
}

// Clona a linha-modelo {{passo_numero}}/{{passo_texto}} uma vez por passo.
function expandSteps(doc, steps, zip, relsDoc, photoAssets) {
  const row = findFirstByText(doc, 'w:tr', '{{passo_numero}}');
  if (!row) return;
  const parent = row.parentNode;
  steps.forEach((step, index) => {
    const clone = row.cloneNode(true);
    const assets = step.photoIds.map(id => photoAssets.get(id)).filter(Boolean);
    fillStepPhotos(doc, zip, relsDoc, clone, assets, index + 1);
    replacePlaceholders(clone, { passo_numero: String(index + 1), passo_texto: step.text });
    parent.insertBefore(clone, row);
  });
  parent.removeChild(row);
}

// `photoAssets`: Map(attachmentId -> { bytes, extension, mimeType, width, height }).
export async function buildOperationManualDocx(equipment, category, photoAssets = new Map()) {
  const model = buildOperationManualModel(equipment, category);
  const zip = new AdmZip(await fs.readFile(templatePath));
  const names = zip.getEntries()
    .map(e => e.entryName)
    .filter(name => /^word\/(document|header\d+|footer\d+)\.xml$/i.test(name));
  const relsEntry = zip.getEntry('word/_rels/document.xml.rels');
  const relsDoc = new DOMParser().parseFromString(zip.readAsText(relsEntry), 'text/xml');

  for (const name of names) {
    const entry = zip.getEntry(name);
    const doc = new DOMParser().parseFromString(zip.readAsText(entry), 'text/xml');
    replacePlaceholders(doc, model.tokens);
    if (/document\.xml$/i.test(name)) expandSteps(doc, model.steps, zip, relsDoc, photoAssets);
    const xml = new XMLSerializer().serializeToString(doc).replace(/\{\{[^}]+\}\}/g, '');
    zip.updateFile(name, Buffer.from(xml, 'utf8'));
  }
  zip.updateFile('word/_rels/document.xml.rels', Buffer.from(new XMLSerializer().serializeToString(relsDoc), 'utf8'));
  return zip.toBuffer();
}

function safePath(value) {
  return String(value ?? '').replace(/[<>:"/\\|?*\n\r]/g, '_').replace(/\s+/g, ' ').trim();
}

export function operationManualFileName(equipment, revision = null) {
  const revPart = revision != null && revision !== '' ? ` - Rev ${revision}` : '';
  const base = safePath(`Manual de Operação - ${equipment?.code || ''} - ${equipment?.name || ''}${revPart}`)
    .replace(/^-+|-+$/g, '').trim();
  return `${base || 'Manual de Operação'}.pdf`;
}

export async function generateOperationManualPdf(equipment, category, photoAssets = new Map()) {
  const docxBytes = await buildOperationManualDocx(equipment, category, photoAssets);
  const tmpDir = path.join(env.uploadDir, 'Equipamentos', 'tmp');
  await fs.mkdir(tmpDir, { recursive: true });
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const docxPath = path.join(tmpDir, `manual-${stamp}.docx`);
  const pdfPath = docxPath.replace(/\.docx$/i, '.pdf');
  await fs.writeFile(docxPath, docxBytes);
  try {
    await convertDocxToPdf(docxPath, pdfPath);
    const bytes = await fs.readFile(pdfPath);
    return { bytes, fileName: operationManualFileName(equipment, equipment?.operationRevision ?? 0) };
  } finally {
    await fs.rm(docxPath, { force: true }).catch(() => {});
    await fs.rm(pdfPath, { force: true }).catch(() => {});
  }
}
