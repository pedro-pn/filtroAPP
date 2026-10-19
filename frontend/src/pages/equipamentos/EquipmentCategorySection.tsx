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
}

export function EquipmentCategorySection({ category, items, total, isManager, onAdd, onEdit, onRemove, onOpenTechnical, onOpenMaintenanceHistory }: EquipmentCategorySectionProps) {
  const compact = useListingMobileViewport('xl');

  return (
    <section className="page-card equip-category-section" data-equip-category-section data-equip-category-id={category.id}>
      <div className="equip-category-section__header">
        <div>
          <h2>{category.name}</h2>
          <p>{items.length === total ? `${total} equipamento${total === 1 ? '' : 's'}` : `${items.length} de ${total} equipamentos`}</p>
        </div>
        {isManager ? <Button size="sm" variant="primary" onClick={onAdd}>+ Novo equipamento</Button> : null}
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
              onOpenMaintenanceHistory={() => onOpenMaintenanceHistory(item)}
            />
          ))}
        </div>
      ) : (
        <EquipmentTable categories={[category]} items={items} isManager={isManager} onEdit={onEdit} onRemove={onRemove} onOpenTechnical={onOpenTechnical} onOpenMaintenanceHistory={onOpenMaintenanceHistory} />
      )}
    </section>
  );
}
