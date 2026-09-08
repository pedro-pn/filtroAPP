import { useEffect, useRef, useState, type DragEvent, type PointerEvent } from 'react';

import type {
  MeasurementDimension,
  TechnicalFieldDefinition,
  TechnicalFieldType
} from '../../api/equipamentos';
import {
  createPointerDragGhost,
  movePointerDragGhost,
  reorderIdFromPoint,
  setReorderDragImage,
  type PointerDragState
} from '../../utils/reorderDrag';

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

type FieldDragConfig = {
  index: number;
  label: string;
  scope: string;
  isDragging: boolean;
  isDragOver: boolean;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: (event: DragEvent<HTMLButtonElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => void;
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
  const itemStartSchema = useRef<TechnicalFieldDefinition[]>([]);
  const itemSchemaRef = useRef<TechnicalFieldDefinition[]>(field.itemSchema || []);
  const itemDropHandled = useRef(false);
  const itemTouchDrag = useRef<PointerDragState | null>(null);
  const itemScope = useRef(`tech-item-${Math.random().toString(36).slice(2)}`).current;
  const [itemDraggingIndex, setItemDraggingIndex] = useState<number | null>(null);
  const [itemOverIndex, setItemOverIndex] = useState<number | null>(null);
  const itemRowSelector = `.tech-build-row[data-reorder-scope="${itemScope}"]`;

  useEffect(() => {
    if (itemDragIndex.current === null) itemSchemaRef.current = field.itemSchema || [];
  }, [field.itemSchema]);

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

  function applyItemSchema(next: TechnicalFieldDefinition[]) {
    itemSchemaRef.current = next;
    onChange({ itemSchema: next });
  }

  function startItemDrag(index: number) {
    itemDropHandled.current = false;
    itemSchemaRef.current = field.itemSchema || [];
    itemStartSchema.current = field.itemSchema || [];
    itemDragIndex.current = index;
    setItemDraggingIndex(index);
    setItemOverIndex(index);
  }

  function applyItemReorder(targetIndex: number) {
    const from = itemDragIndex.current;
    if (
      from === null ||
      from === targetIndex ||
      !Number.isInteger(targetIndex) ||
      targetIndex < 0 ||
      targetIndex >= itemSchemaRef.current.length
    ) return;
    const next = reorderFields(itemSchemaRef.current, from, targetIndex);
    itemDragIndex.current = targetIndex;
    setItemDraggingIndex(targetIndex);
    setItemOverIndex(targetIndex);
    applyItemSchema(next);
  }

  function handleItemDrop(targetIndex: number) {
    itemDropHandled.current = true;
    applyItemReorder(targetIndex);
    clearItemDrag();
  }

  function handleItemDragEnd() {
    if (!itemDropHandled.current) applyItemSchema(itemStartSchema.current);
    itemDropHandled.current = false;
    clearItemDrag();
  }

  function finishItemPointerDrag(event: PointerEvent<HTMLButtonElement>, persist: boolean) {
    const state = itemTouchDrag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    state.ghost.remove();
    itemTouchDrag.current = null;
    document.body.classList.remove('app-reorder-touching');
    if (!persist) applyItemSchema(itemStartSchema.current);
    clearItemDrag();
  }

  function itemDragConfig(index: number, label: string): FieldDragConfig {
    const source = label.trim() || `Subcampo ${index + 1}`;
    return {
      index,
      label: `Arrastar ${source}`,
      scope: itemScope,
      isDragging: itemDraggingIndex === index,
      isDragOver: itemOverIndex === index && itemDraggingIndex !== index,
      onDragStart: event => {
        startItemDrag(index);
        event.stopPropagation();
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', source);
        setReorderDragImage(event, itemRowSelector, 'app-reorder-drag-ghost');
      },
      onDragEnd: event => {
        event.stopPropagation();
        handleItemDragEnd();
      },
      onDragOver: event => {
        if (itemDragIndex.current === null) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        setItemOverIndex(index);
        applyItemReorder(index);
      },
      onDragLeave: () => {
        if (itemOverIndex === index) setItemOverIndex(null);
      },
      onDrop: event => {
        if (itemDragIndex.current === null) return;
        event.preventDefault();
        event.stopPropagation();
        handleItemDrop(index);
      },
      onPointerDown: event => {
        if (event.pointerType === 'mouse') return;
        const row = event.currentTarget.closest(itemRowSelector);
        if (!(row instanceof HTMLElement)) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        startItemDrag(index);
        document.body.classList.add('app-reorder-touching');
        const state = createPointerDragGhost(row, event.clientX, event.clientY, 'app-reorder-touch-ghost');
        state.pointerId = event.pointerId;
        itemTouchDrag.current = state;
      },
      onPointerMove: event => {
        const state = itemTouchDrag.current;
        if (!state || state.pointerId !== event.pointerId || itemDragIndex.current === null) return;
        event.preventDefault();
        event.stopPropagation();
        movePointerDragGhost(state, event.clientX, event.clientY);
        const target = reorderIdFromPoint(event.clientX, event.clientY, itemRowSelector);
        if (target !== null) applyItemReorder(Number(target));
      },
      onPointerUp: event => finishItemPointerDrag(event, true),
      onPointerCancel: event => finishItemPointerDrag(event, false)
    };
  }

  return (
    <div
      className={`tech-build-row ${nested ? 'nested' : ''} ${drag?.isDragging ? 'drag-placeholder' : ''} ${drag?.isDragOver ? 'drag-over' : ''}`}
      data-reorder-id={drag?.index}
      data-reorder-scope={drag?.scope}
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
            onPointerDown={drag.onPointerDown}
            onPointerMove={drag.onPointerMove}
            onPointerUp={drag.onPointerUp}
            onPointerCancel={drag.onPointerCancel}
          >
            ⠿
          </button>
        )}
        <input
          type="text"
          aria-label="Rótulo do campo"
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
            aria-label="Opções do campo"
            placeholder="Opções (separadas por vírgula)"
            value={(field.options || []).join(', ')}
            onChange={e => onChange({ options: e.target.value.split(',').map(o => o.trim()) })}
          />
        )}
        {!nested && (
          <input
            type="text"
            aria-label="Seção ou agrupamento"
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
              aria-label="Rótulo do item"
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
  const startValue = useRef<TechnicalFieldDefinition[]>([]);
  const valueRef = useRef<TechnicalFieldDefinition[]>(value);
  const dropHandled = useRef(false);
  const touchDrag = useRef<PointerDragState | null>(null);
  const rowSelector = '.tech-build-row[data-reorder-scope="tech-root"]';
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  useEffect(() => {
    if (dragIndex.current === null) valueRef.current = value;
  }, [value]);

  function update(index: number, patch: Partial<TechnicalFieldDefinition>) {
    onChange(value.map((field, i) => (i === index ? { ...field, ...patch } : field)));
  }

  function clearDrag() {
    dragIndex.current = null;
    setDraggingIndex(null);
    setOverIndex(null);
  }

  function applyValue(next: TechnicalFieldDefinition[]) {
    valueRef.current = next;
    onChange(next);
  }

  function startDrag(index: number) {
    dropHandled.current = false;
    valueRef.current = value;
    startValue.current = value;
    dragIndex.current = index;
    setDraggingIndex(index);
    setOverIndex(index);
  }

  function applyReorder(targetIndex: number) {
    const from = dragIndex.current;
    if (
      from === null ||
      from === targetIndex ||
      !Number.isInteger(targetIndex) ||
      targetIndex < 0 ||
      targetIndex >= valueRef.current.length
    ) return;
    const next = reorderFields(valueRef.current, from, targetIndex);
    dragIndex.current = targetIndex;
    setDraggingIndex(targetIndex);
    setOverIndex(targetIndex);
    applyValue(next);
  }

  function handleDrop(targetIndex: number) {
    dropHandled.current = true;
    applyReorder(targetIndex);
    clearDrag();
  }

  function handleDragEnd() {
    if (!dropHandled.current) applyValue(startValue.current);
    dropHandled.current = false;
    clearDrag();
  }

  function finishPointerDrag(event: PointerEvent<HTMLButtonElement>, persist: boolean) {
    const state = touchDrag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    state.ghost.remove();
    touchDrag.current = null;
    document.body.classList.remove('app-reorder-touching');
    if (!persist) applyValue(startValue.current);
    clearDrag();
  }

  function dragConfig(index: number, label: string): FieldDragConfig {
    const source = label.trim() || `Campo ${index + 1}`;
    return {
      index,
      label: `Arrastar ${source}`,
      scope: 'tech-root',
      isDragging: draggingIndex === index,
      isDragOver: overIndex === index && draggingIndex !== index,
      onDragStart: event => {
        startDrag(index);
        event.stopPropagation();
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', source);
        setReorderDragImage(event, rowSelector, 'app-reorder-drag-ghost');
      },
      onDragEnd: event => {
        event.stopPropagation();
        handleDragEnd();
      },
      onDragOver: event => {
        if (dragIndex.current === null) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        setOverIndex(index);
        applyReorder(index);
      },
      onDragLeave: () => {
        if (overIndex === index) setOverIndex(null);
      },
      onDrop: event => {
        if (dragIndex.current === null) return;
        event.preventDefault();
        event.stopPropagation();
        handleDrop(index);
      },
      onPointerDown: event => {
        if (event.pointerType === 'mouse') return;
        const row = event.currentTarget.closest(rowSelector);
        if (!(row instanceof HTMLElement)) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        startDrag(index);
        document.body.classList.add('app-reorder-touching');
        const state = createPointerDragGhost(row, event.clientX, event.clientY, 'app-reorder-touch-ghost');
        state.pointerId = event.pointerId;
        touchDrag.current = state;
      },
      onPointerMove: event => {
        const state = touchDrag.current;
        if (!state || state.pointerId !== event.pointerId || dragIndex.current === null) return;
        event.preventDefault();
        event.stopPropagation();
        movePointerDragGhost(state, event.clientX, event.clientY);
        const target = reorderIdFromPoint(event.clientX, event.clientY, rowSelector);
        if (target !== null) applyReorder(Number(target));
      },
      onPointerUp: event => finishPointerDrag(event, true),
      onPointerCancel: event => finishPointerDrag(event, false)
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
