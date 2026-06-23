// Catálogo fixo dos "slots" de equipamento do formulário de RDO. Cada slot é um
// ponto onde o relatório seleciona equipamentos de uma categoria. O gestor pode
// reconfigurar qual categoria alimenta cada slot (tabela RdoEquipmentSlot); o
// catálogo abaixo define os slots existentes, seu tipo de seleção e a categoria
// padrão (por systemKey) usada quando não há configuração explícita.

import prisma from './prisma.js';

export const RdoSlotKind = {
  UNITS_MULTI: 'UNITS_MULTI', // múltipla seleção (unidades)
  UNIT_SINGLE: 'UNIT_SINGLE', // seleção única (ex.: desidratação)
  MANOMETER_MULTI: 'MANOMETER_MULTI', // múltipla seleção (manômetros)
  COUNTER_SINGLE: 'COUNTER_SINGLE' // seleção única (contador de partículas)
};

// fieldLabel = rótulo sob o qual o valor é gravado no relatório (não pode mudar
// para não quebrar a resolução no salvamento). label = texto exibido na config.
export const RDO_EQUIPMENT_SLOTS = [
  { key: 'limpeza.ulq', serviceType: 'limpeza', fieldLabel: 'Unidade de Limpeza Química', label: 'Limpeza química · Unidade de Limpeza Química', kind: RdoSlotKind.UNITS_MULTI, defaultSystemKey: 'unit:LIMPEZA_QUIMICA' },
  { key: 'pressao.uth', serviceType: 'pressao', fieldLabel: 'Unidade de Teste Hidrostático (UTH)', label: 'Teste de pressão · Unidade de Teste Hidrostático (UTH)', kind: RdoSlotKind.UNITS_MULTI, defaultSystemKey: 'unit:UTH' },
  { key: 'pressao.manometros', serviceType: 'pressao', fieldLabel: 'Manômetros', label: 'Teste de pressão · Manômetros', kind: RdoSlotKind.MANOMETER_MULTI, defaultSystemKey: 'manometer' },
  { key: 'flushing.primario', serviceType: 'flushing', fieldLabel: 'Unidade de Flushing', label: 'Flushing primário · Unidade de Flushing', kind: RdoSlotKind.UNITS_MULTI, defaultSystemKey: 'unit:FLUSHING' },
  { key: 'flushing.secundario', serviceType: 'flushing', fieldLabel: 'Unidade de filtragem', label: 'Flushing secundário · Unidade de filtragem', kind: RdoSlotKind.UNITS_MULTI, defaultSystemKey: 'unit:FILTRAGEM' },
  { key: 'flushing.particulas', serviceType: 'flushing', fieldLabel: 'Contador utilizado', label: 'Flushing · Contador de partículas', kind: RdoSlotKind.COUNTER_SINGLE, defaultSystemKey: 'particle_counter' },
  { key: 'flushing.desidratacao', serviceType: 'flushing', fieldLabel: 'Equipamento de desidratação', label: 'Flushing · Equipamento de desidratação', kind: RdoSlotKind.UNIT_SINGLE, defaultSystemKey: 'unit:DESIDRATACAO' },
  { key: 'filtragem.ufg', serviceType: 'filtragem', fieldLabel: 'Unidade de filtragem', label: 'Filtragem · Unidade de filtragem', kind: RdoSlotKind.UNITS_MULTI, defaultSystemKey: 'unit:FILTRAGEM' },
  { key: 'filtragem.particulas', serviceType: 'filtragem', fieldLabel: 'Contador utilizado', label: 'Filtragem · Contador de partículas', kind: RdoSlotKind.COUNTER_SINGLE, defaultSystemKey: 'particle_counter' },
  { key: 'filtragem.desidratacao', serviceType: 'filtragem', fieldLabel: 'Equipamento de desidratação', label: 'Filtragem · Equipamento de desidratação', kind: RdoSlotKind.UNIT_SINGLE, defaultSystemKey: 'unit:DESIDRATACAO' }
];

const SLOTS_BY_KEY = new Map(RDO_EQUIPMENT_SLOTS.map(slot => [slot.key, slot]));

export function getSlot(slotKey) {
  return SLOTS_BY_KEY.get(slotKey) || null;
}

// Lê as categorias de um override (campo `categoryIds` em array; cai para o legado
// `categoryId` quando o array está vazio/ausente).
function overrideCategoryIds(override) {
  const list = Array.isArray(override?.categoryIds) ? override.categoryIds : [];
  if (list.length) return list;
  return override?.categoryId ? [override.categoryId] : [];
}

// Resolve { slotKey: categoryId[] } combinando os overrides salvos com os padrões
// (por systemKey). Cada slot pode apontar para VÁRIAS categorias — no preenchimento
// do relatório os equipamentos de todas elas aparecem numa lista só. Retorna também
// a lista de slots do catálogo com as categorias efetivas, útil para a config.
export async function resolveRdoSlotMap(client = prisma) {
  const [overrides, categories] = await Promise.all([
    client.rdoEquipmentSlot.findMany(),
    client.equipmentCategory.findMany({ where: { isActive: true }, select: { id: true, systemKey: true } })
  ]);
  const categoryIdBySystemKey = new Map(categories.map(c => [c.systemKey, c.id]));
  const validCategoryIds = new Set(categories.map(c => c.id));
  const overrideByKey = new Map(overrides.map(o => [o.slotKey, o]));

  const map = {};
  const slots = RDO_EQUIPMENT_SLOTS.map(slot => {
    let categoryIds;
    if (overrideByKey.has(slot.key)) {
      categoryIds = overrideCategoryIds(overrideByKey.get(slot.key)).filter(id => validCategoryIds.has(id));
    } else {
      const def = categoryIdBySystemKey.get(slot.defaultSystemKey);
      categoryIds = def ? [def] : [];
    }
    map[slot.key] = categoryIds;
    return { ...slot, categoryIds };
  });

  return { map, slots };
}

// Conjunto de categoryIds atualmente vinculados a algum slot (overrides + padrões).
export async function categoryIdsLinkedToRdo(client = prisma) {
  const { map } = await resolveRdoSlotMap(client);
  return new Set(Object.values(map).flat().filter(Boolean));
}
