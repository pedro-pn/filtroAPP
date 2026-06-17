import type { ReactNode } from 'react';
import { inhibitionSystemValue, type InhibitionOptions } from '../../api/inhibitionOptions';
import type { Manometer, ParticleCounter, Unit } from '../../types/domain';
import type { UploadedFile } from '../../api/uploads';
import { UploadField } from '../ui/UploadField';

export const serviceTypeLabels: Record<string, string> = {
  limpeza: 'Limpeza química',
  pressao: 'Teste de pressão',
  flushing: 'Flushing',
  filtragem: 'Filtragem',
  mecanica: 'Limpeza mecânica',
  inibicao: 'Inibição',
  LIMPEZA: 'Limpeza química',
  PRESSAO: 'Teste de pressão',
  FLUSHING: 'Flushing',
  FILTRAGEM: 'Filtragem',
  MECANICA: 'Limpeza mecânica',
  INIBICAO: 'Inibição'
};

export const serviceTypeOptions = ['limpeza', 'pressao', 'flushing', 'filtragem', 'mecanica', 'inibicao'] as const;

const etapasPorTipo: Record<string, string[]> = {
  LIMPEZA: [
    'Montagem do sistema', 'Teste de estanqueidade', 'Desengraxe',
    'Fase ácida', 'Fase sequestrante', 'Fase neutralizante', 'Fase passivante',
    'Secagem', 'Desmontagem do sistema', 'Inspeção por boroscopia'
  ],
  PRESSAO: ['Montagem do sistema', 'Execução do teste', 'Desmontagem do sistema'],
  FLUSHING: [
    'Abastecimento de óleo', 'Montagem do sistema', 'Realização do flushing',
    'Desidratação com centrífuga', 'Desidratação com termovácuo',
    'Desmontagem do sistema', 'Drenagem do óleo', 'Coleta de amostra'
  ],
  FILTRAGEM: [
    'Abastecimento de óleo', 'Montagem do sistema', 'Realização da filtragem',
    'Desidratação com centrífuga', 'Desidratação com termovácuo',
    'Desmontagem do sistema', 'Drenagem do óleo', 'Coleta de amostra'
  ],
  MECANICA: [
    'Inspeção inicial', 'Drenagem de fluidos e resíduos', 'Raspagem mecânica',
    'Sucção de resíduos', 'Hidrojateamento de alta pressão', 'Jateamento abrasivo',
    'Limpeza mecânica', 'Desengraxe', 'Secagem', 'Inspeção final'
  ],
  INIBICAO: [
    'Montagem do sistema', 'Teste de estanqueidade', 'Desengraxe',
    'Flushing', 'Circulação do inibidor', 'Lavagem',
    'Drenagem do sistema', 'Desmontagem do sistema', 'Montagem definitiva do sistema', 'Coleta de amostra'
  ]
};

type UploadGroup = { label: string; files: UploadedFile[] };
type TubeRow = { d: string; unit: string; c: string; lengthUnit: string };
export type ServiceCollaboratorOption = { id: string; name: string };

const commonInchDiameters = [
  '1/8',
  '1/4',
  '3/8',
  '1/2',
  '3/4',
  '1',
  '1 1/4',
  '1 1/2',
  '2',
  '2 1/2',
  '3',
  '3 1/2',
  '4',
  '5',
  '6',
  '8',
  '10',
  '12',
  '14',
  '16',
  '18',
  '20'
];

const unitCategoryLabels: Record<string, string> = {
  FILTRAGEM: 'Filtragem',
  FLUSHING: 'Flushing',
  LIMPEZA_QUIMICA: 'Limpeza química',
  DESIDRATACAO: 'Desidratação',
  UTH: 'UTH',
  OUTRA: 'Outra'
};

const unitCategoryAliases: Record<string, string[]> = {
  FILTRAGEM: ['Filtragem', 'Unidade de filtragem', 'Unidades de filtragem', 'UNIDADE DE FILTRAGEM'],
  FLUSHING: ['Flushing', 'Unidade de flushing', 'Unidades de flushing', 'UNIDADE DE FLUSHING'],
  LIMPEZA_QUIMICA: ['Limpeza química', 'Unidade de limpeza química', 'Unidades de limpeza química', 'UNIDADE DE LIMPEZA QUIMICA'],
  DESIDRATACAO: ['Desidratação', 'Unidade de desidratação', 'Unidades de desidratação', 'UNIDADE DE DESIDRATACAO'],
  UTH: ['UTH', 'Unidade de teste hidrostático', 'Unidade de teste hidrostatico', 'UNIDADE DE TESTE HIDROSTATICO'],
  OUTRA: ['Outra', 'Outras', 'Unidades']
};

function comparableCategory(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function unitMatchesCategory(unit: Unit, category: Unit['category']) {
  const unitCategory = comparableCategory(unit.category);
  const acceptedCategories = [
    category,
    unitCategoryLabels[category],
    ...(unitCategoryAliases[category] || [])
  ];
  return unitCategory === comparableCategory(category)
    || acceptedCategories.some(item => unitCategory === comparableCategory(item));
}


type StoredUploadRecord = UploadedFile & {
  name?: string;
  path?: string;
  storagePath?: string;
  dataUrl?: string;
  source?: string;
  src?: string;
  href?: string;
  publicUrl?: string;
};

const uploadLabelAliases: Record<string, string[]> = {
  'Foto do laudo': ['Foto do laudo', 'Foto do laudo do contador']
};

function uploadLabels(label: string) {
  return uploadLabelAliases[label] || [label];
}

function uploadFileNameFromUrl(value: string) {
  const pathPart = value.split('?')[0].split('#')[0].replace(/\\/g, '/');
  const name = pathPart.split('/').filter(Boolean).pop();
  if (!name) return '';
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

function normalizeUploadFile(value: unknown, label: string): UploadedFile | null {
  if (typeof value === 'string') {
    const url = value.trim();
    if (!url) return null;
    return {
      label,
      fileName: uploadFileNameFromUrl(url) || 'arquivo',
      mimeType: 'image/jpeg',
      url
    };
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const record = value as Partial<StoredUploadRecord>;
  const url = String(
    record.url
    || record.path
    || record.storagePath
    || record.dataUrl
    || record.source
    || record.src
    || record.href
    || record.publicUrl
    || record.fileName
    || ''
  ).trim();
  if (!url) return null;

  const explicitFileName = String(record.fileName || record.name || '').trim();
  const fileName = (explicitFileName && explicitFileName !== url ? explicitFileName : uploadFileNameFromUrl(url)) || 'arquivo';
  const mimeType = String(record.mimeType || 'image/jpeg').trim();
  const nextLabel = String(record.label || label).trim();

  if (record.url === url && record.fileName === fileName && record.mimeType === mimeType && record.label === nextLabel) {
    return record as UploadedFile;
  }

  return {
    ...record,
    label: nextLabel,
    fileName,
    mimeType,
    url
  } as UploadedFile;
}

function normalizeUploadFiles(value: unknown, label: string): UploadedFile[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => normalizeUploadFile(item, label))
    .filter((item): item is UploadedFile => Boolean(item));
}

function getGroup(data: Record<string, unknown>, label: string): UploadedFile[] {
  const groups = Array.isArray(data.__uploads__) ? (data.__uploads__ as UploadGroup[]) : [];
  const labels = uploadLabels(label);
  const group = groups.find(g => labels.includes(g.label));
  if (group) return normalizeUploadFiles(group.files, group.label || label);

  for (const itemLabel of labels) {
    const files = normalizeUploadFiles(data[itemLabel], label);
    if (files.length) return files;
  }
  return [];
}

function setGroup(
  data: Record<string, unknown>,
  onChange: (update: Record<string, unknown>) => void,
  label: string,
  files: UploadedFile[]
) {
  const groups = Array.isArray(data.__uploads__) ? (data.__uploads__ as UploadGroup[]) : [];
  const labels = uploadLabels(label);
  const filtered = groups.filter(g => !labels.includes(g.label));
  onChange({ __uploads__: files.length ? [...filtered, { label, files }] : filtered });
}

function getStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function getStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value === 'string' && value) return [value];
  return [''];
}

