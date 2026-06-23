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

// Editor de um campo. `nested` esconde tipo "grupo" e flags que não fazem sentido em subcampos.
function FieldEditor({ field, onChange, onRemove, unitsCatalog, nested }: {
  field: TechnicalFieldDefinition;
  onChange: (patch: Partial<TechnicalFieldDefinition>) => void;
  onRemove: () => void;
  unitsCatalog: MeasurementDimension[];
  nested?: boolean;
}) {
  const typeOptions = nested ? TECH_TYPES.filter(t => t.value !== 'group') : TECH_TYPES;

  function patchUnit(dimension: string) {
    const dim = unitsCatalog.find(d => d.key === dimension);
    onChange({ unit: { dimension: dimension || null, default: dim?.default ?? null } });
  }

  function updateItem(index: number, patch: Partial<TechnicalFieldDefinition>) {
    const items = (field.itemSchema || []).map((it, i) => (i === index ? { ...it, ...patch } : it));
    onChange({ itemSchema: items });
  }

  return (
    <div className={`tech-build-row ${nested ? 'nested' : ''}`}>
      <div className="tech-build-main">
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
  function update(index: number, patch: Partial<TechnicalFieldDefinition>) {
    onChange(value.map((field, i) => (i === index ? { ...field, ...patch } : field)));
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
          onChange={patch => update(index, patch)}
          onRemove={() => onChange(value.filter((_, i) => i !== index))}
        />
      ))}
    </div>
  );
}
