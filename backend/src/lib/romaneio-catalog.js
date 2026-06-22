import fs from 'node:fs/promises';
import crypto from 'node:crypto';
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
const RDO_OWNED_CATALOG_SOURCES = new Set(['UNIT', 'PARTICLE_COUNTER', 'EQUIPAMENTOS']);
const ROMANEIO_CATALOG_SYNC_TTL_MS = 60_000;
const ROMANEIO_CATALOG_SYNC_STATE_ID = 'default';
let lastSuccessfulCatalogSyncAt = 0;
let catalogSyncInFlight = null;

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
  return normalized.includes('CONEX') || normalized.includes('VALVULA') || normalized.includes('VAVULA') ? 'CONNECTION' : 'EQUIPMENT';
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

function looksLikeStandaloneSectionTitle(value) {
  const normalized = normalizeComparable(value);
  return normalized.startsWith('EQUIPAMENTOS')
    || normalized.startsWith('CONEXOES')
    || normalized.startsWith('VALVULAS')
    || normalized.startsWith('VAVULAS');
}

function isReusableSectionItemCode(value, section) {
  return normalizeComparable(value) === 'ENL'
    && normalizeComparable(section?.categoryName) === 'EQUIPAMENTOS NAO LISTADOS';
}

export function parseEquipmentRows(content) {
  const rows = [];
  let section = null;

  content.split(/\r?\n/).forEach((line, index) => {
    const rawParts = line.split('\t').map(part => normalizeSpaces(part));
    const parts = rawParts.filter(Boolean);
    if (!parts.length) return;

    const first = parts[0];
    const second = parts[1] || '';
    const third = parts[2] || '';

    if (parts.length === 1 && looksLikeStandaloneSectionTitle(first)) {
      section = {
        categoryName: first,
        kind: kindFromCategory(first),
        measureType: 'UNIT',
        defaultUnitLabel: 'unidade'
      };
      return;
    }

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

    if (looksLikeSectionCode(first) && (second || third) && !looksLikeItemCode(first) && !isReusableSectionItemCode(first, section)) {
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

    const reusableSectionItemCode = isReusableSectionItemCode(first, section);
    const code = looksLikeItemCode(first) || reusableSectionItemCode ? normalizeSpaces(first).toUpperCase() : null;
    const candidateName = code ? parts.slice(1).find(part => part.toUpperCase() !== 'FALSE') : parts.find(part => part.toUpperCase() !== 'FALSE');
    const name = normalizeSpaces(candidateName);
    if (!name) return;

    const isSerialized = section.kind === 'EQUIPMENT'
      && section.measureType === 'UNIT'
      && Boolean(code)
      && !reusableSectionItemCode
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

async function readFileCatalogRows() {
  const content = await readEquipmentSeedFile();
  if (!content.trim()) return null;
  return parseEquipmentRows(content);
}

// Constrói as linhas do catálogo de romaneio a partir do módulo Equipamentos.
// Apenas categorias com syncToRomaneio=true entram no catálogo.
function buildEquipmentCatalogRows(equipmentList) {
  return equipmentList.map(item => {
    const attributes = item.attributes && typeof item.attributes === 'object' ? item.attributes : {};
    const serial = attributes.serialNumber || '';
    return {
      sourceType: 'EQUIPAMENTOS',
      sourceId: item.id,
      code: item.code,
      name: normalizeSpaces(item.name) || (serial ? `${item.category?.name || 'Equipamento'} ${serial}` : item.code),
      categoryName: normalizeSpaces(item.category?.name) || 'EQUIPAMENTOS',
      kind: 'EQUIPMENT',
      measureType: 'UNIT',
      defaultUnitLabel: 'unidade',
      isSerialized: true,
      isActive: item.isActive
    };
  });
}

function catalogRowsHash({ fileRows, equipmentRows }) {
  const payload = {
    filePresent: Array.isArray(fileRows),
    fileRows: fileRows || [],
    equipmentRows
  };
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');
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
      select: { id: true, hiddenInRomaneioAt: true, sourceType: true }
    });
    if (existingSource) {
      const data = {
        ...row,
        isActive: !existingSource.hiddenInRomaneioAt && row.isActive !== false
      };
      if (existingSource.sourceType === 'FILE') {
        delete data.categoryName;
      }
      if (RDO_OWNED_CATALOG_SOURCES.has(existingSource.sourceType)) {
        data.isActive = row.isActive !== false;
        data.hiddenInRomaneioAt = null;
      }
      await tx.romaneioCatalogItem.update({
        where: { id: existingSource.id },
        data
      });
      return;
    }
  }

  const existing = await tx.romaneioCatalogItem.findFirst({
    where: {
      isActive: true,
      categoryName: row.categoryName,
      code: row.code,
      name: row.name
    },
    select: { id: true }
  });

  if (existing) return;
  await tx.romaneioCatalogItem.create({ data: row });
}

function catalogSourceKey(sourceType, sourceId) {
  return `${sourceType || ''}:${sourceId || ''}`;
}

function catalogNaturalKey(row) {
  return `${row.categoryName || ''}|${row.code || ''}|${row.name || ''}`.toLowerCase();
}

function dataForExistingCatalogRow(existing, row) {
  const data = {
    ...row,
    isActive: !existing.hiddenInRomaneioAt && row.isActive !== false
  };

  if (existing.sourceType === 'FILE') {
    delete data.categoryName;
  }

  if (RDO_OWNED_CATALOG_SOURCES.has(existing.sourceType)) {
    data.isActive = row.isActive !== false;
    data.hiddenInRomaneioAt = null;
  }

  return data;
}

function catalogValueChanged(current, next) {
  if (next === undefined) return false;
  if (current instanceof Date || next instanceof Date) {
    const currentTime = current instanceof Date ? current.getTime() : current == null ? null : new Date(current).getTime();
    const nextTime = next instanceof Date ? next.getTime() : next == null ? null : new Date(next).getTime();
    return currentTime !== nextTime;
  }
  return current !== next;
}

function catalogRowNeedsUpdate(existing, data) {
  return Object.entries(data).some(([key, value]) => catalogValueChanged(existing[key], value));
}

export async function syncCatalogRows(tx, rows) {
  const stats = {
    input: rows.length,
    created: 0,
    updated: 0,
    skippedExistingNaturalKey: 0,
    skippedDuplicateInput: 0
  };
  if (!rows.length) return stats;
  if (typeof tx.romaneioCatalogItem.findMany !== 'function' || typeof tx.romaneioCatalogItem.createMany !== 'function') {
    for (const row of rows) {
      await upsertCatalogRow(tx, row);
    }
    return { ...stats, created: rows.length };
  }

  const sourceRows = rows.filter(row => row.sourceType && row.sourceId);
  const sourceTypes = Array.from(new Set(sourceRows.map(row => row.sourceType)));
  const sourceIds = Array.from(new Set(sourceRows.map(row => row.sourceId)));
  const existingBySource = new Map();
  if (sourceTypes.length && sourceIds.length) {
    const existingSourceRows = await tx.romaneioCatalogItem.findMany({
      where: {
        sourceType: { in: sourceTypes },
        sourceId: { in: sourceIds }
      },
      select: {
        id: true,
        sourceType: true,
        sourceId: true,
        code: true,
        name: true,
        categoryName: true,
        kind: true,
        measureType: true,
        defaultUnitLabel: true,
        isSerialized: true,
        isActive: true,
        hiddenInRomaneioAt: true
      }
    });
    for (const existing of existingSourceRows) {
      existingBySource.set(catalogSourceKey(existing.sourceType, existing.sourceId), existing);
    }
  }

  const rowsWithoutSourceMatch = [];
  for (const row of rows) {
    const existing = row.sourceType && row.sourceId
      ? existingBySource.get(catalogSourceKey(row.sourceType, row.sourceId))
      : null;
    if (!existing) {
      rowsWithoutSourceMatch.push(row);
      continue;
    }

    const data = dataForExistingCatalogRow(existing, row);
    if (!catalogRowNeedsUpdate(existing, data)) continue;

    // Resolve colisão no índice único (categoryName, code, name) ANTES do update:
    // se a chave de destino já está ocupada por outra linha, a autoritativa
    // (RDO-owned: EQUIPAMENTOS/UNIT/PARTICLE_COUNTER) vence e a legada (FILE/MANUAL)
    // é removida. Sem isso, renomear categoria fazia o sync quebrar com P2002 e nunca
    // salvar o sourceHash — travando toda gravação. (O índice ignora isActive, então
    // desativar não bastaria: a linha conflitante precisa sair.)
    if (typeof tx.romaneioCatalogItem.findFirst === 'function'
      && typeof tx.romaneioCatalogItem.delete === 'function') {
      const targetCategoryName = data.categoryName ?? existing.categoryName;
      const targetCode = data.code ?? existing.code;
      const targetName = data.name ?? existing.name;
      const conflict = await tx.romaneioCatalogItem.findFirst({
        where: {
          categoryName: targetCategoryName,
          code: targetCode,
          name: targetName,
          NOT: { id: existing.id }
        },
        select: { id: true, sourceType: true }
      });
      if (conflict) {
        const currentIsOwned = RDO_OWNED_CATALOG_SOURCES.has(existing.sourceType);
        const conflictIsOwned = RDO_OWNED_CATALOG_SOURCES.has(conflict.sourceType);
        if (currentIsOwned && !conflictIsOwned) {
          await tx.romaneioCatalogItem.delete({ where: { id: conflict.id } });
        } else {
          // Esta linha cede a vez para a que já ocupa a chave (evita o P2002).
          continue;
        }
      }
    }

    await tx.romaneioCatalogItem.update({
      where: { id: existing.id },
      data
    });
    stats.updated += 1;
  }

  if (!rowsWithoutSourceMatch.length) return stats;

  const existingByNaturalKey = new Set();
  const naturalConditions = rowsWithoutSourceMatch.map(row => ({
    categoryName: row.categoryName,
    code: row.code,
    name: row.name
  }));
  if (naturalConditions.length) {
    // Apenas linhas ATIVAS bloqueiam a criação por chave natural. Itens
    // desativados (ex.: original do romaneio ao migrar para o módulo) não devem
    // impedir a criação da nova linha gerenciada (sourceType EQUIPAMENTOS).
    const existingNaturalRows = await tx.romaneioCatalogItem.findMany({
      where: { isActive: true, OR: naturalConditions },
      select: { categoryName: true, code: true, name: true }
    });
    for (const existing of existingNaturalRows) {
      existingByNaturalKey.add(catalogNaturalKey(existing));
    }
  }

  const data = [];
  const seenNewRows = new Set();
  for (const row of rowsWithoutSourceMatch) {
    const key = catalogNaturalKey(row);
    if (existingByNaturalKey.has(key)) {
      stats.skippedExistingNaturalKey += 1;
      continue;
    }
    if (seenNewRows.has(key)) {
      stats.skippedDuplicateInput += 1;
      continue;
    }
    seenNewRows.add(key);
    data.push(row);
  }
  if (!data.length) return stats;

  await tx.romaneioCatalogItem.createMany({
    data,
    skipDuplicates: true
  });
  stats.created += data.length;
  return stats;
}

async function syncFileCatalogRows(tx, rows) {
  if (!Array.isArray(rows)) return { input: 0, created: 0, updated: 0, skippedExistingNaturalKey: 0, skippedDuplicateInput: 0 };
  const stats = await syncCatalogRows(tx, rows);
  const currentSourceIds = rows.map(row => row.sourceId).filter(Boolean);
  if (!currentSourceIds.length) {
    console.warn('[ROMANEIO CATALOG SYNC]', {
      message: 'Fonte de catálogo por arquivo veio vazia; desativação de itens FILE foi ignorada.'
    });
    return stats;
  }
  await tx.romaneioCatalogItem.updateMany({
    where: {
      sourceType: 'FILE',
      sourceId: { notIn: currentSourceIds },
      hiddenInRomaneioAt: null
    },
    data: { isActive: false }
  });
  return stats;
}

function mergeCatalogSyncStats(...items) {
  return items.reduce((acc, item) => {
    acc.input += item?.input || 0;
    acc.created += item?.created || 0;
    acc.updated += item?.updated || 0;
    acc.skippedExistingNaturalKey += item?.skippedExistingNaturalKey || 0;
    acc.skippedDuplicateInput += item?.skippedDuplicateInput || 0;
    return acc;
  }, { input: 0, created: 0, updated: 0, skippedExistingNaturalKey: 0, skippedDuplicateInput: 0 });
}

function logCatalogSyncStats(stats) {
  if (!stats.skippedExistingNaturalKey && !stats.skippedDuplicateInput) return;
  console.warn('[ROMANEIO CATALOG SYNC]', {
    message: 'Alguns itens de catálogo foram ignorados por colisão de chave natural ou duplicidade de entrada.',
    ...stats
  });
}

async function runRomaneioCatalogSync() {
  const fileRows = await readFileCatalogRows();
  await prisma.$transaction(async tx => {
    const equipmentList = await tx.companyEquipment.findMany({
      where: { isActive: true, category: { is: { syncToRomaneio: true } } },
      include: { category: true }
    });
    const equipmentRows = buildEquipmentCatalogRows(equipmentList);
    const sourceHash = catalogRowsHash({ fileRows, equipmentRows });

    if (tx.romaneioCatalogSyncState) {
      const state = await tx.romaneioCatalogSyncState.findUnique({
        where: { id: ROMANEIO_CATALOG_SYNC_STATE_ID },
        select: { sourceHash: true }
      });
      if (state?.sourceHash === sourceHash) return;
    }

    const stats = mergeCatalogSyncStats(
      await syncFileCatalogRows(tx, fileRows),
      await syncCatalogRows(tx, equipmentRows)
    );
    logCatalogSyncStats(stats);

    if (tx.romaneioCatalogSyncState) {
      await tx.romaneioCatalogSyncState.upsert({
        where: { id: ROMANEIO_CATALOG_SYNC_STATE_ID },
        create: {
          id: ROMANEIO_CATALOG_SYNC_STATE_ID,
          sourceHash,
          syncedAt: new Date()
        },
        update: {
          sourceHash,
          syncedAt: new Date()
        }
      });
    }
  }, { timeout: 30_000 });
  lastSuccessfulCatalogSyncAt = Date.now();
}

function startRomaneioCatalogSync() {
  if (!catalogSyncInFlight) {
    catalogSyncInFlight = runRomaneioCatalogSync()
      .then(() => ({ synced: true }))
      .finally(() => {
        catalogSyncInFlight = null;
      });
  }

  return catalogSyncInFlight;
}

export async function syncRomaneioCatalog() {
  await startRomaneioCatalogSync();
}

export async function ensureRomaneioCatalogSynced({ ttlMs = ROMANEIO_CATALOG_SYNC_TTL_MS } = {}) {
  const now = Date.now();
  if (lastSuccessfulCatalogSyncAt && now - lastSuccessfulCatalogSyncAt < ttlMs) {
    return { synced: false };
  }

  return startRomaneioCatalogSync();
}
