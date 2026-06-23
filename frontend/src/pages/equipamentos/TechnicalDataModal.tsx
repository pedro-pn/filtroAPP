import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react';

import type {
  CompanyEquipment,
  EquipmentCategory,
  ImageUpload,
  MeasurementDimension,
  TechnicalFieldDefinition
} from '../../api/equipamentos';
import { Modal } from '../../components/ui/Modal';

export interface TechnicalPhotosPayload {
  add: ImageUpload[];
  removeIds: string[];
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

interface Props {
  open: boolean;
  category: EquipmentCategory;
  equipment: CompanyEquipment;
  unitsCatalog: MeasurementDimension[];
  saving: boolean;
  isManager: boolean;
  generating?: boolean;
  onClose: () => void;
  onSubmit: (technicalData: Record<string, unknown>, overrides: Record<string, boolean>, photos: TechnicalPhotosPayload, bumpRevision: boolean) => void;
  onGenerate?: () => void;
}

type MeasureValue = { value: string; unit: string };
type TechValue = unknown;

function sortByOrder(fields: TechnicalFieldDefinition[]): TechnicalFieldDefinition[] {
  return [...(fields || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function defaultUnit(field: TechnicalFieldDefinition, catalog: MeasurementDimension[]): string {
  if (field.unit?.default) return field.unit.default;
  const dim = catalog.find(d => d.key === field.unit?.dimension);
  return dim?.default ?? '';
}

function asMeasure(value: TechValue, field: TechnicalFieldDefinition, catalog: MeasurementDimension[]): MeasureValue {
  if (value && typeof value === 'object' && 'value' in (value as object)) {
    const v = value as Partial<MeasureValue>;
    return { value: v.value ?? '', unit: v.unit ?? defaultUnit(field, catalog) };
  }
  return { value: '', unit: defaultUnit(field, catalog) };
}

// Renderiza um único campo (escalar) — reutilizado no topo e dentro de itens de grupo.
function ScalarField({ field, value, onChange, catalog, idPrefix }: {
  field: TechnicalFieldDefinition;
  value: TechValue;
  onChange: (next: TechValue) => void;
  catalog: MeasurementDimension[];
  idPrefix: string;
}) {
  const id = `${idPrefix}-${field.key}`;
  const strValue = value === undefined || value === null ? '' : String(value);

  if (field.type === 'measure') {
    const dim = catalog.find(d => d.key === field.unit?.dimension);
    const measure = asMeasure(value, field, catalog);
    return (
      <div className="tech-measure">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={measure.value}
          placeholder="Valor"
          onChange={e => onChange({ ...measure, value: e.target.value })}
        />
        {dim ? (
          <select value={measure.unit} aria-label="Unidade" onChange={e => onChange({ ...measure, unit: e.target.value })}>
            {dim.units.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        ) : (
          <input
            type="text"
            className="tech-unit-free"
            aria-label="Unidade"
            placeholder="un."
            value={measure.unit}
            onChange={e => onChange({ ...measure, unit: e.target.value })}
          />
        )}
      </div>
    );
  }

  if (field.type === 'textarea') {
    return <textarea id={id} value={strValue} onChange={e => onChange(e.target.value)} />;
  }

  if (field.type === 'boolean') {
    return (
      <label className="tech-bool">
        <input id={id} type="checkbox" checked={value === true} onChange={e => onChange(e.target.checked)} />
        <span>{value === true ? 'Sim' : 'Não'}</span>
      </label>
    );
  }

  if (field.type === 'select') {
    return (
      <select id={id} value={strValue} onChange={e => onChange(e.target.value)}>
        <option value="">Selecione…</option>
        {(field.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    );
  }

  if (field.type === 'multiselect') {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    const toggle = (opt: string) => {
      onChange(selected.includes(opt) ? selected.filter(o => o !== opt) : [...selected, opt]);
    };
    return (
      <div className="tech-multiselect">
        {(field.options || []).map(opt => (
          <label key={opt} className="tech-chip">
            <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} />
            <span>{opt}</span>
          </label>
        ))}
      </div>
    );
  }

  return (
    <input
      id={id}
      type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
      value={strValue}
      onChange={e => onChange(e.target.value)}
    />
  );
}

// Conjunto repetível (componentes: motores, bombas, filtros…).
function GroupField({ field, value, onChange, catalog, idPrefix }: {
  field: TechnicalFieldDefinition;
  value: TechValue;
  onChange: (next: TechValue) => void;
  catalog: MeasurementDimension[];
  idPrefix: string;
}) {
  const items = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  const subFields = sortByOrder(field.itemSchema || []);
  const itemLabel = field.itemLabel || 'Item';
  const atMax = field.maxItems !== undefined && items.length >= field.maxItems;

  function updateItem(index: number, key: string, next: TechValue) {
    const copy = items.map((it, i) => (i === index ? { ...it, [key]: next } : it));
    onChange(copy);
  }
  function addItem() {
    onChange([...items, {}]);
  }
  function removeItem(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  return (
    <div className="tech-group">
      {items.length === 0 && <p className="tech-group-empty">Nenhum {itemLabel.toLowerCase()} adicionado.</p>}
      {items.map((item, index) => (
        <div className="tech-group-item" key={index}>
          <div className="tech-group-item-head">
            <strong>{itemLabel} #{index + 1}</strong>
            <button type="button" className="mini-btn danger" onClick={() => removeItem(index)}>Remover</button>
          </div>
          <div className="tech-group-fields">
            {subFields.map(sub => (
              <div className="field-group" key={sub.key}>
                <label htmlFor={`${idPrefix}-${index}-${sub.key}`}>{sub.label}</label>
                <ScalarField
                  field={sub}
                  value={item[sub.key]}
                  onChange={next => updateItem(index, sub.key, next)}
                  catalog={catalog}
                  idPrefix={`${idPrefix}-${index}`}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
      <button type="button" className="mini-btn alt" onClick={addItem} disabled={atMax}>
        + Adicionar {itemLabel.toLowerCase()}
      </button>
    </div>
  );
}

export function TechnicalDataModal({ open, category, equipment, unitsCatalog, saving, isManager, generating, onClose, onSubmit, onGenerate }: Props) {
  const fields = useMemo(() => sortByOrder(category.technicalSchema || []), [category.technicalSchema]);

  const [data, setData] = useState<Record<string, unknown>>(() => ({ ...(equipment.technicalData || {}) }));
  const [overrides, setOverrides] = useState<Record<string, boolean>>(() => ({ ...(equipment.technicalFieldOverrides || {}) }));

  // Fotos: as existentes (anexos), as novas (dataURLs a enviar) e as marcadas p/ remover.
  const [newPhotos, setNewPhotos] = useState<ImageUpload[]>([]);
  const [removedPhotoIds, setRemovedPhotoIds] = useState<string[]>([]);
  const [bumpRevision, setBumpRevision] = useState(false);
  const existingPhotos = (equipment.technicalPhotos || []).filter(p => !removedPhotoIds.includes(p.id));

  const generatedDoc = equipment.technicalDocGenerated || null;
  const outdated = Boolean(generatedDoc && equipment.technicalDocGeneratedOutdated);

  async function handlePhotoFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    const uploads = await Promise.all(files.map(async file => ({
      fileName: file.name,
      mimeType: file.type,
      dataUrl: await readFileAsDataUrl(file)
    })));
    setNewPhotos(prev => [...prev, ...uploads.filter(u => u.dataUrl.startsWith('data:image/'))]);
  }

  function setValue(key: string, next: TechValue) {
    setData(prev => ({ ...prev, [key]: next }));
  }
  function isIncluded(field: TechnicalFieldDefinition): boolean {
    if (!field.optionalPerEquipment) return true;
    return overrides[field.key] ?? true;
  }
  function setIncluded(key: string, included: boolean) {
    setOverrides(prev => ({ ...prev, [key]: included }));
  }

  // Agrupa por seção (`group`) preservando a ordem de primeira aparição.
  const sections = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, TechnicalFieldDefinition[]>();
    for (const field of fields) {
      const section = field.group || '';
      if (!map.has(section)) { map.set(section, []); order.push(section); }
      map.get(section)!.push(field);
    }
    return order.map(section => ({ section, items: map.get(section)! }));
  }, [fields]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Remove do payload os campos opcionais desligados (não vão para o documento).
    const cleaned: Record<string, unknown> = {};
    for (const field of fields) {
      if (isIncluded(field)) cleaned[field.key] = data[field.key];
    }
    onSubmit(cleaned, overrides, { add: newPhotos, removeIds: removedPhotoIds }, bumpRevision);
  }

  return (
    <Modal open={open} onClose={onClose} ariaLabelledBy="tech-data-title" panelClassName="modal-card equip-modal">
      <form className="equip-form tech-form" onSubmit={handleSubmit} data-equip-technical-modal>
        <header className="equip-form-head">
          <h3 id="tech-data-title">Dados Técnicos</h3>
          <span className="equip-form-sub">{equipment.code} — {equipment.name}</span>
        </header>

        {fields.length === 0 && (
          <p className="rel-meta">
            Nenhum campo técnico configurado para a categoria “{category.name}”.
            {isManager ? ' Configure os campos em Configurações → categoria.' : ' Peça ao gestor para configurar.'}
          </p>
        )}

        {sections.map(({ section, items }) => (
          <fieldset className="tech-section" key={section || '_default'} data-equip-technical-edit-fields>
            {section && <legend>{section}</legend>}
            {items.map(field => {
              const included = isIncluded(field);
              return (
                <div className="field-group tech-field" key={field.key}>
                  <div className="tech-field-label">
                    <label htmlFor={`tech-${field.key}`}>{field.label}{field.required ? ' *' : ''}</label>
                    {field.optionalPerEquipment && (
                      <label className="tech-include">
                        <input type="checkbox" checked={included} onChange={e => setIncluded(field.key, e.target.checked)} />
                        <span>Aplicável</span>
                      </label>
                    )}
                  </div>
                  {included && (
                    field.type === 'group' ? (
                      <GroupField
                        field={field}
                        value={data[field.key]}
                        onChange={next => setValue(field.key, next)}
                        catalog={unitsCatalog}
                        idPrefix={`tech-${field.key}`}
                      />
                    ) : (
                      <ScalarField
                        field={field}
                        value={data[field.key]}
                        onChange={next => setValue(field.key, next)}
                        catalog={unitsCatalog}
                        idPrefix="tech"
                      />
                    )
                  )}
                </div>
              );
            })}
          </fieldset>
        ))}

        <fieldset className="tech-section tech-photos">
          <legend>Fotos</legend>
          <p className="rel-meta">Opcional. Aparecem no datasheet gerado; se não houver, a seção de fotos é omitida.</p>
          <div className="tech-photo-grid">
            {existingPhotos.map(photo => (
              <div className="tech-photo" key={photo.id}>
                <img src={photo.publicUrl} alt={photo.fileName} loading="lazy" />
                {isManager && (
                  <button type="button" className="tech-photo-remove" aria-label="Remover foto"
                    onClick={() => setRemovedPhotoIds(prev => [...prev, photo.id])}>×</button>
                )}
              </div>
            ))}
            {newPhotos.map((photo, i) => (
              <div className="tech-photo is-new" key={`new-${i}`}>
                <img src={photo.dataUrl} alt={photo.fileName || 'Nova foto'} />
                <button type="button" className="tech-photo-remove" aria-label="Remover foto"
                  onClick={() => setNewPhotos(prev => prev.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
            {existingPhotos.length === 0 && newPhotos.length === 0 && (
              <p className="tech-group-empty">Nenhuma foto.</p>
            )}
          </div>
          {isManager && (
            <label className="mini-btn alt tech-photo-add">
              + Adicionar fotos
              <input type="file" accept="image/png,image/jpeg,image/webp" multiple
                style={{ display: 'none' }} onChange={handlePhotoFiles} />
            </label>
          )}
        </fieldset>

        {category.technicalDocEnabled && (generatedDoc || isManager) && (
          <div className="tech-doc-bar" data-equip-technical-doc-bar>
            <div className="tech-doc-status">
              <strong>Datasheet (PDF)</strong>
              {generatedDoc ? (
                <span className={`tech-doc-state ${outdated ? 'is-outdated' : 'is-ok'}`}>
                  {outdated ? 'desatualizado — gere novamente' : 'atualizado'}
                </span>
              ) : (
                <span className="tech-doc-state">ainda não gerado</span>
              )}
            </div>
            <div className="tech-doc-actions">
              {generatedDoc && (
                <a className="mini-btn alt" href={generatedDoc.publicUrl} target="_blank" rel="noreferrer">Baixar</a>
              )}
              {isManager && onGenerate && (
                <button className="mini-btn" type="button" onClick={onGenerate} disabled={saving || generating || fields.length === 0}>
                  {generating ? 'Gerando…' : generatedDoc ? 'Regenerar' : 'Gerar datasheet'}
                </button>
              )}
            </div>
          </div>
        )}

        {isManager && (
          <label className="equip-toggle tech-bump" title="Ao salvar, sobe a revisão e descarta o datasheet anterior (a nova revisão começa limpa)">
            <input type="checkbox" checked={bumpRevision} onChange={e => setBumpRevision(e.target.checked)} />
            <span>Incrementar revisão (atual: {equipment.technicalRevision ?? 0})</span>
          </label>
        )}

        <div className="admin-form-actions equip-form-actions">
          <button className="mini-btn alt" type="button" onClick={onClose} disabled={saving}>Fechar</button>
          {isManager && (
            <button className="mini-btn" type="submit" disabled={saving || fields.length === 0} data-equip-technical-save>
              {saving ? 'Salvando…' : 'Salvar dados técnicos'}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
