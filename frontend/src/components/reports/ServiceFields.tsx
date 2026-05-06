import type { ReactNode } from 'react';
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
    'Drenagem do sistema', 'Desmontagem do sistema', 'Coleta de amostra'
  ]
};

type UploadGroup = { label: string; files: UploadedFile[] };
type TubeRow = { d: string; unit: string; c: string; lengthUnit: string };
export type ServiceCollaboratorOption = { id: string; name: string };

function getGroup(data: Record<string, unknown>, label: string): UploadedFile[] {
  const groups = Array.isArray(data.__uploads__) ? (data.__uploads__ as UploadGroup[]) : [];
  return groups.find(g => g.label === label)?.files ?? [];
}

function setGroup(
  data: Record<string, unknown>,
  onChange: (update: Record<string, unknown>) => void,
  label: string,
  files: UploadedFile[]
) {
  const groups = Array.isArray(data.__uploads__) ? (data.__uploads__ as UploadGroup[]) : [];
  const filtered = groups.filter(g => g.label !== label);
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

function getBool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
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

interface ServiceFieldsProps {
  serviceType: string;
  data: Record<string, unknown>;
  onChange: (update: Record<string, unknown>) => void;
  disabled?: boolean;
  units: Unit[];
  manometers: Manometer[];
  counters?: ParticleCounter[];
  collaboratorOptions?: ServiceCollaboratorOption[];
  groupKey: string;
  projectId?: string | null;
  invalidKey?: string | null;
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
  const selected = ['Aço carbono', 'Inox'].includes(material) ? material : material ? 'Outro' : '';
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
            <input
              id={fieldId(groupKey, 'diametro', index)}
              aria-label={`Diâmetro ${index + 1}`}
              inputMode="decimal"
              placeholder="Diâmetro"
              value={row.d || ''}
              disabled={disabled}
              onChange={event => onChange({ tubes: updateArrayItem(rows, index, { ...row, d: onlyNumberPunctuation(event.target.value) }) })}
            />
            <select
              id={fieldId(groupKey, 'diametro-unidade', index)}
              aria-label={`Unidade do diâmetro ${index + 1}`}
              value={row.unit || 'pol'}
              disabled={disabled}
              onChange={event => onChange({ tubes: updateArrayItem(rows, index, { ...row, unit: event.target.value }) })}
            >
              <option value="pol">pol</option>
              <option value="mm">mm</option>
            </select>
            <input
              id={fieldId(groupKey, 'comprimento', index)}
              aria-label={`Comprimento ${index + 1}`}
              inputMode="decimal"
              placeholder="Comprimento"
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
            <button
              className="danger-button"
              type="button"
              disabled={disabled || rows.length === 1}
              onClick={() => onChange({ tubes: rows.filter((_, rowIndex) => rowIndex !== index) })}
            >
              Remover
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
  required?: boolean;
}) {
  const selected = getStringList(data[field]);
  const options = units.filter(unit => categories.includes(unit.category));

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
              {options.map(unit => <option key={unit.id} value={unit.id}>{unit.code}</option>)}
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
  const finalized = getBool(data.finalized, false);
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

function ServiceCollaboratorsBlock({
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

function ParticulasBlock({ data, onChange, disabled, groupKey, invalidKey, counters = [], upload }: Pick<ServiceFieldsProps, 'data' | 'onChange' | 'disabled' | 'groupKey' | 'invalidKey' | 'counters'> & { upload: (label: string) => ReactNode }) {
  const enabled = getString(data.houveParticulas) === 'Sim';
  const contadorId = fieldId(groupKey, 'contadorUtilizado');
  const activeCounters = counters.filter(counter => counter.isActive !== false);

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

function DesidratacaoBlock({ data, onChange, disabled, groupKey, units, invalidKey, upload }: Pick<ServiceFieldsProps, 'data' | 'onChange' | 'disabled' | 'groupKey' | 'units' | 'invalidKey'> & { upload: (label: string) => ReactNode }) {
  const enabled = getString(data.houveDesidratacao) === 'Sim';
  const hasHumidity = getString(data.houveUmidade) === 'Sim';
  const desidratacaoUnits = units.filter(u => u.category === 'DESIDRATACAO');

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
  collaboratorOptions = [],
  groupKey,
  projectId,
  invalidKey
}: ServiceFieldsProps) {
  const normalizedType = normalizeServiceType(serviceType);
  const serviceCollaborators = (
    <ServiceCollaboratorsBlock
      data={data}
      onChange={onChange}
      disabled={disabled}
      invalidKey={invalidKey}
      collaboratorOptions={collaboratorOptions}
    />
  );

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
        <UnitMultiField groupKey={groupKey} label="Unidade de Limpeza Química" field="ulq" units={units} categories={['LIMPEZA_QUIMICA']} data={data} onChange={onChange} disabled={disabled} invalidKey={invalidKey} />
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
        <TubesBlock data={data} onChange={onChange} disabled={disabled} invalidKey={invalidKey} groupKey={groupKey} />
        <FinalizadoAprovadoBlock data={data} onChange={onChange} disabled={disabled} groupKey={groupKey} invalidKey={invalidKey} />
        {serviceCollaborators}
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
    const activeManometers = manometers.filter(m => m.isActive);

    return (
      <>
        <MaterialField data={data} onChange={onChange} disabled={disabled} invalidKey={invalidKey} groupKey={groupKey} />
        <TubesBlock data={data} onChange={onChange} disabled={disabled} invalidKey={invalidKey} groupKey={groupKey} />
        <FinalizadoAprovadoBlock data={data} onChange={onChange} disabled={disabled} groupKey={groupKey} invalidKey={invalidKey} />
        {serviceCollaborators}
        <EtapasSection serviceType={serviceType} data={data} onChange={onChange} disabled={disabled} invalidKey={invalidKey} />
        <UnitMultiField groupKey={groupKey} label="Unidade de Teste Hidrostático (UTH)" field="uth" units={units} categories={['UTH']} data={data} onChange={onChange} disabled={disabled} invalidKey={invalidKey} />
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
    const unitCategories: Unit['category'][] = tipoFlushing === 'secundario' ? ['FILTRAGEM'] : ['FLUSHING'];

    return (
      <>
        <MaterialField data={data} onChange={onChange} disabled={disabled} invalidKey={invalidKey} groupKey={groupKey} />
        <TubesBlock data={data} onChange={onChange} disabled={disabled} invalidKey={invalidKey} groupKey={groupKey} />
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
        <UnitMultiField groupKey={groupKey} label={tipoFlushing === 'secundario' ? 'Unidade de filtragem' : 'Unidade de Flushing'} field="uf" units={units} categories={unitCategories} data={data} onChange={onChange} disabled={disabled} invalidKey={invalidKey} />
        <FinalizadoAprovadoBlock data={data} onChange={onChange} disabled={disabled} groupKey={groupKey} invalidKey={invalidKey} />
        {serviceCollaborators}
        <EtapasSection serviceType={serviceType} data={data} onChange={onChange} disabled={disabled} invalidKey={invalidKey} />
        <ParticulasBlock data={data} onChange={onChange} disabled={disabled} groupKey={groupKey} invalidKey={invalidKey} counters={counters} upload={upload} />
        <DesidratacaoBlock data={data} onChange={onChange} disabled={disabled} groupKey={groupKey} units={units} invalidKey={invalidKey} upload={upload} />
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
        <UnitMultiField groupKey={groupKey} label="Unidade de filtragem" field="ufg" units={units} categories={['FILTRAGEM']} data={data} onChange={onChange} disabled={disabled} invalidKey={invalidKey} />
        <FinalizadoAprovadoBlock data={data} onChange={onChange} disabled={disabled} groupKey={groupKey} invalidKey={invalidKey} />
        {serviceCollaborators}
        <EtapasSection serviceType={serviceType} data={data} onChange={onChange} disabled={disabled} invalidKey={invalidKey} />
        <ParticulasBlock data={data} onChange={onChange} disabled={disabled} groupKey={groupKey} invalidKey={invalidKey} counters={counters} upload={upload} />
        <DesidratacaoBlock data={data} onChange={onChange} disabled={disabled} groupKey={groupKey} units={units} invalidKey={invalidKey} upload={upload} />
        <DrawingsObsBlock data={data} onChange={onChange} disabled={disabled} groupKey={groupKey} />
      </>
    );
  }

  if (normalizedType === 'mecanica') {
    return (
      <>
        <MaterialField data={data} onChange={onChange} disabled={disabled} invalidKey={invalidKey} groupKey={groupKey} label="Material do equipamento" />
        <FinalizadoAprovadoBlock data={data} onChange={onChange} disabled={disabled} groupKey={groupKey} invalidKey={invalidKey} />
        {serviceCollaborators}
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
        <div className={fieldClass(invalidKey, 'embarcacaoId')}>
          <label htmlFor={fieldId(groupKey, 'embarcacaoId')}>ID da embarcação</label>
          <select id={fieldId(groupKey, 'embarcacaoId')} value={getString(data.embarcacaoId)} disabled={disabled} onChange={event => onChange({ embarcacaoId: event.target.value })}>
            <option value="">Selecionar...</option>
            <option value="EMB-001">EMB-001 — Navio Cisterna Alpha</option>
            <option value="EMB-002">EMB-002 — Corveta Beta</option>
            <option value="EMB-003">EMB-003 — Fragata Gama</option>
          </select>
        </div>
        <div className={fieldClass(invalidKey, 'system')}>
          <label htmlFor={fieldId(groupKey, 'system')}>Sistema</label>
          <select id={fieldId(groupKey, 'system')} value={getString(data.system)} disabled={disabled} onChange={event => onChange({ system: event.target.value })}>
            <option value="">Selecionar...</option>
            <option value="Sistema de resfriamento">Sistema de resfriamento</option>
            <option value="Sistema de combustível">Sistema de combustível</option>
            <option value="Sistema hidráulico">Sistema hidráulico</option>
          </select>
        </div>
        <MaterialField data={data} onChange={onChange} disabled={disabled} invalidKey={invalidKey} groupKey={groupKey} />
        <div className="field-group">
          <label htmlFor={fieldId(groupKey, 'linhas')}>Linhas</label>
          <input id={fieldId(groupKey, 'linhas')} value={getString(data.linhas)} placeholder="Campo livre..." disabled={disabled} onChange={event => onChange({ linhas: event.target.value })} />
        </div>
        <div className="field-group">
          <label htmlFor={fieldId(groupKey, 'steps')}>Steps</label>
          <textarea id={fieldId(groupKey, 'steps')} value={getString(data.steps)} placeholder="Campo livre..." disabled={disabled} onChange={event => onChange({ steps: event.target.value })} />
        </div>
        <FinalizadoAprovadoBlock data={data} onChange={onChange} disabled={disabled} groupKey={groupKey} invalidKey={invalidKey} />
        {serviceCollaborators}
        <EtapasSection serviceType={serviceType} data={data} onChange={onChange} disabled={disabled} invalidKey={invalidKey} />
        <div className="field-group">
          <label>Tipo de relatório</label>
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
        <DrawingsObsBlock data={data} onChange={onChange} disabled={disabled} groupKey={groupKey} />
      </>
    );
  }

  return null;
}
