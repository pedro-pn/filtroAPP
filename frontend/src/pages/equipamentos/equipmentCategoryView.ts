import type { CompanyEquipment, EquipmentCategory, RdoEquipmentSlot } from '../../api/equipamentos';
import type { ProjectSortDirection } from '../../utils/projectSort';
import { calibrationStatus, type CalibrationStatus } from './equipmentStatus';

export type EquipmentTab = 'dashboard' | 'categories' | 'config' | 'maintenance' | 'notifications';

const EQUIPMENT_TAB_VALUES = new Set<EquipmentTab>(['dashboard', 'categories', 'config', 'maintenance', 'notifications']);

const REPORT_TYPE_BY_SERVICE: Record<string, string> = {
  limpeza: 'RLQ',
  pressao: 'RTP',
  filtragem: 'RCPU',
  flushing: 'RCPU'
};
const REPORT_TYPE_ORDER = ['RLQ', 'RTP', 'RCPU'];

export function sortEquipmentCategoriesAlphabetically<T extends Pick<EquipmentCategory, 'id' | 'name'>>(categories: readonly T[]) {
  return [...categories].sort((a, b) =>
    a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }) || a.id.localeCompare(b.id)
  );
}

export function reportTypesByEquipmentCategory(slots: ReadonlyArray<Pick<RdoEquipmentSlot, 'serviceType' | 'categoryIds'>>) {
  const typesByCategory = new Map<string, Set<string>>();
  for (const slot of slots) {
    const reportType = REPORT_TYPE_BY_SERVICE[slot.serviceType];
    if (!reportType) continue;
    for (const categoryId of slot.categoryIds) {
      if (!typesByCategory.has(categoryId)) typesByCategory.set(categoryId, new Set());
      typesByCategory.get(categoryId)?.add(reportType);
    }
  }
  return new Map([...typesByCategory].map(([categoryId, types]) => [
    categoryId,
    [...types].sort((a, b) => REPORT_TYPE_ORDER.indexOf(a) - REPORT_TYPE_ORDER.indexOf(b))
  ]));
}

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

export function equipmentCategoryFromParam<T extends Pick<EquipmentCategory, 'id'>>(value: string, categories: readonly T[]): T | null {
  if (!value.startsWith('cat:')) return null;
  return categories.find(category => category.id === value.slice(4)) || null;
}

export function equipmentCategoryShortLabel(category: EquipmentCategory, equipment: readonly CompanyEquipment[]) {
  const name = category.name.trim();
  if (name.length <= 18) return name;

  const prefixes = new Set(equipment
    .filter(item => item.categoryId === category.id)
    .map(item => item.code.trim().toUpperCase().match(/^([A-Z]{2,6})(?=[\s._/-]*\d)/)?.[1])
    .filter((prefix): prefix is string => Boolean(prefix)));
  if (prefixes.size > 0 && prefixes.size <= 2) return [...prefixes].sort().join('/');

  const initials = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(word => word && !['de', 'da', 'do', 'dos', 'das', 'e'].includes(word.toLowerCase()))
    .map(word => word[0].toUpperCase())
    .join('');
  return initials.slice(0, 6) || name;
}

export function filterAndSortEquipment(
  equipment: readonly CompanyEquipment[],
  categories: readonly EquipmentCategory[],
  search: string,
  direction: ProjectSortDirection,
  categoryId?: string
) {
  const categoryNames = new Map(categories.map(category => [category.id, category.name]));
  const query = search.trim().toLocaleLowerCase('pt-BR');
  const scoped = categoryId === undefined ? equipment : equipment.filter(item => item.categoryId === categoryId);
  const filtered = query
    ? scoped.filter(item => {
        const haystack = [
          item.code,
          item.name,
          categoryNames.get(item.categoryId),
          ...Object.values(item.attributes || {}).map(value => String(value ?? ''))
        ].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR');
        return haystack.includes(query);
      })
    : scoped;
  const multiplier = direction === 'asc' ? 1 : -1;
  return [...filtered].sort((a, b) => a.code.localeCompare(b.code, 'pt-BR', { sensitivity: 'base' }) * multiplier);
}

export interface EquipmentListFilters {
  search: string;
  categoryId: string;
  calibration: CalibrationStatus | 'all' | 'not-applicable';
  technicalDoc: 'all' | 'with' | 'without' | 'outdated';
  certificate: 'all' | 'with' | 'without';
}

export const EMPTY_EQUIPMENT_FILTERS: EquipmentListFilters = {
  search: '', categoryId: '', calibration: 'all', technicalDoc: 'all', certificate: 'all'
};

export function filterAllEquipment(equipment: readonly CompanyEquipment[], categories: readonly EquipmentCategory[], filters: EquipmentListFilters) {
  return filterAndSortEquipment(equipment, categories, filters.search, 'asc', filters.categoryId || undefined)
    .filter(item => {
      if (filters.calibration === 'not-applicable') return !item.hasCalibration;
      if (filters.calibration === 'all') return true;
      return item.hasCalibration && calibrationStatus(item) === filters.calibration;
    })
    .filter(item => {
      const hasDoc = Boolean(item.technicalDoc || item.technicalDocGenerated);
      if (filters.technicalDoc === 'with') return hasDoc;
      if (filters.technicalDoc === 'without') return !hasDoc;
      if (filters.technicalDoc === 'outdated') return Boolean(item.technicalDocGenerated && item.technicalDocGeneratedOutdated);
      return true;
    })
    .filter(item => filters.certificate === 'all' || Boolean(item.calibrationCertificate) === (filters.certificate === 'with'));
}
