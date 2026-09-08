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
      projectId: true,
      romaneioDate: true,
      items: {
        where: { catalogItem: { sourceType: 'EQUIPAMENTOS' } },
        select: { itemCode: true, itemName: true, catalogItem: { select: { sourceId: true, code: true, name: true } } }
      }
    }
  });

  const byProject = new Map(); // projectId -> Map(key -> { code, name, sinceDate })
  for (const romaneio of romaneios) {
    for (const item of romaneio.items) {
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
