import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import prisma from './prisma.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EQUIPMENT_FILE_CANDIDATES = [
  process.env.ROMANEIO_EQUIPMENT_FILE,
  path.resolve(process.cwd(), '../equipamentos.txt'),
  path.resolve(process.cwd(), '../equipamentos'),
  path.resolve(process.cwd(), 'equipamentos.txt'),
  path.resolve(process.cwd(), 'equipamentos'),
  path.resolve(__dirname, '../../../equipamentos.txt'),
  path.resolve(__dirname, '../../../equipamentos'),
  '/workspace/equipamentos.txt',
  '/workspace/equipamentos'
].filter(Boolean);

const UNIT_CATEGORY_LABELS = {
  FILTRAGEM: 'UNIDADE DE FILTRAGEM',
  FLUSHING: 'UNIDADE DE FLUSHING',
  LIMPEZA_QUIMICA: 'UNIDADE DE LIMPEZA QUIMICA',
  DESIDRATACAO: 'UNIDADE DE DESIDRATACAO',
  UTH: 'UNIDADE DE TESTE HIDROSTATICO',
  OUTRA: 'UNIDADES'
};

function normalizeSpaces(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function measureFromLabel(value) {
  const normalized = normalizeSpaces(value).toLowerCase();
  if (normalized === 'kg' || normalized === 'peso') return { measureType: 'WEIGHT', defaultUnitLabel: 'kg' };
  if (normalized === 'metros' || normalized === 'metro' || normalized === 'm') return { measureType: 'LENGTH', defaultUnitLabel: 'm' };
  return { measureType: 'UNIT', defaultUnitLabel: 'unidade' };
}

function kindFromCategory(categoryName) {
  const normalized = normalizeSpaces(categoryName)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
  return normalized.includes('CONEX') || normalized.includes('VALVULA') ? 'CONNECTION' : 'EQUIPMENT';
}

function normalizeComparable(value) {
  return normalizeSpaces(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function looksLikeSectionCode(value) {
  return /^[A-Z]{2,5}$/i.test(normalizeSpaces(value));
}

function looksLikeItemCode(value) {
  return /^[A-Z]{2,5}\s*\d{1,4}$/i.test(normalizeSpaces(value)) || /^[A-Z]{2}\d{3}$/i.test(normalizeSpaces(value));
}

function parseEquipmentRows(content) {
  const rows = [];
  let section = null;

  content.split(/\r?\n/).forEach((line, index) => {
    const rawParts = line.split('\t').map(part => normalizeSpaces(part));
    const parts = rawParts.filter(Boolean);
    if (!parts.length) return;

    const first = parts[0];
    const second = parts[1] || '';
    const third = parts[2] || '';

    if (normalizeComparable(first) === 'CONEXOES NAO LISTADAS') {
      section = {
        categoryName: 'Outros materiais',
        kind: 'EQUIPMENT',
        measureType: 'UNIT',
        defaultUnitLabel: 'unidade'
      };
      return;
    }

    if (['Unidade', 'Kg', 'Metros', 'QTD'].includes(first) && (second || third)) {
      const measure = measureFromLabel(first);
      const categoryName = third || second;
      section = {
        categoryName,
        kind: kindFromCategory(categoryName),
        ...measure
      };
      return;
    }

    if (looksLikeSectionCode(first) && (second || third) && !looksLikeItemCode(first)) {
      const measure = third ? measureFromLabel(second) : measureFromLabel('');
      const categoryName = third || second;
      section = {
        categoryName,
        kind: kindFromCategory(categoryName),
        ...measure
      };
      return;
    }

    if (!section && first === first.toUpperCase()) {
      section = {
        categoryName: 'EQUIPAMENTOS',
        kind: 'EQUIPMENT',
        measureType: 'UNIT',
        defaultUnitLabel: 'unidade'
      };
    }
    if (!section) return;

    const code = looksLikeItemCode(first) ? normalizeSpaces(first).toUpperCase() : null;
    const candidateName = code ? parts.slice(1).find(part => part.toUpperCase() !== 'FALSE') : parts.find(part => part.toUpperCase() !== 'FALSE');
    const name = normalizeSpaces(candidateName);
    if (!name) return;

    const isSerialized = section.kind === 'EQUIPMENT'
      && section.measureType === 'UNIT'
      && Boolean(code)
      && !section.categoryName.toUpperCase().includes('PRODUTOS');

    rows.push({
      sourceType: 'FILE',
      sourceId: `equipamentos:${index + 1}`,
      code,
      name,
      categoryName: section.categoryName,
      kind: section.kind,
      measureType: section.measureType,
      defaultUnitLabel: section.defaultUnitLabel,
      isSerialized,
      isActive: true
    });
  });

  const seen = new Set();
  return rows.filter(row => {
    const key = `${row.categoryName}|${row.code || ''}|${row.name}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function readEquipmentSeedFile() {
  for (const candidate of EQUIPMENT_FILE_CANDIDATES) {
    try {
      return await fs.readFile(candidate, 'utf8');
    } catch {
      // Try the next known deployment path.
    }
  }
  return '';
}

async function upsertCatalogRow(tx, row) {
  if (row.sourceType && row.sourceId) {
    const existingSource = await tx.romaneioCatalogItem.findUnique({
      where: {
        sourceType_sourceId: {
          sourceType: row.sourceType,
          sourceId: row.sourceId
        }
      },
      select: { id: true, isActive: true }
    });
    if (existingSource) {
      await tx.romaneioCatalogItem.update({
        where: { id: existingSource.id },
        data: {
          ...row,
          isActive: existingSource.isActive && row.isActive !== false
        }
      });
      return;
    }
  }

  const existing = await tx.romaneioCatalogItem.findFirst({
    where: {
      categoryName: row.categoryName,
      code: row.code,
      name: row.name
    },
    select: { id: true }
  });

  if (existing) return;
  await tx.romaneioCatalogItem.create({ data: row });
}

async function syncFileCatalog(tx) {
  const content = await readEquipmentSeedFile();
  if (!content.trim()) return;
  const rows = parseEquipmentRows(content);
  for (const row of rows) {
    await upsertCatalogRow(tx, row);
  }
}

async function syncUnits(tx) {
  const units = await tx.unit.findMany();
  for (const unit of units) {
    await upsertCatalogRow(tx, {
      sourceType: 'UNIT',
      sourceId: unit.id,
      code: unit.code,
      name: `Unidade ${unit.code}`,
      categoryName: UNIT_CATEGORY_LABELS[unit.category] || 'UNIDADES',
      kind: 'EQUIPMENT',
      measureType: 'UNIT',
      defaultUnitLabel: 'unidade',
      isSerialized: true,
      isActive: true
    });
  }
}

async function syncParticleCounters(tx) {
  const counters = await tx.particleCounter.findMany();
  for (const counter of counters) {
    await upsertCatalogRow(tx, {
      sourceType: 'PARTICLE_COUNTER',
      sourceId: counter.id,
      code: counter.code,
      name: `Contador de partículas ${counter.serialNumber || counter.code}`,
      categoryName: 'CONTADOR DE PARTICULAS',
      kind: 'EQUIPMENT',
      measureType: 'UNIT',
      defaultUnitLabel: 'unidade',
      isSerialized: true,
      isActive: counter.isActive
    });
  }
}

export async function syncRomaneioCatalog() {
  await prisma.$transaction(async tx => {
    await syncFileCatalog(tx);
    await syncUnits(tx);
    await syncParticleCounters(tx);
  }, { timeout: 30_000 });
}
