import assert from 'node:assert/strict';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

// Explicit category aliases; an alias alone NEVER identifies an individual asset.
// Referenced assets must also have the same unique inventory code.
const CATEGORY_FAMILIES = [
  ['Boroscópios'],
  ['Centrífuga', 'Unidades de Centrífuga'],
  ['Contador de Partículas', 'Contadores de Partículas'],
  ['Contenções Plásticas', 'Contenções'],
  ['Phmetro', 'pHmetros'],
  ['Reservatório', 'Reservatório de inox', 'Reservatório de aço carbono'],
  ['Trafo', 'Trafos'],
  ['UNIDADE DE RUN OUT', 'Unidades de Run out'],
  ['UNIDADE MÓVEL DE TRANSFERÊNCIA', 'Unidades Moveis de Transferência'],
  ['Unidade de Compressor', 'Compressores'],
  ['Unidade de filtragem', 'Unidades de Filtragem'],
  ['Unidade de Flushing', 'Unidades de Flushing Primário', 'Unidades de Flushing'],
  ['Unidade de Limpeza Química', 'Unidades de Limpeza Química'],
  ['Unidade de Teste Hidrostático', 'Unidades de Teste Hidrostático'],
  ['Unidade de desidratação', 'Unidades de Termovácuo']
];
const LEGACY_SOURCES = new Set(['FILE', 'MANUAL', 'UNIT', 'PARTICLE_COUNTER']);
const normalizeCategory = value => String(value || '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
const familyByCategory = new Map(CATEGORY_FAMILIES.flatMap((names, index) =>
  names.map(name => [normalizeCategory(name), index])));
const family = row => familyByCategory.get(normalizeCategory(row.categoryName)) ?? normalizeCategory(row.categoryName);

export function normalizeAssetCode(value) {
  // Spaces and leading numeric zeroes are formatting; prefixes remain significant.
  const code = String(value || '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]+\d+$/.test(code)) return null;
  return code.replace(/^([A-Z]+)0+(\d+)$/, '$1$2');
}

function referenceId(value, candidates) {
  if (typeof value !== 'string') return null;
  const id = value.replace(/^(catalog:|extra:)/, '');
  return candidates.has(id) ? id : null;
}

function draftReferences(value, candidates, found = new Set()) {
  const id = referenceId(value, candidates);
  if (id) found.add(id);
  if (Array.isArray(value)) value.forEach(entry => draftReferences(entry, candidates, found));
  else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      const keyId = referenceId(key, candidates);
      if (keyId) found.add(keyId);
      draftReferences(entry, candidates, found);
    }
  }
  return found;
}

export function rewriteDraftReferences(value, replacements, location = 'payload') {
  if (typeof value === 'string') {
    const id = referenceId(value, replacements);
    return id ? value.replace(id, replacements.get(id).id) : value;
  }
  if (Array.isArray(value)) {
    // Preserve rows and quantities even when legacy and canonical rows coexist.
    return value.map((entry, index) => rewriteDraftReferences(entry, replacements, `${location}[${index}]`));
  }
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    const nextKey = rewriteDraftReferences(key, replacements);
    const nextValue = rewriteDraftReferences(entry, replacements, `${location}.${key}`);
    if (Object.hasOwn(result, nextKey) && !isDeepStrictEqual(result[nextKey], nextValue)) {
      throw new Error(`Colisão de referências no rascunho: ${location}.${nextKey}`);
    }
    Object.defineProperty(result, nextKey, { value: nextValue, enumerable: true, configurable: true });
  }
  return result;
}

