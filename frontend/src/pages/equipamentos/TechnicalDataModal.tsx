import { useMemo, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent } from 'react';

import type {
  CompanyEquipment,
  EquipmentCategory,
  EquipmentAttachment,
  ImageUpload,
  MeasurementDimension,
  TechnicalFieldDefinition
} from '../../api/equipamentos';
import { Modal } from '../../components/ui/Modal';
import { formatDate } from './equipmentStatus';

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

function imageMimeType(file: File): string {
  const type = String(file.type || '').toLowerCase();
  if (['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(type)) return type;
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  return '';
}

function isSupportedImageFile(file: File): boolean {
  return Boolean(imageMimeType(file));
}

function normalizeImageDataUrl(dataUrl: string, mimeType: string): string {
  return dataUrl.replace(/^data:[^;]*;base64,/, `data:${mimeType};base64,`);
}

interface Props {
  open: boolean;
  category: EquipmentCategory;
  equipment: CompanyEquipment;
  unitsCatalog: MeasurementDimension[];
  saving: boolean;
  isManager: boolean;
  onClose: () => void;
  onSubmit: (technicalData: Record<string, unknown>, overrides: Record<string, boolean>, photos: TechnicalPhotosPayload, bumpRevision: boolean) => void;
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

export function TechnicalDataModal({ open, category, equipment, unitsCatalog, saving, isManager, onClose, onSubmit }: Props) {
  const fields = useMemo(() => sortByOrder(category.technicalSchema || []), [category.technicalSchema]);
  const [activeTab, setActiveTab] = useState<'dados' | 'historico'>('dados');

  const [data, setData] = useState<Record<string, unknown>>(() => ({ ...(equipment.technicalData || {}) }));
  const [overrides, setOverrides] = useState<Record<string, boolean>>(() => ({ ...(equipment.technicalFieldOverrides || {}) }));

  // Snapshot do estado inicial — usado para detectar se algo mudou e, então, avisar que
  // salvar vai gerar uma nova revisão (arquivando o PDF dos dados anteriores).
  const initialSnapshot = useRef({
    data: JSON.stringify(equipment.technicalData || {}),
    overrides: JSON.stringify(equipment.technicalFieldOverrides || {})
  });

  // Fotos: as existentes (anexos), as novas (dataURLs a enviar) e as marcadas p/ remover.
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const [newPhotos, setNewPhotos] = useState<ImageUpload[]>([]);
  const [removedPhotoIds, setRemovedPhotoIds] = useState<string[]>([]);
  const [photoDragOver, setPhotoDragOver] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const existingPhotos = (equipment.technicalPhotos || []).filter(p => !removedPhotoIds.includes(p.id));
  const totalPhotos = existingPhotos.length + newPhotos.length;
  const photoDisabled = !isManager || saving || photoBusy;

  // Detecta alterações (dados, aplicabilidade ou fotos) para avisar sobre a nova revisão.
  const dataChanged = JSON.stringify(data) !== initialSnapshot.current.data;
  const overridesChanged = JSON.stringify(overrides) !== initialSnapshot.current.overrides;
  const photosChanged = newPhotos.length > 0 || removedPhotoIds.length > 0;
  const hasChanges = dataChanged || overridesChanged || photosChanged;
  const currentRevision = equipment.technicalRevision ?? 0;

  // Histórico: todos os PDFs de revisões arquivadas (mais recente primeiro) + PDF legado.
  const currentTechnicalPdf = equipment.technicalDocGenerated || equipment.technicalDoc || null;
  const technicalPdfHistory = useMemo(() => {
    const seen = new Set<string>();
    return [currentTechnicalPdf, ...(equipment.technicalDocArchive || [])].filter((doc): doc is EquipmentAttachment => {
      if (!doc || seen.has(doc.id)) return false;
      seen.add(doc.id);
      return true;
    });
  }, [currentTechnicalPdf, equipment.technicalDocArchive]);

  async function handlePhotoFiles(filesSource: FileList | File[] | null) {
    const selected = Array.from(filesSource || []);
    if (!selected.length) return;
    const images = selected.filter(isSupportedImageFile);
    if (!images.length) {
      setPhotoError('Selecione imagens PNG, JPG ou WEBP.');
      return;
    }

    setPhotoBusy(true);
    setPhotoError('');
    try {
      const uploads = await Promise.all(images.map(async file => {
        const mimeType = imageMimeType(file);
        return {
          fileName: file.name,
          mimeType,
          dataUrl: normalizeImageDataUrl(await readFileAsDataUrl(file), mimeType)
        };
      }));
      setNewPhotos(prev => [...prev, ...uploads]);
      setPhotoError(images.length === selected.length ? '' : 'Alguns arquivos foram ignorados. Use PNG, JPG ou WEBP.');
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : 'Não foi possível ler as fotos.');
    } finally {
      setPhotoBusy(false);
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  }

  function openPhotoPicker() {
    if (!photoDisabled) photoInputRef.current?.click();
  }

  function handlePhotoKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPhotoPicker();
    }
  }

  function handlePhotoDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setPhotoDragOver(false);
    if (!photoDisabled) void handlePhotoFiles(event.dataTransfer.files);
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
    onSubmit(cleaned, overrides, { add: newPhotos, removeIds: removedPhotoIds }, hasChanges);
  }

  return (
    <Modal open={open} onClose={onClose} ariaLabelledBy="tech-data-title" panelClassName="modal-card equip-modal">
      <button
        className="equip-modal-close-float icon-button"
        type="button"
        aria-label="Fechar dados técnicos"
        title="Fechar"
        onClick={onClose}
        disabled={saving}
      >
        ×
      </button>
      {/* Cabeçalho + abas ficam FORA da área que rola (não somem ao rolar os campos). */}
      <div className="equip-modal-head">
        <header className="equip-form-head has-float-close">
          <h3 id="tech-data-title">Dados Técnicos</h3>
          <span className="equip-form-sub">{equipment.code} — {equipment.name}</span>
        </header>

        {/* Histórico de revisões fica disponível apenas para admins/gestores do módulo. */}
        {isManager && (
          <div className="filter-tabs equip-form-tabs" role="tablist" aria-label="Seções dos dados técnicos">
            <button
              className={`filter-tab ${activeTab === 'dados' ? 'active' : ''}`}
              type="button"
              role="tab"
              aria-selected={activeTab === 'dados'}
              onClick={() => setActiveTab('dados')}
            >
              Dados
            </button>
            <button
              className={`filter-tab ${activeTab === 'historico' ? 'active' : ''}`}
              type="button"
              role="tab"
              aria-selected={activeTab === 'historico'}
              onClick={() => setActiveTab('historico')}
            >
              Histórico de revisões
            </button>
          </div>
        )}
      </div>

      <form className="equip-form tech-form" onSubmit={handleSubmit} data-equip-technical-modal>
        {activeTab === 'dados' ? (
          <>
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
              {isManager && (
                <div
                  className={`upload-dropzone ${photoDragOver ? 'drag-over' : ''} ${photoBusy ? 'busy' : ''} ${totalPhotos ? 'has-file' : ''}`}
                  role="button"
                  tabIndex={photoDisabled ? -1 : 0}
                  aria-disabled={photoDisabled}
                  onClick={openPhotoPicker}
                  onKeyDown={handlePhotoKeyDown}
                  onDragOver={event => {
                    if (!photoDisabled) {
                      event.preventDefault();
                      setPhotoDragOver(true);
                    }
                  }}
                  onDragLeave={() => setPhotoDragOver(false)}
                  onDrop={handlePhotoDrop}
                >
                  <input
                    ref={photoInputRef}
                    className="visually-hidden"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    disabled={photoDisabled}
                    onChange={event => void handlePhotoFiles(event.target.files)}
                  />
                  <span className="upload-dropzone-icon" aria-hidden="true">⤓</span>
                  <span className="upload-dropzone-text">
                    <strong>{photoBusy ? 'Preparando…' : 'Arraste as fotos aqui'}</strong>
                    <small>{totalPhotos ? `${totalPhotos} arquivo(s) · clique ou solte para adicionar` : 'ou clique para selecionar'}</small>
                  </span>
                </div>
              )}
              {photoError ? <div className="inline-error">{photoError}</div> : null}
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
            </fieldset>

            {isManager && hasChanges && (
              <p className="tech-revision-warning" role="alert" data-equip-technical-revision-warning>
                Há alterações não salvas. Ao salvar, será gerada uma nova revisão dos dados técnicos
                (revisão {currentRevision} → {currentRevision + 1}): um novo PDF é gerado com os dados
                atualizados e a revisão anterior fica arquivada no histórico.
              </p>
            )}
          </>
        ) : (
          <div className="equip-calibration-history" role="tabpanel" aria-label="Histórico de revisões dos dados técnicos">
            {technicalPdfHistory.map((pdf, index) => {
              const revMatch = pdf.fileName.match(/Rev\s*(\d+)/i);
              const title = revMatch ? `Revisão ${revMatch[1]}` : (index === 0 ? 'Datasheet' : `Datasheet arquivado #${index}`);
              return (
                <div className="equip-history-row" key={pdf.id}>
                  <div className="equip-history-meta">
                    <strong>{title}</strong>
                    <span>{formatDate(pdf.createdAt)} · {pdf.fileName}</span>
                  </div>
                  <a className="mini-btn alt" href={pdf.publicUrl} target="_blank" rel="noreferrer">
                    Baixar
                  </a>
                </div>
              );
            })}
            {!technicalPdfHistory.length && (
              <p className="rel-meta">Nenhuma revisão arquivada ainda. As revisões anteriores aparecem aqui sempre que os dados técnicos são alterados.</p>
            )}
          </div>
        )}

        <div className="admin-form-actions equip-form-actions">
          {activeTab === 'dados' && isManager ? (
            <button className="mini-btn" type="submit" disabled={saving || fields.length === 0} data-equip-technical-save>
              {saving ? 'Salvando…' : 'Salvar e fechar'}
            </button>
          ) : (
            <button className="mini-btn alt" type="button" onClick={onClose} disabled={saving}>Fechar</button>
          )}
        </div>
      </form>
    </Modal>
  );
}
