import { useMemo, useState } from 'react';

import type { CompanyEquipment, EquipmentCategory } from '../../api/equipamentos';
import { SearchBar } from '../../components/ui/SearchBar';
import { Button, Field, Select } from '../../components/ui/ds';
import { EquipmentTable, type EquipmentTableActions } from './EquipmentTable';
import { EMPTY_EQUIPMENT_FILTERS, filterAllEquipment, type EquipmentListFilters } from './equipmentCategoryView';

interface Props extends EquipmentTableActions {
  categories: EquipmentCategory[];
  equipment: CompanyEquipment[];
}

export function AllEquipmentView({ categories, equipment, ...actions }: Props) {
  const [filters, setFilters] = useState<EquipmentListFilters>(EMPTY_EQUIPMENT_FILTERS);
  const rows = useMemo(() => filterAllEquipment(equipment, categories, filters), [categories, equipment, filters]);
  const hasFilters = Object.keys(EMPTY_EQUIPMENT_FILTERS).some(key => filters[key as keyof EquipmentListFilters] !== EMPTY_EQUIPMENT_FILTERS[key as keyof EquipmentListFilters]);

  function updateFilter<K extends keyof EquipmentListFilters>(key: K, value: EquipmentListFilters[K]) {
    setFilters(current => ({ ...current, [key]: value }));
  }

  return (
    <section className="page-card equip-all-equipment" data-equip-all-equipment>
      <div className="equip-all-equipment__filters" role="group" aria-label="Filtros de todos os equipamentos">
        <div className="equip-all-equipment__search">
          <SearchBar value={filters.search} onChange={value => updateFilter('search', value)} placeholder="Buscar por código, nome, categoria ou atributo" ariaLabel="Buscar em todos os equipamentos" />
        </div>
        <Field id="all-equipment-category" label="Categoria" optionalText={null}>
          <Select aria-label="Categoria" value={filters.categoryId} onChange={event => updateFilter('categoryId', event.target.value)}>
            <option value="">Todas as categorias</option>
            {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
          </Select>
        </Field>
        <Field id="all-equipment-calibration" label="Calibração" optionalText={null}>
          <Select aria-label="Calibração" value={filters.calibration} onChange={event => updateFilter('calibration', event.target.value as EquipmentListFilters['calibration'])}>
            <option value="all">Todas as situações</option>
            <option value="ok">Calibrado</option>
            <option value="expiring">A vencer (30 dias)</option>
            <option value="expired">Calibração expirada</option>
            <option value="none">Sem calibração cadastrada</option>
            <option value="not-applicable">Não se aplica</option>
          </Select>
        </Field>
        <Field id="all-equipment-doc" label="Documentação técnica" optionalText={null}>
          <Select aria-label="Documentação técnica" value={filters.technicalDoc} onChange={event => updateFilter('technicalDoc', event.target.value as EquipmentListFilters['technicalDoc'])}>
            <option value="all">Todos os documentos</option>
            <option value="with">Com PDF técnico</option>
            <option value="without">Sem PDF técnico</option>
            <option value="outdated">Datasheet desatualizado</option>
          </Select>
        </Field>
        <Field id="all-equipment-certificate" label="Certificado de calibração" optionalText={null}>
          <Select aria-label="Certificado de calibração" value={filters.certificate} onChange={event => updateFilter('certificate', event.target.value as EquipmentListFilters['certificate'])}>
            <option value="all">Todos</option>
            <option value="with">Com certificado</option>
            <option value="without">Sem certificado</option>
          </Select>
        </Field>
      </div>
      <div className="equip-all-equipment__summary">
        <span className="rel-meta" role="status">{rows.length} de {equipment.length} equipamentos</span>
        {hasFilters && <Button size="sm" variant="ghost" onClick={() => setFilters(EMPTY_EQUIPMENT_FILTERS)}>Limpar filtros</Button>}
      </div>
      <EquipmentTable categories={categories} items={rows} showCategory {...actions} />
    </section>
  );
}
