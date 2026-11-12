/*
 * Tempo de equipamento por projeto (módulo Acompanhamento).
 *
 * "Saída" = romaneio OUTBOUND (viagem para a obra). Considera apenas itens cujo catálogo veio do
 * módulo Equipamentos (`RomaneioCatalogItem.sourceType = 'EQUIPAMENTOS'` → equipamento cadastrado).
 * Retorna, por projeto, a data de saída MAIS ANTIGA de cada equipamento. O tempo (dias) até o "final
 * do projeto" é calculado por quem consome (project-cards), pois depende do status do projeto.
 */

import prisma from '../prisma.js';

// projectIds -> Map projectId -> [{ code, name, sinceDate }] (saída mais antiga por equipamento).
export async function getEquipmentUsageByProject(projectIds) {
  const result = new Map();
  if (!projectIds?.length) return result;

  const romaneios = await prisma.romaneio.findMany({
    where: { projectId: { in: projectIds }, type: 'OUTBOUND' },
    select: {
      id: true,
      projectId: true,
      romaneioDate: true
    }
  });
  if (!romaneios.length) return result;
  // Keep protected parent/child queries and their order. Empty logistics must
  // not dispatch item/catalog reads; resolve only selected catalog identities.
  const items = await prisma.romaneioItem.findMany({
    where: { romaneioId: { in: romaneios.map(row => row.id) }, catalogItem: { sourceType: 'EQUIPAMENTOS' } },
    select: { romaneioId: true, itemCode: true, itemName: true, catalogItemId: true }
  });
  if (!items.length) return result;
  const catalogIds = [...new Set(items.map(row => row.catalogItemId).filter(Boolean))];
  const catalog = catalogIds.length ? await prisma.romaneioCatalogItem.findMany({
    where: { id: { in: catalogIds } }, select: { id: true, sourceId: true, code: true, name: true }
  }) : [];
  const catalogById = new Map(catalog.map(({ id, ...row }) => [id, row]));
  const itemsByRomaneio = new Map();
  for (const item of items) {
    if (!itemsByRomaneio.has(item.romaneioId)) itemsByRomaneio.set(item.romaneioId, []);
    itemsByRomaneio.get(item.romaneioId).push({ ...item, catalogItem: catalogById.get(item.catalogItemId) ?? null });
  }

  const byProject = new Map(); // projectId -> Map(key -> { code, name, sinceDate })
  for (const romaneio of romaneios) {
    for (const item of itemsByRomaneio.get(romaneio.id) || []) {
      const key = item.catalogItem?.sourceId || item.itemName;
      if (!key) continue;
      let equipMap = byProject.get(romaneio.projectId);
      if (!equipMap) { equipMap = new Map(); byProject.set(romaneio.projectId, equipMap); }
      const name = item.catalogItem?.name || item.itemName;
      const code = item.catalogItem?.code || item.itemCode || null;
      const existing = equipMap.get(key);
      if (!existing || new Date(romaneio.romaneioDate) < new Date(existing.sinceDate)) {
        equipMap.set(key, { code, name, sinceDate: romaneio.romaneioDate });
      }
    }
  }

  for (const [projectId, equipMap] of byProject) result.set(projectId, [...equipMap.values()]);
  return result;
}
