// Vínculo entre equipamento e item do catálogo do Romaneio.
//
import { qrPageUrl } from './qr-link.js';

// Equipamentos de categorias com "Sincronizar com o Romaneio" viram itens do catálogo
// (`sourceType: 'EQUIPAMENTOS'`, `sourceId` = id do equipamento). O QR code da etiqueta do Romaneio
// codifica o id do ITEM DE CATÁLOGO, então o módulo Equipamentos precisa dele para exibir o mesmo QR.

// Map(equipmentId -> { id, publicToken }) apenas para os equipamentos que têm item ativo no catálogo.
export async function romaneioCatalogIdsByEquipment(client, equipmentIds) {
  const ids = [...new Set((equipmentIds || []).filter(Boolean))];
  const byEquipment = new Map();
  if (!ids.length) return byEquipment;
  const rows = await client.romaneioCatalogItem.findMany({
    where: { sourceType: 'EQUIPAMENTOS', sourceId: { in: ids }, isActive: true },
    select: { id: true, sourceId: true, publicToken: true }
  });
  for (const row of rows) byEquipment.set(row.sourceId, { id: row.id, publicToken: row.publicToken });
  return byEquipment;
}

// Acrescenta `romaneioCatalogItemId` (string | null) a cada equipamento serializado.
export async function withRomaneioCatalogIds(client, items) {
  const list = Array.isArray(items) ? items : [items];
  const ids = await romaneioCatalogIdsByEquipment(client, list.map(item => item?.id));
  const enriched = list.map(item => {
    if (!item) return item;
    const link = ids.get(item.id);
    return {
      ...item,
      romaneioCatalogItemId: link?.id || null,
      // Link da página pública do QR code (o QR codifica esta URL).
      romaneioQrUrl: link ? qrPageUrl(link.publicToken) : null
    };
  });
  return Array.isArray(items) ? enriched : enriched[0];
}
