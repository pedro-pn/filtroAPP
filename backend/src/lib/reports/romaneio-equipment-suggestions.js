function assetCode(value) {
  const code = String(value || '').replace(/[\s-]+/g, '').toUpperCase();
  return /^[A-Z]+\d+$/.test(code) ? code.replace(/^([A-Z]+)0+(\d+)$/, '$1$2') : null;
}

// Retorna somente IDs que o formulário pode selecionar, sem expor o romaneio.
export async function reportRomaneioEquipmentByProject(client, projectIds, equipments) {
  const allowedProjects = new Set(projectIds);
  const activeEquipment = equipments.filter(item => item.isActive !== false);
  if (!allowedProjects.size || !activeEquipment.length) return {};

  const byId = new Map(activeEquipment.map(item => [item.id, item]));
  const byCode = new Map();
  for (const item of activeEquipment) {
    const code = assetCode(item.code);
    if (code) byCode.set(code, [...(byCode.get(code) || []), item.id]);
  }
  const items = await client.romaneioItem.findMany({
    where: {
      romaneio: { projectId: { in: [...allowedProjects] }, type: 'OUTBOUND' },
      kind: 'EQUIPMENT',
      quantity: { gt: 0 }
    },
    select: {
      itemCode: true,
      romaneio: { select: { projectId: true } },
      catalogItem: { select: { sourceType: true, sourceId: true } }
    }
  });
  const result = new Map();
  for (const item of items) {
    const projectId = item.romaneio.projectId;
    if (!allowedProjects.has(projectId) || item.catalogItem?.sourceType === 'STOCK') continue;
    let equipmentId;
    if (item.catalogItem?.sourceType === 'EQUIPAMENTOS') {
      // O vínculo explícito prevalece, inclusive quando o equipamento foi inativado.
      equipmentId = byId.has(item.catalogItem.sourceId) ? item.catalogItem.sourceId : null;
    } else {
      // Romaneios antigos e itens avulsos podem guardar apenas o patrimônio.
      const matches = byCode.get(assetCode(item.itemCode)) || [];
      equipmentId = matches.length === 1 ? matches[0] : null;
    }
    if (!equipmentId) continue;
    if (!result.has(projectId)) result.set(projectId, new Set());
    result.get(projectId).add(equipmentId);
  }
  return Object.fromEntries([...result].map(([projectId, ids]) => [projectId, [...ids]]));
}
