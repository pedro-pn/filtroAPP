import { useState, type FormEvent } from 'react';

import type {
  EquipmentCategory,
  EquipmentCategoryPayload,
  EquipmentFieldDefinition,
  EquipmentFieldType,
  MeasurementDimension,
  TechnicalFieldDefinition
} from '../../api/equipamentos';
import { Modal } from '../../components/ui/Modal';
import { TechnicalSchemaBuilder } from './TechnicalSchemaBuilder';

interface Props {
  open: boolean;
  category: EquipmentCategory | null;
  saving: boolean;
  unitsCatalog: MeasurementDimension[];
  onClose: () => void;
  onSubmit: (payload: EquipmentCategoryPayload) => void;
}

const fieldTypes: Array<{ value: EquipmentFieldType; label: string }> = [
  { value: 'text', label: 'Texto' },
  { value: 'number', label: 'Número' },
  { value: 'date', label: 'Data' },
  { value: 'select', label: 'Seleção' },
  { value: 'textarea', label: 'Texto longo' }
];

function emptyField(): EquipmentFieldDefinition {
  return { key: '', label: '', type: 'text', required: false, showInDashboard: false };
}

export function CategoryFormModal({ open, category, saving, unitsCatalog, onClose, onSubmit }: Props) {
  const [name, setName] = useState(category?.name || '');
  const [supportsCalibration, setSupportsCalibration] = useState(Boolean(category?.supportsCalibration));
  const [supportsTechnicalDoc, setSupportsTechnicalDoc] = useState(category?.supportsTechnicalDoc ?? true);
  const [syncToRomaneio, setSyncToRomaneio] = useState(Boolean(category?.syncToRomaneio));
  const [fields, setFields] = useState<EquipmentFieldDefinition[]>(category?.fieldSchema?.length ? category.fieldSchema : []);
  const [technicalDocEnabled, setTechnicalDocEnabled] = useState(Boolean(category?.technicalDocEnabled));
  const [technicalSchema, setTechnicalSchema] = useState<TechnicalFieldDefinition[]>(category?.technicalSchema?.length ? category.technicalSchema : []);

  function updateField(index: number, patch: Partial<EquipmentFieldDefinition>) {
    setFields(prev => prev.map((field, i) => (i === index ? { ...field, ...patch } : field)));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit({
      name: name.trim(),
      supportsCalibration,
      supportsTechnicalDoc,
      syncToRomaneio,
      technicalDocEnabled,
      fieldSchema: fields
        .filter(field => field.label.trim())
        .map((field, index) => ({
          ...field,
          order: index,
          options: field.type === 'select' ? (field.options || []).filter(Boolean) : undefined
        })),
      technicalSchema: technicalDocEnabled
        ? technicalSchema.filter(field => field.label.trim()).map((field, index) => ({ ...field, order: index }))
        : technicalSchema
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabelledBy="category-form-title"
      closeOnBackdrop={false}
      closeOnEscape={false}
      panelClassName="modal-card equip-modal"
    >
      <form className="equip-form" onSubmit={handleSubmit}>
        <header className="equip-form-head equip-form-head-with-close">
          <h3 id="category-form-title">{category ? 'Editar categoria' : 'Nova categoria'}</h3>
          <button
            className="equip-modal-close icon-button"
            type="button"
            aria-label="Fechar edição de categoria"
            title="Fechar"
            onClick={onClose}
            disabled={saving}
          >
            ×
          </button>
        </header>
        {category?.isSystemManaged && (
          <p className="rel-meta">O identificador interno desta categoria é usado pelos relatórios e não pode ser alterado. Nome, campos e vínculos podem ser editados normalmente.</p>
        )}

        <div className="field-group">
          <label htmlFor="cat-name">Nome (aba) *</label>
          <input id="cat-name" type="text" value={name} required onChange={e => setName(e.target.value)} />
        </div>

        <div className="equip-flags">
          <label className="equip-toggle">
            <input type="checkbox" checked={supportsCalibration} onChange={e => setSupportsCalibration(e.target.checked)} />
            <span>Permite calibração</span>
          </label>
          <label className="equip-toggle">
            <input type="checkbox" checked={supportsTechnicalDoc} onChange={e => setSupportsTechnicalDoc(e.target.checked)} />
            <span>Permite documentação técnica (PDF anexo)</span>
          </label>
          <label className="equip-toggle">
            <input type="checkbox" checked={technicalDocEnabled} onChange={e => setTechnicalDocEnabled(e.target.checked)} />
            <span>Dados Técnicos (datasheet preenchível)</span>
          </label>
          <label className="equip-toggle">
            <input type="checkbox" checked={syncToRomaneio} onChange={e => setSyncToRomaneio(e.target.checked)} />
            <span>Sincronizar com o Romaneio</span>
          </label>
        </div>

        <div className="equip-fields-builder">
          <div className="admin-toolbar">
            <div className="sec">Campos do formulário</div>
            <button className="mini-btn alt" type="button" onClick={() => setFields(prev => [...prev, emptyField()])}>Adicionar campo</button>
          </div>
          {fields.length === 0 && <p className="rel-meta">Nenhum campo extra. Código e Nome já estão sempre presentes.</p>}
          {fields.map((field, index) => (
            <div className="equip-field-row" key={index}>
              <input
                type="text"
                placeholder="Rótulo"
                value={field.label}
                onChange={e => updateField(index, { label: e.target.value })}
              />
              <select value={field.type} onChange={e => updateField(index, { type: e.target.value as EquipmentFieldType })}>
                {fieldTypes.map(ft => <option key={ft.value} value={ft.value}>{ft.label}</option>)}
              </select>
              {field.type === 'select' && (
                <input
                  type="text"
                  placeholder="Opções (vírgula)"
                  value={(field.options || []).join(', ')}
                  onChange={e => updateField(index, { options: e.target.value.split(',').map(o => o.trim()) })}
                />
              )}
              <label className="equip-toggle compact">
                <input type="checkbox" checked={Boolean(field.required)} onChange={e => updateField(index, { required: e.target.checked })} />
                <span>Obrig.</span>
              </label>
              <label className="equip-toggle compact">
                <input type="checkbox" checked={Boolean(field.showInDashboard)} onChange={e => updateField(index, { showInDashboard: e.target.checked })} />
                <span>Dashboard</span>
              </label>
              <button className="mini-btn danger" type="button" onClick={() => setFields(prev => prev.filter((_, i) => i !== index))}>×</button>
            </div>
          ))}
        </div>

        {technicalDocEnabled && (
          <TechnicalSchemaBuilder value={technicalSchema} onChange={setTechnicalSchema} unitsCatalog={unitsCatalog} />
        )}

        <div className="admin-form-actions equip-form-actions">
          <button className="mini-btn alt" type="button" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="mini-btn" type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </form>
    </Modal>
  );
}
