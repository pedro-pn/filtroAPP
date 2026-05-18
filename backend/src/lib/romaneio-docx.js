import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import AdmZip from 'adm-zip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

import env from '../config/env.js';
import { formatCnpj } from './cnpj.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const templatePath = path.resolve(__dirname, '../../../Modelos/definitivos/Romaneio.docx');

function safeText(value) {
  if (value == null) return '';
  return String(value);
}

function safePath(value) {
  return safeText(value).replace(/[<>:"/\\|?*\n\r]/g, '_').trim();
}

function formatDatePt(value, withTime = false) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {})
  });
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

function quantityText(item) {
  const quantity = Number(item.quantity);
  const normalized = Number.isFinite(quantity)
    ? String(quantity).replace(/\.?0+$/, '').replace('.', ',')
    : safeText(item.quantity);
  return `${normalized || '1'} ${item.unitLabel || 'unidade'}`.trim();
}

function itemText(item) {
  return [item.itemCode, item.itemName].filter(Boolean).join(' - ');
}

function groupItemsByCategory(items) {
  const groups = new Map();
  (items || []).forEach(item => {
    const key = item.categoryName || 'Itens';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  return Array.from(groups.entries()).map(([categoryName, groupItems]) => ({
    categoryName,
    items: groupItems.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
  }));
}

function populateEquipmentTables(doc, romaneio) {
  const templateTable = findFirstByText(doc, 'w:tbl', '<<UNITTYPE>>');
  if (!templateTable) return;
  const templateRow = findFirstByText(templateTable, 'w:tr', '<<item>>') || findFirstByText(templateTable, 'w:tr', '<<quantity>>');
  const groups = groupItemsByCategory(romaneio.items);

  if (!templateRow || !groups.length) {
    const clone = templateTable.cloneNode(true);
    replacePlaceholders(clone, {
      UNITTYPE: 'Itens do romaneio',
      item: groups.length ? '' : 'Nenhum item informado',
      quantity: ''
    });
    cloneBefore(templateTable, [clone]);
    removeNode(templateTable);
    return;
  }

  const tables = groups.map(group => {
    const table = templateTable.cloneNode(true);
    const row = findFirstByText(table, 'w:tr', '<<item>>') || findFirstByText(table, 'w:tr', '<<quantity>>');
    const itemRows = group.items.map(item => {
      const clone = row.cloneNode(true);
      replacePlaceholders(clone, {
        item: itemText(item),
        quantity: quantityText(item)
      });
      return clone;
    });
    cloneBefore(row, itemRows);
    removeNode(row);
    replacePlaceholders(table, { UNITTYPE: group.categoryName });
    return table;
  });

  cloneBefore(templateTable, tables);
  removeNode(templateTable);
}

function buildDocxData(romaneio) {
  const project = romaneio.project || {};
  return {
    mission: `Missão ${project.code || ''} - ${project.name || ''}`.trim(),
    client: project.clientName || '',
    proposal: project.contractCode || '',
    date: formatDatePt(romaneio.romaneioDate),
    cnpj: formatCnpj(project.clientCnpj) || project.clientCnpj || '',
    plate: romaneio.vehiclePlate || '',
    driver: romaneio.driverName || '',
    local: project.location || ''
  };
}

export async function buildRomaneioDocx(romaneio) {
  const buffer = await fs.readFile(templatePath);
  const zip = new AdmZip(buffer);
  const entry = zip.getEntry('word/document.xml');
  const xml = zip.readAsText(entry);
  const doc = new DOMParser().parseFromString(xml, 'application/xml');

  replacePlaceholders(doc, buildDocxData(romaneio));
  populateEquipmentTables(doc, romaneio);

  zip.updateFile('word/document.xml', Buffer.from(new XMLSerializer().serializeToString(doc)));
  return zip.toBuffer();
}

export async function saveRomaneioDocx(romaneio) {
  const bytes = await buildRomaneioDocx(romaneio);
  const projectFolderName = safePath(`Missão ${romaneio.project.code} - ${romaneio.project.name}`);
  const dir = path.join(env.uploadDir, projectFolderName, 'ROMANEIO');
  await fs.mkdir(dir, { recursive: true });
  const datePrefix = formatDatePt(romaneio.romaneioDate).replace(/\//g, '-');
  const fileName = `Romaneio ${datePrefix} - ${safePath(romaneio.vehiclePlate)} - ${romaneio.id.slice(-6)}.docx`;
  const targetPath = path.join(dir, fileName);
  await fs.writeFile(targetPath, bytes);
  return {
    fileName,
    targetPath,
    publicUrl: `/relatorios/${encodeURIComponent(projectFolderName)}/ROMANEIO/${encodeURIComponent(fileName)}`
  };
}

export function buildRomaneioEmailHtml(romaneio) {
  const project = romaneio.project || {};
  return `
    <p>Um novo romaneio foi criado.</p>
    <p><strong>Projeto:</strong> Missão ${project.code || ''} - ${project.name || ''}</p>
    <p><strong>Data:</strong> ${formatDatePt(romaneio.romaneioDate, true)}</p>
    <p><strong>Motorista:</strong> ${romaneio.driverName || ''}</p>
    <p><strong>Placa:</strong> ${romaneio.vehiclePlate || ''}</p>
  `;
}
