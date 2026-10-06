import { SortableTable } from '../../components/ui/SortableTable';
import { useMemo } from 'react';

import type { EquipmentCategory } from '../../api/equipamentos';
import { ReportTypeBadge } from '../../components/reports/ReportTypeBadge';
import { RemoveIconButton } from '../../components/ui/RemoveIconButton';
import { Badge, Button, EmptyState } from '../../components/ui/ds';
import { useListingMobileViewport } from '../../components/ui/ds/listings/useListingMedia';
import { sortEquipmentCategoriesAlphabetically } from './equipmentCategoryView';

interface Props {
  categories: EquipmentCategory[];
  linkedCategoryIds: Set<string>;
  reportTypesByCategoryId: Map<string, string[]>;
  onAdd: () => void;
  onEdit: (category: EquipmentCategory) => void;
  onRemove: (category: EquipmentCategory) => void;
}

function categorySettings(category: EquipmentCategory) {
  return [
    category.supportsCalibration && 'Calibração',
    category.supportsTechnicalDoc && 'Documentação técnica',
    category.technicalDocEnabled && 'Dados técnicos',
    category.checklistEnabled && 'Checklist',
    category.showInMaintenance && 'Manutenção',
    category.syncToRomaneio && 'Romaneio'
  ].filter((setting): setting is string => Boolean(setting));
}

export function CategoryManager({ categories, linkedCategoryIds, reportTypesByCategoryId, onAdd, onEdit, onRemove }: Props) {
  const compact = useListingMobileViewport('xl');
  const ordered = useMemo(() => sortEquipmentCategoriesAlphabetically(categories), [categories]);

  function settings(category: EquipmentCategory) {
    const active = categorySettings(category);
    return active.length ? (
      <div className="equip-category-manager__settings">
        {active.map(setting => <span className="equip-category-manager__setting" key={setting}>{setting}</span>)}
      </div>
    ) : <span className="rel-meta">—</span>;
  }

  function reports(category: EquipmentCategory) {
    const reportTypes = reportTypesByCategoryId.get(category.id) || [];
    if (reportTypes.length) {
      return <div className="equip-category-manager__reports">{reportTypes.map(reportType => <ReportTypeBadge key={reportType} reportType={reportType} />)}</div>;
    }
    return linkedCategoryIds.has(category.id) ? <Badge tone="neutral">Vinculado</Badge> : <span className="rel-meta">—</span>;
  }

  function actions(category: EquipmentCategory) {
    return (
      <div className="equip-category-manager__actions">
        <Button variant="secondary" size="sm" type="button" onClick={() => onEdit(category)}>Editar</Button>
        {!linkedCategoryIds.has(category.id) && (
          <RemoveIconButton type="button" label={`Remover categoria ${category.name}`} onClick={() => onRemove(category)} />
        )}
      </div>
    );
  }

  return (
    <section className="page-card equip-category-manager">
      <div className="admin-toolbar">
        <div className="sec">Categorias</div>
        <Button variant="primary" size="sm" type="button" onClick={onAdd}>Nova categoria</Button>
      </div>

      {ordered.length === 0 ? <EmptyState title="Nenhuma categoria cadastrada" description="Crie uma categoria para organizar os equipamentos." variant="create" action={{ label: 'Nova categoria', onClick: onAdd }} /> : null}

      {ordered.length > 0 && (compact ? (
        <div className="equip-category-manager__list">
          {ordered.map(category => (
            <article className="equip-category-manager__item" key={category.id}>
              <strong className="equip-category-manager__item-name">{category.name}</strong>
              <div className="equip-category-manager__item-detail"><span>Configurações</span>{settings(category)}</div>
              <div className="equip-category-manager__item-detail"><span>Relatórios</span>{reports(category)}</div>
              {actions(category)}
            </article>
          ))}
        </div>
      ) : (
        <div className="equip-category-manager__table-wrap">
          <SortableTable className="equip-category-manager__table">
            <thead><tr><th scope="col">Categoria</th><th scope="col">Configurações</th><th scope="col">Relatórios</th><th scope="col">Ações</th></tr></thead>
            <tbody>
              {ordered.map(category => (
                <tr key={category.id}>
                  <th scope="row">{category.name}</th>
                  <td>{settings(category)}</td>
                  <td>{reports(category)}</td>
                  <td>{actions(category)}</td>
                </tr>
              ))}
            </tbody>
          </SortableTable>
        </div>
      ))}
    </section>
  );
}
