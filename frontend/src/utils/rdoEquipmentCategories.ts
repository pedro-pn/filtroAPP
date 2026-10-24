export interface EquipmentOption {
  id: string;
  code: string;
  name?: string;
  categoryId?: string;
  serialNumber?: string;
  scale?: string;
  isActive?: boolean;
}

export interface RdoEquipmentCategory {
  id: string;
  name: string;
}

export interface EquipmentSlotSource {
  key: string;
  primaryIds: string[];
  secondaryIds: string[];
  categories: RdoEquipmentCategory[];
  equipments: EquipmentOption[];
}

function storedCategories(data: Record<string, unknown>): Record<string, unknown> {
  const value = data.__equipmentSlotCategories;
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function resolveEquipmentSlot(source: EquipmentSlotSource | undefined, data: Record<string, unknown>, selectedIds: string[]) {
  if (!source) return null;
  const allowed = [...new Set([...source.primaryIds, ...source.secondaryIds])];
  const stored = storedCategories(data)[source.key];
  const saved = Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string' && allowed.includes(id)) : [];
  // Relatórios anteriores à escolha de categorias continuam exibindo os equipamentos já selecionados.
  const inferred = source.equipments.filter(item => selectedIds.includes(item.id) && item.categoryId && allowed.includes(item.categoryId)).map(item => item.categoryId!);
  const categoryIds = saved.length ? [...new Set(saved)] : [...new Set([...source.primaryIds, ...inferred])];
  const options = source.equipments.filter(item => item.isActive !== false && item.categoryId
    && (categoryIds.includes(item.categoryId) || selectedIds.includes(item.id)));
  return { categoryIds, options };
}

export function equipmentCategoryPatch(source: EquipmentSlotSource, data: Record<string, unknown>, categoryIds: string[]) {
  const allowed = new Set([...source.primaryIds, ...source.secondaryIds]);
  const selected = [...new Set(categoryIds.filter(id => allowed.has(id)))];
  return { __equipmentSlotCategories: { ...storedCategories(data), [source.key]: selected } };
}

export function retainSlotEquipment(source: EquipmentSlotSource, categoryIds: string[], selectedIds: string[]) {
  return selectedIds.filter(id => source.equipments.some(item => item.id === id && item.isActive !== false
    && item.categoryId && categoryIds.includes(item.categoryId)));
}