function getString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isNoValue(value: unknown) {
  if (Array.isArray(value)) value = value[0];
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') === 'nao';
}

function limpezaTubulacaoValue(data: Record<string, unknown>) {
  const raw = data.limpezaTubulacao || data['Limpeza de tubulação?'] || data['Limpeza de tubulacao?'];
  return isNoValue(raw) ? 'Não' : 'Sim';
}

function flushingTubulacaoValue(data: Record<string, unknown>) {
  const raw = data.flushingTubulacao || data['Flushing em tubulação?'] || data['Flushing em tubulacao?'];
  return isNoValue(raw) ? 'Não' : 'Sim';
}

function onlyNumberPunctuation(value: string) {
  return value.replace(/[^\d.,]/g, '');
}

function normalizeServiceType(type: string) {
  const map: Record<string, string> = {
    LIMPEZA: 'limpeza',
    PRESSAO: 'pressao',
    FLUSHING: 'flushing',
    FILTRAGEM: 'filtragem',
    MECANICA: 'mecanica',
    INIBICAO: 'inibicao'
  };
  return map[type] || type;
}

function toggleItem(arr: string[], item: string, checked: boolean): string[] {
  return checked ? [...arr, item] : arr.filter(v => v !== item);
}

function requiredMark() {
  return <span style={{ color: 'var(--rd)' }}>*</span>;
}

function radioOptionClass(checked: boolean, negative = false) {
  return `rdo-tag-option ${checked ? (negative ? 'no' : 'yes') : ''}`;
}

function pillOptionClass(checked: boolean) {
  return `rdo-pill-option ${checked ? 'sel' : ''}`;
}

export interface EquipmentOption {
  id: string;
  code: string;
  name?: string;
  categoryId?: string;
  serialNumber?: string;
  scale?: string;
  isActive?: boolean;
}

interface ServiceFieldsProps {
  serviceType: string;
  data: Record<string, unknown>;
  onChange: (update: Record<string, unknown>) => void;
  disabled?: boolean;
  units: Unit[];
  manometers: Manometer[];
  counters?: ParticleCounter[];
  equipments?: EquipmentOption[];
  rdoSlotMap?: Record<string, string | null>;
  inhibitionOptions?: InhibitionOptions;
  collaboratorOptions?: ServiceCollaboratorOption[];
  groupKey: string;
  projectId?: string | null;
  invalidKey?: string | null;
  hideFinalization?: boolean;
}

// Opções de um slot a partir do mapeamento configurável (categoryId). Retorna
// null quando o bootstrap ainda não traz equipments/rdoSlotMap (fallback legado).
function slotOptionsFrom(
  equipments: EquipmentOption[] | undefined,
  rdoSlotMap: Record<string, string | null> | undefined,
  slotKey: string
): EquipmentOption[] | null {
  if (!equipments || !rdoSlotMap || !(slotKey in rdoSlotMap)) return null;
  const categoryId = rdoSlotMap[slotKey];
  if (!categoryId) return [];
  return equipments.filter(item => item.categoryId === categoryId && item.isActive !== false);
}

function updateArrayItem<T>(items: T[], index: number, next: T) {
  return items.map((item, itemIndex) => (itemIndex === index ? next : item));
}

function fieldClass(invalidKey: string | null | undefined, key: string) {
  return `field-group ${invalidKey === key ? 'field-invalid' : ''}`;
}

function fieldId(groupKey: string, field: string, suffix?: string | number) {
  return ['svc', groupKey, field, suffix].filter(value => value !== undefined && value !== '').join('-');
}

function MaterialField({
  data,
  onChange,
  disabled,
  invalidKey,
  groupKey,
  label = 'Material da tubulação'
}: Pick<ServiceFieldsProps, 'data' | 'onChange' | 'disabled' | 'invalidKey' | 'groupKey'> & { label?: string }) {
  const material = getString(data.material);
  const materialOther = getString(data.materialOther);
  const selected = ['Aço carbono', 'Inox', 'CuNiFe'].includes(material) ? material : material ? 'Outro' : '';
  const isPre = Boolean(data._prefilled && material);
  const materialId = fieldId(groupKey, 'material');
  const materialOtherId = fieldId(groupKey, 'material-outro');

  return (
    <>
      <div className={fieldClass(invalidKey, 'material')}>
        <label htmlFor={materialId}>
          {label} {requiredMark()}
          {isPre ? <span className="pre-badge">pré-preenchido</span> : null}
        </label>
        <select
          id={materialId}
          className={isPre ? 'pre' : ''}
          value={selected}
          disabled={disabled}
          onChange={event => {
            const value = event.target.value;
            onChange({ material: value === 'Outro' ? materialOther : value, materialOther: value === 'Outro' ? materialOther : '' });
          }}
        >
          <option value="">Selecionar...</option>
          <option value="Aço carbono">Aço carbono</option>
          <option value="Inox">Inox</option>
          <option value="CuNiFe">CuNiFe</option>
          <option value="Outro">Outro</option>
        </select>
      </div>
      {selected === 'Outro' ? (
        <div className="field-group">
          <label htmlFor={materialOtherId}>Outro material</label>
          <input
            id={materialOtherId}
            value={materialOther || material}
            disabled={disabled}
            onChange={event => onChange({ material: event.target.value, materialOther: event.target.value })}
          />
        </div>
      ) : null}
    </>
  );
}

