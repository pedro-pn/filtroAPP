import { useState, type FormEvent } from 'react';

import type { StockCategory, StockCategoryPayload, StockCategoryUpdatePayload, StockItemType } from '../../api/estoque';
import { Modal } from '../../components/ui/Modal';
import { ChecklistItemsEditor } from '../equipamentos/ChecklistItemsEditor';

interface Props {
  open: boolean;
  category: StockCategory | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (payload: StockCategoryPayload | StockCategoryUpdatePayload) => void;
}

const typeOptions: Array<{ value: StockItemType; label: string }> = [
  { value: 'FILTRO', label: 'Filtro' },
  { value: 'PRODUTO_QUIMICO', label: 'Produto químico' }
];

export function StockCategoryFormModal({ open, category, saving, onClose, onSubmit }: Props) {
  const [type, setType] = useState<StockItemType>(category?.type || 'FILTRO');
  const [name, setName] = useState(category?.name || '');
  const [checklistEnabled, setChecklistEnabled] = useState(Boolean(category?.checklistEnabled));
  const [checklistItems, setChecklistItems] = useState<string[]>(category?.checklistItems?.length ? category.checklistItems : []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {
      type,
      name: name.trim(),
      checklistEnabled,
      checklistItems: checklistItems.map(item => item.trim()).filter(Boolean)
    };
    if (category) {
      const updatePayload: StockCategoryUpdatePayload = {
        name: payload.name,
        checklistEnabled: payload.checklistEnabled,
        checklistItems: payload.checklistItems
      };
      onSubmit(updatePayload);
      return;
    }
    onSubmit(payload);
  }

  return (
    <Modal open={open} onClose={onClose} appearance="design-system" title={category ? 'Editar categoria' : 'Nova categoria'} size="lg" showCloseButton={!saving} closeOnEscape={!saving} panelClassName="stock-dialog">
      <form className="equip-form" onSubmit={handleSubmit}>

        <div className="field-group">
          <label htmlFor="stock-category-type">Tipo *</label>
          <select
            id="stock-category-type"
            value={type}
            disabled={Boolean(category) || saving}
            onChange={event => setType(event.target.value as StockItemType)}
          >
            {typeOptions.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>

        <div className="field-group">
          <label htmlFor="stock-category-name">Nome *</label>
          <input
            id="stock-category-name"
            type="text"
            value={name}
            required
            disabled={saving}
            onChange={event => setName(event.target.value)}
          />
        </div>

        <label className="equip-toggle">
          <input
            type="checkbox"
            checked={checklistEnabled}
            disabled={saving}
            onChange={event => setChecklistEnabled(event.target.checked)}
          />
          <span>Tem checklist no romaneio</span>
        </label>

        <div className="equip-fields-builder">
          <div className="admin-toolbar">
            <div className="sec">Pontos do checklist</div>
          </div>
          <ChecklistItemsEditor appearance="design-system" value={checklistItems} onChange={setChecklistItems} disabled={saving || !checklistEnabled} />
        </div>

        <div className="admin-form-actions equip-form-actions">
          <button className="mini-btn alt" type="button" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="mini-btn" type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </form>
    </Modal>
  );
}