export function buildConsolidationPlan({ catalog, equipment, items, checklists, drafts = [] }) {
  const equipmentById = new Map(equipment.map(row => [row.id, row]));
  const canonical = catalog.filter(row => {
    const asset = equipmentById.get(row.sourceId);
    return row.sourceType === 'EQUIPAMENTOS' && row.kind === 'EQUIPMENT'
      && row.measureType === 'UNIT' && row.isSerialized && asset?.category?.syncToRomaneio
      && normalizeAssetCode(row.code) && normalizeAssetCode(row.code) === normalizeAssetCode(asset.code);
  });
  const enabledFamilies = new Set(canonical.filter(row => row.isActive && !row.hiddenInRomaneioAt
    && equipmentById.get(row.sourceId).isActive).map(family).filter(id => id !== undefined));
  const candidates = catalog.filter(row => LEGACY_SOURCES.has(row.sourceType)
    && row.kind === 'EQUIPMENT' && enabledFamilies.has(family(row)));
  const candidateIds = new Set(candidates.map(row => row.id));
  const references = new Set([...items, ...checklists].map(row => row.catalogItemId).filter(Boolean));
  const draftIds = new Set(drafts.flatMap(row => [...draftReferences(row.payload, candidateIds)]));
  const replacements = new Map();
  const blockers = [];
  const categories = [];
  for (const source of candidates) {
    const code = normalizeAssetCode(source.code);
    const matches = canonical.filter(target => code && normalizeAssetCode(target.code) === code
      && family(source) === family(target));
    const referenced = references.has(source.id) || draftIds.has(source.id);
    const compatible = matches.length === 1 && source.measureType === matches[0].measureType
      && source.isSerialized;
    if (referenced && !compatible) {
      blockers.push({ id: source.id, code: source.code, category: source.categoryName,
        reason: 'Item em uso sem correspondência única e compatível por código patrimonial.' });
    } else if (compatible) {
      const target = matches[0];
      if (draftIds.has(source.id) && (!target.isActive || target.hiddenInRomaneioAt
        || !equipmentById.get(target.sourceId).isActive)) {
        blockers.push({ id: source.id, reason: 'O destino do rascunho está inativo.' });
      }
      replacements.set(source.id, target);
    }
    let category = categories.find(row => row.name === source.categoryName);
    if (!category) {
      category = { name: source.categoryName, legacyItems: 0, activeToRemove: 0, toRemove: 0,
        itemReferences: 0, checklistReferences: 0, draftReferences: 0 };
      categories.push(category);
    }
    category.legacyItems++;
    category.activeToRemove += source.isActive ? 1 : 0;
    category.toRemove += source.isActive || !source.hiddenInRomaneioAt ? 1 : 0;
    category.itemReferences += items.filter(row => row.catalogItemId === source.id).length;
    category.checklistReferences += checklists.filter(row => row.catalogItemId === source.id).length;
    category.draftReferences += draftIds.has(source.id) ? 1 : 0;
  }
  const draftUpdates = [];
  for (const draft of drafts) {
    try {
      const payload = rewriteDraftReferences(draft.payload, replacements);
      if (!isDeepStrictEqual(payload, draft.payload)) draftUpdates.push({ id: draft.id, payload });
    } catch (error) {
      blockers.push({ id: draft.id, reason: error.message });
    }
  }
  const itemUpdates = items.filter(row => replacements.has(row.catalogItemId)).map(row => ({
    id: row.id, catalogItemId: replacements.get(row.catalogItemId).id
  }));
  const checklistUpdates = checklists.filter(row => replacements.has(row.catalogItemId)).map(row => ({
    id: row.id, catalogItemId: replacements.get(row.catalogItemId).id,
    equipmentId: replacements.get(row.catalogItemId).sourceId
  }));
  const retirementIds = candidates.filter(row => row.isActive || !row.hiddenInRomaneioAt).map(row => row.id);
  return {
    blockers, categories, retirementIds, itemUpdates, checklistUpdates, draftUpdates,
    mappings: [...replacements].map(([fromId, target]) => ({ fromId, toId: target.id, code: target.code })),
    summary: {
      categories: categories.length,
      catalogItemsToRemove: retirementIds.length,
      activeCatalogItemsToRemove: candidates.filter(row => row.isActive).length,
      itemReferencesToMigrate: itemUpdates.length,
      romaneiosAffected: new Set(items.filter(row => replacements.has(row.catalogItemId)).map(row => row.romaneioId)).size,
      checklistReferencesToMigrate: checklistUpdates.length,
      draftsToMigrate: draftUpdates.length,
      blockers: blockers.length
    }
  };
}

export async function readSnapshot(tx) {
  const [catalog, equipment, items, checklists, drafts] = await Promise.all([
    tx.romaneioCatalogItem.findMany({ orderBy: { id: 'asc' } }),
    tx.companyEquipment.findMany({ select: {
      id: true, code: true, name: true, isActive: true,
      category: { select: { id: true, name: true, syncToRomaneio: true } }
    }, orderBy: { id: 'asc' } }),
    tx.romaneioItem.findMany({ orderBy: { id: 'asc' } }),
    tx.romaneioChecklist.findMany({ orderBy: { id: 'asc' } }),
    tx.reportDraft.findMany({ where: { payload: { path: ['__module'], equals: 'romaneio' } }, orderBy: { id: 'asc' } })
  ]);
  return { catalog, equipment, items, checklists, drafts };
}

async function writeBackup(filePath, snapshot, plan) {
  // Exclusive creation prevents overwriting a previous backup; fsync precedes every DB write.
  const file = await open(filePath, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify({ version: 1, preparedAt: new Date().toISOString(), snapshot, plan }, null, 2));
    await file.sync();
  } finally {
    await file.close();
  }
}