function TubesBlock({ data, onChange, disabled, invalidKey, groupKey }: Pick<ServiceFieldsProps, 'data' | 'onChange' | 'disabled' | 'invalidKey' | 'groupKey'>) {
  const rows = (Array.isArray(data.tubes) ? data.tubes : [{ d: '', unit: 'pol', c: '', lengthUnit: 'm' }]) as TubeRow[];

  return (
    <div className={fieldClass(invalidKey, 'tubes')}>
      <label>Diâmetros e comprimentos {requiredMark()}</label>
      <div className="tube-stack">
        {rows.map((row, index) => (
          <div className="tube-row-react" key={index}>
            <div className="field-group tube-field">
              <label htmlFor={fieldId(groupKey, 'diametro', index)}>Diâmetro {requiredMark()}</label>
              <div className="num-unit">
                {(row.unit || 'pol') === 'pol' ? (
                  <select
                    id={fieldId(groupKey, 'diametro', index)}
                    aria-label={`Diâmetro ${index + 1}`}
                    value={row.d || ''}
                    disabled={disabled}
                    onChange={event => onChange({ tubes: updateArrayItem(rows, index, { ...row, d: event.target.value }) })}
                  >
                    <option value="">Selecionar...</option>
                    {row.d && !commonInchDiameters.includes(row.d) ? (
                      <option value={row.d}>{row.d}</option>
                    ) : null}
                    {commonInchDiameters.map(diameter => (
                      <option key={diameter} value={diameter}>{diameter}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={fieldId(groupKey, 'diametro', index)}
                    aria-label={`Diâmetro ${index + 1}`}
                    inputMode="decimal"
                    placeholder="50"
                    value={row.d || ''}
                    disabled={disabled}
                    onChange={event => onChange({ tubes: updateArrayItem(rows, index, { ...row, d: onlyNumberPunctuation(event.target.value) }) })}
                  />
                )}
                <select
                  id={fieldId(groupKey, 'diametro-unidade', index)}
                  aria-label={`Unidade do diâmetro ${index + 1}`}
                  value={row.unit || 'pol'}
                  disabled={disabled}
                  onChange={event => {
                    const unit = event.target.value;
                    onChange({
                      tubes: updateArrayItem(rows, index, {
                        ...row,
                        unit,
                        d: unit === 'pol' && row.d && !commonInchDiameters.includes(row.d) ? '' : row.d
                      })
                    });
                  }}
                >
                  <option value="pol">pol</option>
                  <option value="mm">mm</option>
                </select>
              </div>
            </div>
            <div className="field-group tube-field">
              <label htmlFor={fieldId(groupKey, 'comprimento', index)}>Comprimento {requiredMark()}</label>
              <div className="num-unit">
                <input
                  id={fieldId(groupKey, 'comprimento', index)}
                  aria-label={`Comprimento ${index + 1}`}
                  inputMode="decimal"
                  placeholder="45"
                  value={row.c || ''}
                  disabled={disabled}
                  onChange={event => onChange({ tubes: updateArrayItem(rows, index, { ...row, c: onlyNumberPunctuation(event.target.value) }) })}
                />
                <select
                  id={fieldId(groupKey, 'comprimento-unidade', index)}
                  aria-label={`Unidade do comprimento ${index + 1}`}
                  value={row.lengthUnit || 'm'}
                  disabled={disabled}
                  onChange={event => onChange({ tubes: updateArrayItem(rows, index, { ...row, lengthUnit: event.target.value }) })}
                >
                  <option value="m">m</option>
                  <option value="cm">cm</option>
                </select>
              </div>
            </div>
            <button
              className="tube-remove"
              type="button"
              disabled={disabled || rows.length === 1}
              onClick={() => onChange({ tubes: rows.filter((_, rowIndex) => rowIndex !== index) })}
              aria-label={`Remover tubulação ${index + 1}`}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        className="secondary-button"
        type="button"
        disabled={disabled}
        onClick={() => onChange({ tubes: [...rows, { d: '', unit: 'pol', c: '', lengthUnit: 'm' }] })}
      >
        + Adicionar tubulação
      </button>
    </div>
  );
}

function UnitMultiField({
  label,
  field,
  units,
  categories,
  options: providedOptions,
  data,
  onChange,
  disabled,
  invalidKey,
  groupKey,
  required = true
}: Pick<ServiceFieldsProps, 'data' | 'onChange' | 'disabled' | 'invalidKey' | 'groupKey'> & {
  label: string;
  field: string;
  units: Unit[];
  categories: Unit['category'][];
  options?: EquipmentOption[] | null;
  required?: boolean;
}) {
  const selected = getStringList(data[field]);
  const options: Array<{ id: string; code: string; name?: string }> = providedOptions
    ? providedOptions
    : units.filter(unit => categories.some(category => unitMatchesCategory(unit, category)));

  return (
    <div className={fieldClass(invalidKey, field)}>
      <label>{label} {required ? requiredMark() : null}</label>
      <div className="unit-stack">
        {selected.map((value, index) => (
          <div className="unit-row-react" key={`${field}-${index}`}>
            <select
              id={fieldId(groupKey, field, index)}
              aria-label={`${label} ${index + 1}`}
              value={value}
              disabled={disabled}
              onChange={event => onChange({ [field]: updateArrayItem(selected, index, event.target.value) })}
            >
              <option value="">Selecionar...</option>
              {options.map(unit => <option key={unit.id} value={unit.id}>{[unit.code, unit.name].filter(Boolean).join(' - ')}</option>)}
            </select>
            <button
              className="unit-row-remove"
              type="button"
              disabled={disabled || selected.length === 1}
              onClick={() => onChange({ [field]: selected.filter((_, itemIndex) => itemIndex !== index) })}
              aria-label={`Remover ${label}`}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        className="tube-add"
        type="button"
        disabled={disabled}
        onClick={() => onChange({ [field]: [...selected, ''] })}
      >
        ＋ Adicionar unidade
      </button>
    </div>
  );
}

function FinalizadoAprovadoBlock({ data, onChange, disabled, groupKey, invalidKey }: Pick<ServiceFieldsProps, 'data' | 'onChange' | 'disabled' | 'groupKey' | 'invalidKey'>) {
  const finalized = typeof data.finalized === 'boolean' ? data.finalized : null;
  const aprovadoCliente = getString(data.aprovadoCliente) || 'Sim';

  return (
    <>
      <div className={fieldClass(invalidKey, 'finalized')}>
        <label>Serviço finalizado? {requiredMark()}</label>
        <div className="rdo-tag-group">
          {['Sim', 'Não'].map(label => {
            const value = label === 'Sim';
            const checked = finalized === value;
            return (
              <label className={radioOptionClass(checked, label === 'Não')} key={label}>
                <input
                  type="radio"
                  name={`finalizado-${groupKey}`}
                  checked={checked}
                  disabled={disabled}
                  onChange={() => onChange({ finalized: value })}
                />
                <span>{label}</span>
              </label>
            );
          })}
        </div>
      </div>
      {finalized ? (
        <div className="field-group">
          <label>Aprovado pelo cliente? {requiredMark()}</label>
          <div className="rdo-tag-group">
            {['Sim', 'Não'].map(label => {
              const checked = aprovadoCliente === label;
              return (
                <label className={radioOptionClass(checked, label === 'Não')} key={label}>
                  <input
                    type="radio"
                    name={`aprovado-${groupKey}`}
                    checked={checked}
                    disabled={disabled}
                    onChange={() => onChange({ aprovadoCliente: label })}
                  />
                  <span>{label}</span>
                </label>
              );
            })}
          </div>
        </div>
      ) : null}
    </>
  );
}

export function ServiceCollaboratorsBlock({
  data,
  onChange,
  disabled,
  invalidKey,
  collaboratorOptions = []
}: Pick<ServiceFieldsProps, 'data' | 'onChange' | 'disabled' | 'invalidKey' | 'collaboratorOptions'>) {
  const selected = getStrings(data.serviceCollaboratorIds);

  return (
    <div className={fieldClass(invalidKey, 'serviceCollaboratorIds')}>
      <label>Colaboradores do serviço {requiredMark()}</label>
      <div className="rdo-check-grid svc-team-options">
        {collaboratorOptions.length ? collaboratorOptions.map(collaborator => (
          <label className="rdo-check-row" key={collaborator.id}>
            <input
              type="checkbox"
              checked={selected.includes(collaborator.id)}
              disabled={disabled}
              onChange={event => onChange({ serviceCollaboratorIds: toggleItem(selected, collaborator.id, event.target.checked) })}
            />
            <span>{collaborator.name}</span>
          </label>
        )) : (
          <div style={{ fontSize: 12, color: 'var(--mu)' }}>Adicione colaboradores no cabeçalho para selecionar aqui.</div>
        )}
      </div>
    </div>
  );
}

function EtapasSection({ serviceType, data, onChange, disabled, invalidKey }: Pick<ServiceFieldsProps, 'serviceType' | 'data' | 'onChange' | 'disabled' | 'invalidKey'>) {
  const etapas = etapasPorTipo[serviceType] || etapasPorTipo[normalizeServiceType(serviceType).toUpperCase()];
  if (!etapas?.length) return null;
  const done = getStrings(data.etapas);
  const customDone = done.filter(etapa => !etapas.includes(etapa));
  const custom = getString(data.customEtapa);

  return (
    <div className={`${fieldClass(invalidKey, 'etapas')} service-options-full`}>
      <label>Etapas realizadas no dia {requiredMark()}</label>
      <div className="rdo-check-grid service-step-list">
        {etapas.map(etapa => (
          <label className="rdo-check-row" key={etapa}>
            <input
              type="checkbox"
              checked={done.includes(etapa)}
              disabled={disabled}
              onChange={e => onChange({ etapas: toggleItem(done, etapa, e.target.checked) })}
            />
            <span>{etapa}</span>
          </label>
        ))}
        {customDone.map(etapa => (
          <label className="rdo-check-row" key={etapa}>
            <input
              type="checkbox"
              checked
              disabled={disabled}
              onChange={e => onChange({ etapas: toggleItem(done, etapa, e.target.checked) })}
            />
            <span>{etapa}</span>
          </label>
        ))}
      </div>
      <div className="inline-add-row">
        <input
          value={custom}
          disabled={disabled}
          placeholder="Adicionar etapa..."
          onChange={event => onChange({ customEtapa: event.target.value })}
        />
        <button
          className="secondary-button"
          type="button"
          disabled={disabled || !custom.trim()}
          onClick={() => onChange({ etapas: Array.from(new Set([...done, custom.trim()])), customEtapa: '' })}
        >
          + Add
        </button>
      </div>
    </div>
  );
}

function PressureField({ data, onChange, disabled, invalidKey, groupKey, field, unitField, label }: Pick<ServiceFieldsProps, 'data' | 'onChange' | 'disabled' | 'invalidKey' | 'groupKey'> & { field: string; unitField: string; label: string }) {
  const inputId = fieldId(groupKey, field);

  return (
    <div className={fieldClass(invalidKey, field)}>
      <label htmlFor={inputId}>{label} {requiredMark()}</label>
      <div className="num-unit">
        <input
          id={inputId}
          inputMode="decimal"
          placeholder="0"
          value={getString(data[field])}
          disabled={disabled}
          onChange={event => onChange({ [field]: onlyNumberPunctuation(event.target.value) })}
        />
        <select
          id={fieldId(groupKey, unitField)}
          aria-label={`Unidade de ${label}`}
          value={getString(data[unitField]) || 'bar'}
          disabled={disabled}
          onChange={event => onChange({ [unitField]: event.target.value })}
        >
          <option value="bar">bar</option>
          <option value="psi">psi</option>
          <option value="kg/cm²">kg/cm²</option>
          <option value="MPa">MPa</option>
          <option value="kPa">kPa</option>
        </select>
      </div>
    </div>
  );
}

function VolumeField({ data, onChange, disabled, invalidKey, groupKey }: Pick<ServiceFieldsProps, 'data' | 'onChange' | 'disabled' | 'invalidKey' | 'groupKey'>) {
  const inputId = fieldId(groupKey, 'volumeOleo');

  return (
    <div className={fieldClass(invalidKey, 'volumeOleo')}>
      <label htmlFor={inputId}>Volume de óleo {requiredMark()}</label>
      <div className="num-unit">
        <input
          id={inputId}
          inputMode="decimal"
          placeholder="0"
          value={getString(data.volumeOleo)}
          disabled={disabled}
          onChange={event => onChange({ volumeOleo: onlyNumberPunctuation(event.target.value) })}
        />
        <select
          id={fieldId(groupKey, 'volumeOleoUnit')}
          aria-label="Unidade do volume de óleo"
          value={getString(data.volumeOleoUnit) || 'L'}
          disabled={disabled}
          onChange={event => onChange({ volumeOleoUnit: event.target.value })}
        >
          <option value="L">L</option>
          <option value="mL">mL</option>
        </select>
      </div>
    </div>
  );
}

function ParticulasBlock({ data, onChange, disabled, groupKey, invalidKey, counters = [], counterOptions, upload }: Pick<ServiceFieldsProps, 'data' | 'onChange' | 'disabled' | 'groupKey' | 'invalidKey' | 'counters'> & { counterOptions?: EquipmentOption[] | null; upload: (label: string) => ReactNode }) {
  const enabled = getString(data.houveParticulas) === 'Sim';
  const contadorId = fieldId(groupKey, 'contadorUtilizado');
  const activeCounters: Array<{ id: string; code: string; serialNumber?: string }> = counterOptions
    ? counterOptions
    : counters.filter(counter => counter.isActive !== false);

  return (
    <div className="field-group">
      <label>Houve contagem de partículas?</label>
      <div className="rdo-tag-group">
        {['Sim', 'Não'].map(label => {
          const checked = (getString(data.houveParticulas) || 'Não') === label;
          return (
            <label className={radioOptionClass(checked, label === 'Não')} key={label}>
              <input
                type="radio"
                name={`particulas-${groupKey}`}
                checked={checked}
                disabled={disabled}
                onChange={() => onChange({ houveParticulas: label })}
              />
              <span>{label}</span>
            </label>
          );
        })}
      </div>
      {enabled ? (
        <div className="collapse-section">
          <div className="admin-form-grid">
            <div className={fieldClass(invalidKey, 'contadorUtilizado')}>
              <label htmlFor={contadorId}>Contador utilizado {requiredMark()}</label>
              <select id={contadorId} value={getString(data.contadorUtilizado)} disabled={disabled} onChange={event => onChange({ contadorUtilizado: event.target.value })}>
                <option value="">Selecionar...</option>
                {activeCounters.map(counter => (
                  <option key={counter.id} value={counter.id}>
                    {counter.code} - {counter.serialNumber}
                  </option>
                ))}
              </select>
            </div>
            <div className="fg-r2">
              <div className="field-group">
                <label htmlFor={fieldId(groupKey, 'contagemInicialNas')}>NAS inicial</label>
                <input id={fieldId(groupKey, 'contagemInicialNas')} value={getString(data.contagemInicialNas)} disabled={disabled} onChange={event => onChange({ contagemInicialNas: event.target.value })} />
              </div>
              <div className="field-group">
                <label htmlFor={fieldId(groupKey, 'contagemFinalNas')}>NAS final</label>
                <input id={fieldId(groupKey, 'contagemFinalNas')} value={getString(data.contagemFinalNas)} disabled={disabled} onChange={event => onChange({ contagemFinalNas: event.target.value })} />
              </div>
            </div>
            <div className="fg-r2">
              <div className="field-group">
                <label htmlFor={fieldId(groupKey, 'contagemInicialIso')}>ISO inicial</label>
                <input id={fieldId(groupKey, 'contagemInicialIso')} value={getString(data.contagemInicialIso)} disabled={disabled} onChange={event => onChange({ contagemInicialIso: event.target.value })} />
              </div>
              <div className="field-group">
                <label htmlFor={fieldId(groupKey, 'contagemFinalIso')}>ISO final</label>
                <input id={fieldId(groupKey, 'contagemFinalIso')} value={getString(data.contagemFinalIso)} disabled={disabled} onChange={event => onChange({ contagemFinalIso: event.target.value })} />
              </div>
            </div>
            {upload('Foto do laudo')}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DesidratacaoBlock({ data, onChange, disabled, groupKey, units, unitOptions, invalidKey, upload }: Pick<ServiceFieldsProps, 'data' | 'onChange' | 'disabled' | 'groupKey' | 'units' | 'invalidKey'> & { unitOptions?: EquipmentOption[] | null; upload: (label: string) => ReactNode }) {
  const enabled = getString(data.houveDesidratacao) === 'Sim';
  const hasHumidity = getString(data.houveUmidade) === 'Sim';
  const desidratacaoUnits: Array<{ id: string; code: string }> = unitOptions
    ? unitOptions
    : units.filter(unit => unitMatchesCategory(unit, 'DESIDRATACAO'));

  return (
    <div className="field-group">
      <label>Houve desidratação?</label>
      <div className="rdo-tag-group">
        {['Sim', 'Não'].map(label => {
          const checked = (getString(data.houveDesidratacao) || 'Não') === label;
          return (
            <label className={radioOptionClass(checked, label === 'Não')} key={label}>
              <input
                type="radio"
                name={`desidratacao-${groupKey}`}
                checked={checked}
                disabled={disabled}
                onChange={() => onChange({ houveDesidratacao: label })}
              />
              <span>{label}</span>
            </label>
          );
        })}
      </div>
      {enabled ? (
        <div className="collapse-section">
          <div className="admin-form-grid">
            <div className={fieldClass(invalidKey, 'desidratacaoUnit')}>
              <label htmlFor={fieldId(groupKey, 'desidratacaoUnit')}>Equipamento de desidratação {requiredMark()}</label>
              <select id={fieldId(groupKey, 'desidratacaoUnit')} value={getString(data.desidratacaoUnit)} disabled={disabled} onChange={event => onChange({ desidratacaoUnit: event.target.value })}>
                <option value="">Selecionar...</option>
                {desidratacaoUnits.map(u => <option key={u.id} value={u.id}>{u.code}</option>)}
              </select>
            </div>
            {upload('Fotos da desidratação')}
            <div className="field-group">
              <label>Houve análise de umidade?</label>
              <div className="rdo-tag-group">
                {['Sim', 'Não'].map(label => {
                  const checked = (getString(data.houveUmidade) || 'Não') === label;
                  return (
                    <label className={radioOptionClass(checked, label === 'Não')} key={label}>
                      <input
                        type="radio"
                        name={`umidade-${groupKey}`}
                        checked={checked}
                        disabled={disabled}
                        onChange={() => onChange({ houveUmidade: label })}
                      />
                      <span>{label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            {hasHumidity ? (
              <div className="fg-r2">
                <div className="field-group">
                  <label htmlFor={fieldId(groupKey, 'umidadeInicial')}>Umidade inicial (ppm)</label>
                  <input id={fieldId(groupKey, 'umidadeInicial')} type="number" min="0" value={getString(data.umidadeInicial)} disabled={disabled} onChange={event => onChange({ umidadeInicial: event.target.value })} />
                </div>
                <div className="field-group">
                  <label htmlFor={fieldId(groupKey, 'umidadeFinal')}>Umidade final (ppm)</label>
                  <input id={fieldId(groupKey, 'umidadeFinal')} type="number" min="0" value={getString(data.umidadeFinal)} disabled={disabled} onChange={event => onChange({ umidadeFinal: event.target.value })} />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DrawingsObsBlock({ data, onChange, disabled, groupKey }: Pick<ServiceFieldsProps, 'data' | 'onChange' | 'disabled' | 'groupKey'>) {
  return (
    <>
      <div className="field-group">
        <label htmlFor={fieldId(groupKey, 'drawingsTags')}>Desenhos / TAGs</label>
        <input id={fieldId(groupKey, 'drawingsTags')} value={getString(data.drawingsTags)} disabled={disabled} onChange={event => onChange({ drawingsTags: event.target.value })} />
      </div>
      <div className="field-group">
        <label htmlFor={fieldId(groupKey, 'notes')}>Observações</label>
        <textarea
          id={fieldId(groupKey, 'notes')}
          rows={3}
          placeholder="Observações adicionais..."
          value={getString(data.notes)}
          disabled={disabled}
          onChange={event => onChange({ notes: event.target.value })}
        />
      </div>
    </>
  );
}

export function ServiceFields({
  serviceType,
  data,
  onChange,
  disabled,
  units,
  manometers,
  counters = [],
  equipments,
  rdoSlotMap,
  inhibitionOptions,
  groupKey,
  projectId,
  invalidKey,
  hideFinalization = false
}: ServiceFieldsProps) {
  const normalizedType = normalizeServiceType(serviceType);
  const slotOptions = (slotKey: string) => slotOptionsFrom(equipments, rdoSlotMap, slotKey);
  function upload(label: string) {
    return (
      <UploadField
        label={label}
        value={getGroup(data, label)}
        projectId={projectId}
        disabled={disabled}
        onChange={files => setGroup(data, onChange, label, files)}
      />
    );
  }

  if (normalizedType === 'limpeza') {
    const metodos = getStrings(data.metodos);
    const local = getStrings(data.local);
    const tipoInspecao = getStrings(data.tipoInspecao);
    const limpezaTubulacao = limpezaTubulacaoValue(data);

    return (
      <>
        <MaterialField data={data} onChange={onChange} disabled={disabled} invalidKey={invalidKey} groupKey={groupKey} />
        <div className={fieldClass(invalidKey, 'metodos')}>
          <label>Método de limpeza {requiredMark()}</label>
          <div className="rdo-check-grid">
            {['Circulação pressurizada', 'Pulverização', 'Enchimento e imersão'].map(m => (
              <label className="rdo-check-row" key={m}>
                <input type="checkbox" checked={metodos.includes(m)} disabled={disabled} onChange={e => onChange({ metodos: toggleItem(metodos, m, e.target.checked) })} />
                <span>{m}</span>
              </label>
            ))}
          </div>
        </div>
        <UnitMultiField groupKey={groupKey} label="Unidade de Limpeza Química" field="ulq" units={units} categories={['LIMPEZA_QUIMICA']} options={slotOptions('limpeza.ulq')} data={data} onChange={onChange} disabled={disabled} invalidKey={invalidKey} />
        <div className={fieldClass(invalidKey, 'local')}>
          <label>Local de limpeza {requiredMark()}</label>
          <div className="rdo-pill-list">
            {['Interna', 'Externa'].map(l => (
              <label className={pillOptionClass(local.includes(l))} key={l}>
                <input type="checkbox" checked={local.includes(l)} disabled={disabled} onChange={e => onChange({ local: toggleItem(local, l, e.target.checked) })} />
                <span>{l}</span>
              </label>
            ))}
          </div>
        </div>
        <div className={fieldClass(invalidKey, 'limpezaTubulacao')}>
          <label>Limpeza de tubulação? {requiredMark()}</label>
          <div className="rdo-tag-group">
            {['Sim', 'Não'].map(label => (
              <label className={radioOptionClass(limpezaTubulacao === label, label === 'Não')} key={label}>
                <input
                  type="radio"
                  name={`limpeza-tubulacao-${groupKey}`}
                  checked={limpezaTubulacao === label}
                  disabled={disabled}
                  onChange={() => onChange({ limpezaTubulacao: label, 'Limpeza de tubulação?': label })}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>
        {limpezaTubulacao === 'Sim' ? (
          <TubesBlock data={data} onChange={onChange} disabled={disabled} invalidKey={invalidKey} groupKey={groupKey} />
        ) : null}
        {hideFinalization ? null : (
          <FinalizadoAprovadoBlock data={data} onChange={onChange} disabled={disabled} groupKey={groupKey} invalidKey={invalidKey} />
        )}
        <EtapasSection serviceType={serviceType} data={data} onChange={onChange} disabled={disabled} invalidKey={invalidKey} />
        <div className={fieldClass(invalidKey, 'tipoInspecao')}>
          <label>Tipo de inspeção {requiredMark()}</label>
          <div className="rdo-pill-list">
            {['Visual', 'Corpo de prova', 'Vídeo boroscopia'].map(t => (
              <label className={pillOptionClass(tipoInspecao.includes(t))} key={t}>
                <input type="checkbox" checked={tipoInspecao.includes(t)} disabled={disabled} onChange={e => onChange({ tipoInspecao: toggleItem(tipoInspecao, t, e.target.checked) })} />
                <span>{t}</span>
              </label>
            ))}
          </div>
        </div>
        {upload('Imagens — corpo de prova')}
        {upload('Imagens — tubulação')}
        <DrawingsObsBlock data={data} onChange={onChange} disabled={disabled} groupKey={groupKey} />
      </>
    );
  }

  if (normalizedType === 'pressao') {
    const fluidoTeste = getString(data.fluidoTeste) || 'agua';
    const qualOleo = getString(data.qualOleo);
    const manometroIds = getStrings(data.manometroIds);
    const manometerSlotOptions = slotOptions('pressao.manometros');
    const activeManometers: Array<{ id: string; code: string }> = manometerSlotOptions
      ? manometerSlotOptions
      : manometers.filter(m => m.isActive);

    return (
      <>
        <MaterialField data={data} onChange={onChange} disabled={disabled} invalidKey={invalidKey} groupKey={groupKey} />
        <TubesBlock data={data} onChange={onChange} disabled={disabled} invalidKey={invalidKey} groupKey={groupKey} />
        {hideFinalization ? null : (
          <FinalizadoAprovadoBlock data={data} onChange={onChange} disabled={disabled} groupKey={groupKey} invalidKey={invalidKey} />
        )}
        <EtapasSection serviceType={serviceType} data={data} onChange={onChange} disabled={disabled} invalidKey={invalidKey} />
        <UnitMultiField groupKey={groupKey} label="Unidade de Teste Hidrostático (UTH)" field="uth" units={units} categories={['UTH']} options={slotOptions('pressao.uth')} data={data} onChange={onChange} disabled={disabled} invalidKey={invalidKey} />
        <PressureField data={data} onChange={onChange} disabled={disabled} invalidKey={invalidKey} groupKey={groupKey} field="pressaoTrabalho" unitField="pressaoTrabalhoUnit" label="Pressão de trabalho" />
        <PressureField data={data} onChange={onChange} disabled={disabled} invalidKey={invalidKey} groupKey={groupKey} field="pressaoTeste" unitField="pressaoTesteUnit" label="Pressão de teste" />
        <div className={fieldClass(invalidKey, 'manometroIds')}>
          <label>Fluido de teste</label>
          <div className="rdo-tag-group">
            {[['agua', 'Água'], ['oleo', 'Óleo']].map(([val, label]) => (
              <label className={radioOptionClass(fluidoTeste === val)} key={val}>
                <input type="radio" name={`fluido-${groupKey}`} checked={fluidoTeste === val} disabled={disabled} onChange={() => onChange({ fluidoTeste: val })} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>
        {fluidoTeste === 'oleo' ? (
          <div className="field-group">
            <label htmlFor={fieldId(groupKey, 'qualOleo')}>Qual óleo?</label>
            <input id={fieldId(groupKey, 'qualOleo')} value={qualOleo} placeholder="Especificar óleo..." disabled={disabled} onChange={e => onChange({ qualOleo: e.target.value })} />
          </div>
        ) : null}
        <div className="field-group">
          <label>Manômetros utilizados {requiredMark()}</label>
          <div className="rdo-check-grid">
            {activeManometers.map(m => (
              <label className="rdo-check-row" key={m.id}>
                <input type="checkbox" checked={manometroIds.includes(m.id)} disabled={disabled} onChange={e => onChange({ manometroIds: toggleItem(manometroIds, m.id, e.target.checked) })} />
                <span>{m.code}</span>
              </label>
            ))}
          </div>
        </div>
        {upload('Fotos do manômetro')}
        {upload('Fotos do sistema')}
        <DrawingsObsBlock data={data} onChange={onChange} disabled={disabled} groupKey={groupKey} />
      </>
    );
  }

  if (normalizedType === 'flushing') {
    const tipoFlushing = getString(data.tipoFlushing) || 'primario';
    const flushingTubulacao = flushingTubulacaoValue(data);
    const unitCategories: Unit['category'][] = tipoFlushing === 'secundario' ? ['FILTRAGEM'] : ['FLUSHING'];

    return (
      <>
        <div className={fieldClass(invalidKey, 'flushingTubulacao')}>
          <label>Flushing em tubulação? {requiredMark()}</label>
          <div className="rdo-tag-group">
            {['Sim', 'Não'].map(label => (
              <label className={radioOptionClass(flushingTubulacao === label, label === 'Não')} key={label}>
                <input
                  type="radio"
                  name={`flushing-tubulacao-${groupKey}`}
                  checked={flushingTubulacao === label}
                  disabled={disabled}
                  onChange={() => onChange({
                    flushingTubulacao: label,
                    'Flushing em tubulação?': label,
                    ...(label === 'Não' ? { tubes: [] } : {})
                  })}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>
        {flushingTubulacao === 'Sim' ? (
          <TubesBlock data={data} onChange={onChange} disabled={disabled} invalidKey={invalidKey} groupKey={groupKey} />
        ) : null}
        <div className={fieldClass(invalidKey, 'tipoOleo')}>
          <label htmlFor={fieldId(groupKey, 'tipoOleo')}>Tipo de óleo {requiredMark()}</label>
          <input id={fieldId(groupKey, 'tipoOleo')} value={getString(data.tipoOleo)} placeholder="Marca/modelo do óleo..." disabled={disabled} onChange={e => onChange({ tipoOleo: e.target.value })} />
        </div>
        <VolumeField data={data} onChange={onChange} disabled={disabled} invalidKey={invalidKey} groupKey={groupKey} />
        <div className={fieldClass(invalidKey, 'uf')}>
          <label>Tipo de flushing</label>
          <div className="rdo-tag-group">
            {[['primario', 'Primário'], ['secundario', 'Secundário']].map(([val, label]) => (
              <label className={radioOptionClass(tipoFlushing === val)} key={val}>
                <input type="radio" name={`flushing-tipo-${groupKey}`} checked={tipoFlushing === val} disabled={disabled} onChange={() => onChange({ tipoFlushing: val, uf: [''] })} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>
        <UnitMultiField groupKey={groupKey} label={tipoFlushing === 'secundario' ? 'Unidade de filtragem' : 'Unidade de Flushing'} field="uf" units={units} categories={unitCategories} options={slotOptions(tipoFlushing === 'secundario' ? 'flushing.secundario' : 'flushing.primario')} data={data} onChange={onChange} disabled={disabled} invalidKey={invalidKey} />
        {hideFinalization ? null : (
          <FinalizadoAprovadoBlock data={data} onChange={onChange} disabled={disabled} groupKey={groupKey} invalidKey={invalidKey} />
        )}
        <EtapasSection serviceType={serviceType} data={data} onChange={onChange} disabled={disabled} invalidKey={invalidKey} />
        <ParticulasBlock data={data} onChange={onChange} disabled={disabled} groupKey={groupKey} invalidKey={invalidKey} counters={counters} counterOptions={slotOptions('flushing.particulas')} upload={upload} />
        <DesidratacaoBlock data={data} onChange={onChange} disabled={disabled} groupKey={groupKey} units={units} unitOptions={slotOptions('flushing.desidratacao')} invalidKey={invalidKey} upload={upload} />
        <DrawingsObsBlock data={data} onChange={onChange} disabled={disabled} groupKey={groupKey} />
      </>
    );
  }

  if (normalizedType === 'filtragem') {
    return (
      <>
        <div className={fieldClass(invalidKey, 'tipoOleo')}>
          <label htmlFor={fieldId(groupKey, 'tipoOleo')}>Tipo de óleo {requiredMark()}</label>
          <input id={fieldId(groupKey, 'tipoOleo')} value={getString(data.tipoOleo)} placeholder="Marca/modelo do óleo..." disabled={disabled} onChange={e => onChange({ tipoOleo: e.target.value })} />
        </div>
        <VolumeField data={data} onChange={onChange} disabled={disabled} invalidKey={invalidKey} groupKey={groupKey} />
        <UnitMultiField groupKey={groupKey} label="Unidade de filtragem" field="ufg" units={units} categories={['FILTRAGEM']} options={slotOptions('filtragem.ufg')} data={data} onChange={onChange} disabled={disabled} invalidKey={invalidKey} />
        {hideFinalization ? null : (
          <FinalizadoAprovadoBlock data={data} onChange={onChange} disabled={disabled} groupKey={groupKey} invalidKey={invalidKey} />
        )}
        <EtapasSection serviceType={serviceType} data={data} onChange={onChange} disabled={disabled} invalidKey={invalidKey} />
        <ParticulasBlock data={data} onChange={onChange} disabled={disabled} groupKey={groupKey} invalidKey={invalidKey} counters={counters} counterOptions={slotOptions('filtragem.particulas')} upload={upload} />
        <DesidratacaoBlock data={data} onChange={onChange} disabled={disabled} groupKey={groupKey} units={units} unitOptions={slotOptions('filtragem.desidratacao')} invalidKey={invalidKey} upload={upload} />
        <DrawingsObsBlock data={data} onChange={onChange} disabled={disabled} groupKey={groupKey} />
      </>
    );
  }

  if (normalizedType === 'mecanica') {
    return (
      <>
        <MaterialField data={data} onChange={onChange} disabled={disabled} invalidKey={invalidKey} groupKey={groupKey} label="Material do equipamento" />
        {hideFinalization ? null : (
          <FinalizadoAprovadoBlock data={data} onChange={onChange} disabled={disabled} groupKey={groupKey} invalidKey={invalidKey} />
        )}
        <EtapasSection serviceType={serviceType} data={data} onChange={onChange} disabled={disabled} invalidKey={invalidKey} />
        {upload('Imagens da limpeza')}
        <DrawingsObsBlock data={data} onChange={onChange} disabled={disabled} groupKey={groupKey} />
      </>
    );
  }

  if (normalizedType === 'inibicao') {
    const tipoRelatorio = getStrings(data.tipoRelatorio);

    return (
      <>
        <div className={fieldClass(invalidKey, 'equipmentId')}>
          <label htmlFor={fieldId(groupKey, 'equipmentId')}>Embarcação {requiredMark()}</label>
          <select id={fieldId(groupKey, 'equipmentId')} value={getString(data.equipmentId)} disabled={disabled} onChange={event => onChange({ equipmentId: event.target.value })}>
            <option value="">Selecionar...</option>
            {(inhibitionOptions?.vessels || []).map(vessel => (
              <option value={vessel.code} key={vessel.id || vessel.code}>{vessel.code}</option>
            ))}
          </select>
        </div>
        <div className={fieldClass(invalidKey, 'system')}>
          <label htmlFor={fieldId(groupKey, 'system')}>Sistema {requiredMark()}</label>
          <select id={fieldId(groupKey, 'system')} value={getString(data.system)} disabled={disabled} onChange={event => onChange({ system: event.target.value })}>
            <option value="">Selecionar...</option>
            {(inhibitionOptions?.systems || []).map(system => {
              const value = inhibitionSystemValue(system);
              return <option value={value} key={system.id || system.code}>{value}</option>;
            })}
          </select>
        </div>
        <MaterialField data={data} onChange={onChange} disabled={disabled} invalidKey={invalidKey} groupKey={groupKey} />
        <div className="field-group">
          <label htmlFor={fieldId(groupKey, 'linhas')}>Linhas</label>
          <textarea id={fieldId(groupKey, 'linhas')} value={getString(data.linhas)} placeholder="Campo livre..." disabled={disabled} onChange={event => onChange({ linhas: event.target.value })} style={{ resize: 'vertical' }} />
        </div>
        <div className={fieldClass(invalidKey, 'steps')}>
          <label htmlFor={fieldId(groupKey, 'steps')}>Steps {requiredMark()}</label>
          <textarea id={fieldId(groupKey, 'steps')} value={getString(data.steps)} placeholder="Campo livre..." disabled={disabled} onChange={event => onChange({ steps: event.target.value })} style={{ resize: 'none' }} />
        </div>
        <div className="fg-r2 service-time-grid">
          <div className={fieldClass(invalidKey, 'startTime')}>
            <label htmlFor={fieldId(groupKey, 'startTime')}>Hora de início {requiredMark()}</label>
            <input
              id={fieldId(groupKey, 'startTime')}
              type="time"
              value={getString(data.startTime)}
              disabled={disabled}
              onChange={event => onChange({ startTime: event.target.value })}
            />
          </div>
          <div className={fieldClass(invalidKey, 'endTime')}>
            <label htmlFor={fieldId(groupKey, 'endTime')}>Hora de término/pausa {requiredMark()}</label>
            <input
              id={fieldId(groupKey, 'endTime')}
              type="time"
              value={getString(data.endTime)}
              disabled={disabled}
              onChange={event => onChange({ endTime: event.target.value })}
            />
          </div>
        </div>
        {hideFinalization ? null : (
          <FinalizadoAprovadoBlock data={data} onChange={onChange} disabled={disabled} groupKey={groupKey} invalidKey={invalidKey} />
        )}
        <EtapasSection serviceType={serviceType} data={data} onChange={onChange} disabled={disabled} invalidKey={invalidKey} />
        <div className={fieldClass(invalidKey, 'tipoRelatorio')}>
          <label>Tipo de relatório {requiredMark()}</label>
          <div className="rdo-pill-list">
            {['RLI', 'RLF'].map(tipo => (
              <label className={pillOptionClass(tipoRelatorio.includes(tipo))} key={tipo}>
                <input type="checkbox" checked={tipoRelatorio.includes(tipo)} disabled={disabled} onChange={event => onChange({ tipoRelatorio: toggleItem(tipoRelatorio, tipo, event.target.checked) })} />
                <span>{tipo}</span>
              </label>
            ))}
          </div>
        </div>
        {upload('Fotos do filtro')}
        {upload('Fotos das plaquetas')}
        <div className={`${fieldClass(invalidKey, 'notes')} fg-r2`}>
          <label htmlFor={fieldId(groupKey, 'notes')}>Observações</label>
          <textarea id={fieldId(groupKey, 'notes')} value={getString(data.notes)} disabled={disabled} onChange={event => onChange({ notes: event.target.value })} />
        </div>
      </>
    );
  }

  return null;
}
