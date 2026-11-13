// Vínculo entre equipamento e item do catálogo do Romaneio.
//
// Equipamentos de categorias com "Sincronizar com o Romaneio" viram itens do catálogo
// (`sourceType: 'EQUIPAMENTOS'`, `sourceId` = id do equipamento). O QR code da etiqueta do Romaneio
// codifica o id do ITEM DE CATÁLOGO, então o módulo Equipamentos precisa dele para exibir o mesmo QR.

// Map(equipmentId -> catalogItemId) apenas para os equipamentos que têm item ativo no catálogo.
export async function romaneioCatalogIdsByEquipment(client, equipmentIds) {
  const ids = [...new Set((equipmentIds || []).filter(Boolean))];
  const byEquipment = new Map();
  if (!ids.length) return byEquipment;
  const rows = await client.romaneioCatalogItem.findMany({
    where: { sourceType: 'EQUIPAMENTOS', sourceId: { in: ids }, isActive: true },
    select: { id: true, sourceId: true }
  });
  for (const row of rows) byEquipment.set(row.sourceId, row.id);
  return byEquipment;
}

// Acrescenta `romaneioCatalogItemId` (string | null) a cada equipamento serializado.
export async function withRomaneioCatalogIds(client, items) {
  const list = Array.isArray(items) ? items : [items];
  const ids = await romaneioCatalogIdsByEquipment(client, list.map(item => item?.id));
  const enriched = list.map(item => (item ? { ...item, romaneioCatalogItemId: ids.get(item.id) || null } : item));
  return Array.isArray(items) ? enriched : enriched[0];
}