export async function applyConsolidationPlan(tx, snapshot, plan, removedAt = new Date()) {
  assert.equal(plan.blockers.length, 0, 'A migração contém correspondências pendentes.');
  for (const { id, ...data } of plan.itemUpdates) {
    await tx.romaneioItem.update({ where: { id }, data });
  }
  for (const { id, ...data } of plan.checklistUpdates) {
    await tx.romaneioChecklist.update({ where: { id }, data });
  }
  for (const { id, payload } of plan.draftUpdates) {
    await tx.reportDraft.update({ where: { id }, data: { payload } });
  }
  // Same logical deletion as DELETE /romaneios/catalog/:id. Keeping the tombstone
  // is necessary: the seed file would recreate physically deleted native rows.
  if (plan.retirementIds.length) {
    await tx.romaneioCatalogItem.updateMany({
      where: { id: { in: plan.retirementIds } },
      data: { isActive: false, hiddenInRomaneioAt: removedAt }
    });
  }
  const after = await readSnapshot(tx);
  const remaining = buildConsolidationPlan(after);
  assert.deepEqual(remaining.blockers, [], 'Restaram referências sem correspondência.');
  assert.equal(remaining.itemUpdates.length + remaining.checklistUpdates.length
    + remaining.draftUpdates.length + remaining.retirementIds.length, 0, 'A migração não foi concluída.');
  const updates = new Map(plan.itemUpdates.map(row => [row.id, row]));
  assert.deepEqual(after.items, snapshot.items.map(row => ({ ...row,
    ...(updates.has(row.id) ? { catalogItemId: updates.get(row.id).catalogItemId } : {})
  })), 'Os itens históricos devem preservar nomes, códigos, categorias, quantidades e ordem.');
  assert.deepEqual(after.equipment, snapshot.equipment, 'O cadastro de Equipamentos deve ser preservado.');
  const withoutUpdatedAt = rows => rows.map(({ updatedAt: _updatedAt, ...row }) => row);
  const checklistUpdates = new Map(plan.checklistUpdates.map(row => [row.id, row]));
  assert.deepEqual(withoutUpdatedAt(after.checklists), withoutUpdatedAt(snapshot.checklists.map(row => ({
    ...row, ...(checklistUpdates.get(row.id) || {})
  }))), 'As respostas e os documentos dos checklists devem ser preservados.');
  const draftUpdates = new Map(plan.draftUpdates.map(row => [row.id, row]));
  assert.deepEqual(withoutUpdatedAt(after.drafts), withoutUpdatedAt(snapshot.drafts.map(row => ({
    ...row, ...(draftUpdates.get(row.id) || {})
  }))), 'Os rascunhos devem preservar todos os dados além das referências migradas.');
  const retired = new Set(plan.retirementIds);
  assert.deepEqual(withoutUpdatedAt(after.catalog), withoutUpdatedAt(snapshot.catalog.map(row => ({
    ...row, ...(retired.has(row.id) ? { isActive: false, hiddenInRomaneioAt: removedAt } : {})
  }))), 'A exclusão deve preservar os demais dados do catálogo.');
}

async function main() {
  const args = process.argv.slice(2);
  let apply = false;
  let backupPath;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--apply') apply = true;
    else if (args[i] === '--dry-run') continue;
    else if (args[i] === '--backup' && args[i + 1] && !args[i + 1].startsWith('--')) backupPath = path.resolve(args[++i]);
    else throw new Error(`Argumento inválido: ${args[i]}`);
  }
  if (apply && !backupPath) throw new Error('--apply exige --backup /caminho/arquivo.json (arquivo novo).');
  const { default: prisma } = await import('../src/lib/prisma.js');
  try {
    const result = await prisma.$transaction(async tx => {
      if (apply) {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '10s'");
        // Prevent catalog sync, new items, drafts or equipment edits during backup + migration.
        await tx.$executeRawUnsafe('LOCK TABLE "EquipmentCategory", "CompanyEquipment", "RomaneioCatalogItem", "Romaneio", "RomaneioItem", "RomaneioChecklist", "ReportDraft" IN SHARE ROW EXCLUSIVE MODE');
      }
      const snapshot = await readSnapshot(tx);
      const plan = buildConsolidationPlan(snapshot);
      const report = { mode: apply ? 'apply' : 'dry-run', ...plan.summary, categories: plan.categories,
        blockers: plan.blockers, mappings: plan.mappings };
      if (apply) {
        if (plan.blockers.length) throw new Error(JSON.stringify(report, null, 2));
        await writeBackup(backupPath, snapshot, plan);
        await applyConsolidationPlan(tx, snapshot, plan);
        report.backupPath = backupPath;
      }
      return report;
    }, { timeout: 60_000, ...(apply ? {} : { isolationLevel: 'RepeatableRead' }) });
    console.log(JSON.stringify(result, null, 2));
    if (result.blockers.length) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
