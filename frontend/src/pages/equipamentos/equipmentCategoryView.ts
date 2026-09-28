import type { CompanyEquipment, EquipmentCategory } from '../../api/equipamentos';
import type { ProjectSortDirection } from '../../utils/projectSort';

export type EquipmentTab = 'dashboard' | 'categories' | 'config' | 'maintenance' | 'notifications';

const EQUIPMENT_TAB_VALUES = new Set<EquipmentTab>(['dashboard', 'categories', 'config', 'maintenance', 'notifications']);

export function parseEquipmentTabParam(value: string | null) {
  if (!value) return 'dashboard';
  if (EQUIPMENT_TAB_VALUES.has(value as EquipmentTab)) return value;
  if (value.startsWith('cat:') && value.slice(4)) return value;
  return 'dashboard';
}

export function equipmentTabFromParam(value: string): EquipmentTab {
  if (value.startsWith('cat:')) return 'categories';
  return EQUIPMENT_TAB_VALUES.has(value as EquipmentTab) ? value as EquipmentTab : 'dashboard';
}

export function filterAndSortEquipment(
  equipment: readonly CompanyEquipment[],
  categories: readonly EquipmentCategory[],
  search: string,
  direction: ProjectSortDirection
) {
  const categoryNames = new Map(categories.map(category => [category.id, category.name]));
  const query = search.trim().toLocaleLowerCase('pt-BR');
  const filtered = query
    ? equipment.filter(item => {
        const haystack = [
          item.code,
          item.name,
          categoryNames.get(item.categoryId),
          ...Object.values(item.attributes || {}).map(value => String(value ?? ''))
        ].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR');
        return haystack.includes(query);
      })
    : equipment;
  const multiplier = direction === 'asc' ? 1 : -1;
  return [...filtered].sort((a, b) => a.code.localeCompare(b.code, 'pt-BR', { sensitivity: 'base' }) * multiplier);
}
