import type { CompanyEquipment, EquipmentCategory } from '../../api/equipamentos';
import { Button } from '../../components/ui/ds';
import { useListingMobileViewport } from '../../components/ui/ds/listings/useListingMedia';
import { EquipmentCard } from './EquipmentCard';
import { EquipmentTable, type EquipmentTableActions } from './EquipmentTable';

interface EquipmentCategorySectionProps extends EquipmentTableActions {
  category: EquipmentCategory;
  items: CompanyEquipment[];
  total: number;
  onAdd: () => void;
  /** Só gestor: edição da categoria e do modelo de dados técnicos direto da própria categoria. */
  onEditCategory?: () => void;
  onEditTechnicalModel?: () => void;
}

export function EquipmentCategorySection({ category, items, total, isManager, onAdd, onEditCategory, onEditTechnicalModel, onEdit, onRemove, onOpenTechnical, onOpenManual, onOpenQr, onOpenMaintenanceHistory }: EquipmentCategorySectionProps) {
  const compact = useListingMobileViewport('xl');

  return (
    <section className="page-card equip-category-section" data-equip-category-section data-equip-category-id={category.id}>
      <div className="equip-category-section__header">
        <div>
          <h2>{category.name}</h2>
          <p>{items.length === total ? `${total} equipamento${total === 1 ? '' : 's'}` : `${items.length} de ${total} equipamentos`}</p>
        </div>
        {isManager ? (
          <div className="equip-category-section__actions">
            {onEditCategory ? <Button size="sm" variant="secondary" onClick={onEditCategory} data-equip-category-edit>Editar categoria</Button> : null}
            {onEditTechnicalModel && category.technicalDocEnabled ? <Button size="sm" variant="secondary" onClick={onEditTechnicalModel} data-equip-technical-model>Modelo de dados técnicos</Button> : null}
            <Button size="sm" variant="primary" onClick={onAdd}>+ Novo equipamento</Button>
          </div>
        ) : null}
      </div>

      {items.length === 0 ? (
        <p className="equip-category-section__empty">{total ? 'Nenhum equipamento encontrado para esta busca.' : 'Nenhum equipamento nesta categoria.'}</p>
      ) : compact ? (
        <div className="equip-grid">
          {items.map(item => (
            <EquipmentCard
              key={item.id}
              item={item}
              category={category}
              isManager={isManager}
              onEdit={() => onEdit(item)}
              onRemove={() => onRemove(item)}
              onOpenTechnical={() => onOpenTechnical(item)}
              onOpenManual={() => onOpenManual(item)}
              onOpenQr={() => onOpenQr(item)}
              onOpenMaintenanceHistory={() => onOpenMaintenanceHistory(item)}
            />
          ))}
        </div>
      ) : (
        <EquipmentTable categories={[category]} items={items} isManager={isManager} onEdit={onEdit} onRemove={onRemove} onOpenTechnical={onOpenTechnical} onOpenManual={onOpenManual} onOpenQr={onOpenQr} onOpenMaintenanceHistory={onOpenMaintenanceHistory} />
      )}
    </section>
  );
}
