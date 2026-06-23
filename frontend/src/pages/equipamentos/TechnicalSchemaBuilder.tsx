import { useRef, useState, type DragEvent } from 'react';

import type {
  MeasurementDimension,
  TechnicalFieldDefinition,
  TechnicalFieldType
} from '../../api/equipamentos';

const TECH_TYPES: Array<{ value: TechnicalFieldType; label: string }> = [
  { value: 'text', label: 'Texto' },
  { value: 'textarea', label: 'Texto longo' },
  { value: 'number', label: 'Número' },
  { value: 'measure', label: 'Medida (valor + unidade)' },
  { value: 'select', label: 'Seleção' },
  { value: 'multiselect', label: 'Multisseleção' },
  { value: 'boolean', label: 'Sim / Não' },
  { value: 'date', label: 'Data' },
  { value: 'group', label: 'Grupo repetível' }
];

function emptyTechField(): TechnicalFieldDefinition {
  return { key: '', label: '', type: 'text', showInDoc: true };
}

function reorderFields(fields: TechnicalFieldDefinition[], from: number, to: number) {
  const next = [...fields];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

function setTransparentDragPreview(event: DragEvent<HTMLButtonElement>) {
  const row = event.currentTarget.closest('.tech-build-row');
  if (!(row instanceof HTMLElement)) return;

  const rect = row.getBoundingClientRect();
  const preview = row.cloneNode(true) as HTMLElement;
  preview.setAttribute('aria-hidden', 'true');
  preview.style.position = 'fixed';
  preview.style.top = '-1000px';
  preview.style.left = '-1000px';
  preview.style.width = `${rect.width}px`;
  preview.style.pointerEvents = 'none';
  preview.style.opacity = '0.42';
  preview.style.transform = 'scale(0.985)';

  document.body.appendChild(preview);
  event.dataTransfer.setDragImage(
    preview,
    Math.max(0, Math.min(event.clientX - rect.left, rect.width)),
    Math.max(0, Math.min(event.clientY - rect.top, rect.height))
  );
  window.setTimeout(() => preview.remove(), 0);
}

type FieldDragConfig = {
  label: string;
  isDragging: boolean;
  isDragOver: boolean;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: (event: DragEvent<HTMLButtonElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
};

// Editor de um campo. `nested` esconde tipo "grupo" e flags que não fazem sentido em subcampos.
function FieldEditor({ field, onChange, onRemove, unitsCatalog, nested, drag }: {
  field: TechnicalFieldDefinition;
  onChange: (patch: Partial<TechnicalFieldDefinition>) => void;
  onRemove: () => void;
  unitsCatalog: MeasurementDimension[];
  nested?: boolean;
  drag?: FieldDragConfig;
}) {
  const typeOptions = nested ? TECH_TYPES.filter(t => t.value !== 'group') : TECH_TYPES;
  const itemDragIndex = useRef<number | null>(null);
  const [itemDraggingIndex, setItemDraggingIndex] = useState<number | null>(null);
  const [itemOverIndex, setItemOverIndex] = useState<number | null>(null);

  function patchUnit(dimension: string) {
    const dim = unitsCatalog.find(d => d.key === dimension);
    onChange({ unit: { dimension: dimension || null, default: dim?.default ?? null } });
  }

  function updateItem(index: number, patch: Partial<TechnicalFieldDefinition>) {
    const items = (field.itemSchema || []).map((it, i) => (i === index ? { ...it, ...patch } : it));
    onChange({ itemSchema: items });
  }

  function clearItemDrag() {
    itemDragIndex.current = null;
    setItemDraggingIndex(null);
    setItemOverIndex(null);
  }

  function handleItemDrop(targetIndex: number) {
    const from = itemDragIndex.current;
    clearItemDrag();
    if (from === null || from === targetIndex) return;
    onChange({ itemSchema: reorderFields(field.itemSchema || [], from, targetIndex) });
  }

  function itemDragConfig(index: number, label: string): FieldDragConfig {
    const source = label.trim() || `Subcampo ${index + 1}`;
    return {
      label: `Arrastar ${source}`,
      isDragging: itemDraggingIndex === index,
      isDragOver: itemOverIndex === index && itemDraggingIndex !== index,
      onDragStart: event => {
        itemDragIndex.current = index;
        setItemDraggingIndex(index);
        event.stopPropagation();
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', source);
        setTransparentDragPreview(event);
      },
      onDragEnd: () => clearItemDrag(),
      onDragOver: event => {
        if (itemDragIndex.current === null) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        setItemOverIndex(index);
      },
      onDragLeave: () => {
        if (itemOverIndex === index) setItemOverIndex(null);
      },
      onDrop: event => {
        if (itemDragIndex.current === null) return;
        event.preventDefault();
        event.stopPropagation();
        handleItemDrop(index);
      }
    };
  }

  return (
    <div
      className={`tech-build-row ${nested ? 'nested' : ''} ${drag?.isDragging ? 'dragging' : ''} ${drag?.isDragOver ? 'drag-over' : ''}`}
      onDragOver={drag?.onDragOver}
      onDragLeave={drag?.onDragLeave}
      onDrop={drag?.onDrop}
    >
      <div className="tech-build-main">
        {drag && (
          <button
            className="tech-drag-handle"
            type="button"
            draggable
            aria-label={drag.label}
            title={drag.label}
            onDragStart={drag.onDragStart}
            onDragEnd={drag.onDragEnd}
          >
            ⠿
          </button>
        )}
        <input
          type="text"
          placeholder="Rótulo do campo"
          value={field.label}
          onChange={e => onChange({ label: e.target.value })}
        />
        <select value={field.type} onChange={e => onChange({ type: e.target.value as TechnicalFieldType })}>
          {typeOptions.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <button className="tech-remove-btn" type="button" onClick={onRemove} aria-label="Remover campo" title="Remover campo">×</button>
      </div>

      <div className="tech-build-extra">
        {field.type === 'measure' && (
          <select value={field.unit?.dimension || ''} onChange={e => patchUnit(e.target.value)}>
            <option value="">Unidade livre</option>
            {unitsCatalog.map(d => <option key={d.key} value={d.key}>{d.label} ({d.units.join(', ')})</option>)}
          </select>
        )}
        {(field.type === 'select' || field.type === 'multiselect') && (
          <input
            type="text"
            placeholder="Opções (separadas por vírgula)"
            value={(field.options || []).join(', ')}
            onChange={e => onChange({ options: e.target.value.split(',').map(o => o.trim()) })}
          />
        )}
        {!nested && (
          <input
            type="text"
            placeholder="Seção / agrupamento (ex.: Elétrico)"
            value={field.group || ''}
            onChange={e => onChange({ group: e.target.value })}
          />
        )}
        {!nested && (
          <>
            <label className="equip-toggle compact">
              <input type="checkbox" checked={Boolean(field.required)} onChange={e => onChange({ required: e.target.checked })} />
              <span>Obrig.</span>
            </label>
            <label className="equip-toggle compact" title="Pode ser desligado por equipamento">
              <input type="checkbox" checked={Boolean(field.optionalPerEquipment)} onChange={e => onChange({ optionalPerEquipment: e.target.checked })} />
              <span>Opcional/equip.</span>
            </label>
            <label className="equip-toggle compact" title="Sai no documento gerado">
              <input type="checkbox" checked={field.showInDoc !== false} onChange={e => onChange({ showInDoc: e.target.checked })} />
              <span>No doc.</span>
            </label>
          </>
        )}
      </div>

      {field.type === 'group' && !nested && (
        <div className="tech-build-group">
          <div className="tech-build-group-opts">
            <input
              type="text"
              placeholder="Rótulo do item (ex.: Motor)"
              value={field.itemLabel || ''}
              onChange={e => onChange({ itemLabel: e.target.value })}
            />
            <label className="equip-toggle compact">
              <input type="checkbox" checked={field.repeatable !== false} onChange={e => onChange({ repeatable: e.target.checked })} />
              <span>Repetível</span>
            </label>
          </div>
          <div className="tech-build-subfields">
            <div className="admin-toolbar">
              <div className="sec">Campos do item</div>
              <button className="mini-btn alt" type="button" onClick={() => onChange({ itemSchema: [...(field.itemSchema || []), emptyTechField()] })}>
                Adicionar subcampo
              </button>
            </div>
            {(field.itemSchema || []).length === 0 && <p className="rel-meta">Nenhum subcampo no grupo.</p>}
            {(field.itemSchema || []).map((sub, i) => (
              <FieldEditor
                key={i}
                field={sub}
                nested
                unitsCatalog={unitsCatalog}
                drag={itemDragConfig(i, sub.label)}
                onChange={patch => updateItem(i, patch)}
                onRemove={() => onChange({ itemSchema: (field.itemSchema || []).filter((_, j) => j !== i) })}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function TechnicalSchemaBuilder({ value, onChange, unitsCatalog }: {
  value: TechnicalFieldDefinition[];
  onChange: (next: TechnicalFieldDefinition[]) => void;
  unitsCatalog: MeasurementDimension[];
}) {
  const dragIndex = useRef<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  function update(index: number, patch: Partial<TechnicalFieldDefinition>) {
    onChange(value.map((field, i) => (i === index ? { ...field, ...patch } : field)));
  }

  function clearDrag() {
    dragIndex.current = null;
    setDraggingIndex(null);
    setOverIndex(null);
  }

  function handleDrop(targetIndex: number) {
    const from = dragIndex.current;
    clearDrag();
    if (from === null || from === targetIndex) return;
    onChange(reorderFields(value, from, targetIndex));
  }

  function dragConfig(index: number, label: string): FieldDragConfig {
    const source = label.trim() || `Campo ${index + 1}`;
    return {
      label: `Arrastar ${source}`,
      isDragging: draggingIndex === index,
      isDragOver: overIndex === index && draggingIndex !== index,
      onDragStart: event => {
        dragIndex.current = index;
        setDraggingIndex(index);
        event.stopPropagation();
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', source);
        setTransparentDragPreview(event);
      },
      onDragEnd: () => clearDrag(),
      onDragOver: event => {
        if (dragIndex.current === null) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        setOverIndex(index);
      },
      onDragLeave: () => {
        if (overIndex === index) setOverIndex(null);
      },
      onDrop: event => {
        if (dragIndex.current === null) return;
        event.preventDefault();
        event.stopPropagation();
        handleDrop(index);
      }
    };
  }

  return (
    <div className="equip-fields-builder tech-build">
      <div className="admin-toolbar">
        <div className="sec">Campos dos Dados Técnicos</div>
        <button className="mini-btn alt" type="button" onClick={() => onChange([...value, emptyTechField()])}>Adicionar campo</button>
      </div>
      {value.length === 0 && <p className="rel-meta">Nenhum campo técnico. Adicione os campos que comporão o datasheet desta categoria.</p>}
      {value.map((field, index) => (
        <FieldEditor
          key={index}
          field={field}
          unitsCatalog={unitsCatalog}
          drag={dragConfig(index, field.label)}
          onChange={patch => update(index, patch)}
          onRemove={() => onChange(value.filter((_, i) => i !== index))}
        />
      ))}
    </div>
  );
}
