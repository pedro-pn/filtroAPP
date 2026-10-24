import { ArrowLeftRight } from 'lucide-react';
import { useState } from 'react';
import type { EquipmentSlotSource } from '../../utils/rdoEquipmentCategories';
import { AppIcon } from '../icons/AppIcon';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/ds';
import './EquipmentCategoryPicker.css';

interface Props {
  source?: EquipmentSlotSource;
  categoryIds: string[];
  label: string;
  disabled?: boolean;
  onSelect: (ids: string[]) => void;
}

export function EquipmentCategoryPicker({ source, categoryIds, label, disabled, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const categories = new Map(source?.categories.map(category => [category.id, category.name]) || []);
  const allowed = source ? [...new Set([...source.primaryIds, ...source.secondaryIds])].filter(id => categories.has(id)) : [];
  if (!source || !allowed.length || (allowed.length === 1 && !source.secondaryIds.some(id => allowed.includes(id)))) return null;
  const validSelected = selected.filter(id => allowed.includes(id));

  return <div className="rdo-equipment-category-control">
    <Button type="button" size="sm" variant="ghost" disabled={disabled} iconLeft={<AppIcon icon={ArrowLeftRight} />}
      onClick={() => { setSelected(categoryIds); setOpen(true); }}>Escolher outra categoria</Button>
    <Modal open={open} onClose={() => setOpen(false)} appearance="design-system" title="Categorias de equipamento" size="sm"
      fullscreenOnMobile={false} closeOnBackdrop backdropClassName="rdo-equipment-category-backdrop" panelClassName="rdo-equipment-category-dialog"
      footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
        <Button disabled={disabled || !validSelected.length} onClick={() => { onSelect(validSelected); setOpen(false); }}>Aplicar categorias</Button></>}>
      <p className="rdo-equipment-category-context">{label}</p>
      <p className="rdo-equipment-category-hint">Selecione uma ou mais categorias para listar os equipamentos.</p>
      {([['Principais', source.primaryIds], ['Secundárias', source.secondaryIds]] as const).map(([title, ids]) => ids.length ? (
        <fieldset className="rdo-equipment-category-options" key={title}>
          <legend>{title}</legend>
          {ids.filter(id => allowed.includes(id)).map(id => <label className="rdo-equipment-category-option" key={id}>
            <input type="checkbox" checked={selected.includes(id)} disabled={disabled}
              onChange={event => setSelected(current => event.target.checked ? [...current, id] : current.filter(value => value !== id))} />
            <span>{categories.get(id)}</span>
          </label>)}
        </fieldset>
      ) : null)}
    </Modal>
  </div>;
}
