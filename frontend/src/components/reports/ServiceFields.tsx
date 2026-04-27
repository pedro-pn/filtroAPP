import type { Manometer, Unit } from '../../types/domain';
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

function getString(value: unknown): string {
  return typeof value === 'string' ? value : '';
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

interface ServiceFieldsProps {
  serviceType: string;
  data: Record<string, unknown>;
  onChange: (update: Record<string, unknown>) => void;
  disabled?: boolean;
  units: Unit[];
  manometers: Manometer[];
  groupKey: string;
  projectId?: string | null;
}

function EtapasSection({ serviceType, data, onChange, disabled }: Pick<ServiceFieldsProps, 'serviceType' | 'data' | 'onChange' | 'disabled'>) {
  const etapas = etapasPorTipo[serviceType] || etapasPorTipo[normalizeServiceType(serviceType).toUpperCase()];
  if (!etapas?.length) return null;
  const done = getStrings(data.etapas);

  return (
    <div className="field-group">
      <label>Etapas realizadas</label>
      <div className="rdo-check-grid">
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
      </div>
    </div>
  );
}

export function ServiceFields({ serviceType, data, onChange, disabled, units, manometers, groupKey, projectId }: ServiceFieldsProps) {
  const normalizedType = normalizeServiceType(serviceType);

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
    const ulq = getString(data.ulq);
    const limpezaUnits = units.filter(u => u.category === 'LIMPEZA_QUIMICA');

    return (
      <>
        <div className="field-group">
          <label>Método de limpeza</label>
          <div className="rdo-check-grid">
            {['Circulação pressurizada', 'Pulverização', 'Enchimento e imersão'].map(m => (
              <label className="rdo-check-row" key={m}>
                <input
                  type="checkbox"
                  checked={metodos.includes(m)}
                  disabled={disabled}
                  onChange={e => onChange({ metodos: toggleItem(metodos, m, e.target.checked) })}
                />
                <span>{m}</span>
              </label>
            ))}
          </div>
        </div>
        {limpezaUnits.length > 0 ? (
          <div className="field-group">
            <label>Unidade de Limpeza Química</label>
            <select value={ulq} disabled={disabled} onChange={e => onChange({ ulq: e.target.value })}>
              <option value="">Nenhuma</option>
              {limpezaUnits.map(u => <option key={u.id} value={u.id}>{u.code}</option>)}
            </select>
          </div>
        ) : null}
        <div className="field-group">
          <label>Local de limpeza</label>
          <div className="rdo-check-grid">
            {['Interna', 'Externa'].map(l => (
              <label className="rdo-check-row" key={l}>
                <input
                  type="checkbox"
                  checked={local.includes(l)}
                  disabled={disabled}
                  onChange={e => onChange({ local: toggleItem(local, l, e.target.checked) })}
                />
                <span>{l}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="field-group">
          <label>Tipo de inspeção</label>
          <div className="rdo-check-grid">
            {['Visual', 'Corpo de prova', 'Vídeo boroscopia'].map(t => (
              <label className="rdo-check-row" key={t}>
                <input
                  type="checkbox"
                  checked={tipoInspecao.includes(t)}
                  disabled={disabled}
                  onChange={e => onChange({ tipoInspecao: toggleItem(tipoInspecao, t, e.target.checked) })}
                />
                <span>{t}</span>
              </label>
            ))}
          </div>
        </div>
        <EtapasSection serviceType={serviceType} data={data} onChange={onChange} disabled={disabled} />
        {upload('Fotos do serviço')}
        {upload('Imagens — corpo de prova')}
        {upload('Imagens — tubulação')}
      </>
    );
  }

  if (normalizedType === 'pressao') {
    const pressaoTrabalho = getString(data.pressaoTrabalho);
    const pressaoTeste = getString(data.pressaoTeste);
    const fluidoTeste = getString(data.fluidoTeste) || 'agua';
    const qualOleo = getString(data.qualOleo);
    const manometroIds = getStrings(data.manometroIds);
    const activeManometers = manometers.filter(m => m.isActive);
    const uthUnits = units.filter(u => u.category === 'UTH');
    const uth = getString(data.uth);

    return (
      <>
        <div className="field-group">
          <label>Pressão de trabalho</label>
          <input value={pressaoTrabalho} placeholder="ex: 10 bar" disabled={disabled} onChange={e => onChange({ pressaoTrabalho: e.target.value })} />
        </div>
        <div className="field-group">
          <label>Pressão de teste</label>
          <input value={pressaoTeste} placeholder="ex: 15 bar" disabled={disabled} onChange={e => onChange({ pressaoTeste: e.target.value })} />
        </div>
        <div className="field-group">
          <label>Fluido de teste</label>
          <div className="rdo-check-grid">
            {[['agua', 'Água'], ['oleo', 'Óleo']].map(([val, label]) => (
              <label className="rdo-check-row" key={val}>
                <input
                  type="radio"
                  name={`fluido-${groupKey}`}
                  checked={fluidoTeste === val}
                  disabled={disabled}
                  onChange={() => onChange({ fluidoTeste: val })}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>
        {fluidoTeste === 'oleo' ? (
          <div className="field-group">
            <label>Qual óleo?</label>
            <input value={qualOleo} placeholder="Especificar óleo..." disabled={disabled} onChange={e => onChange({ qualOleo: e.target.value })} />
          </div>
        ) : null}
        {uthUnits.length > 0 ? (
          <div className="field-group">
            <label>Unidade de Teste Hidrostático (UTH)</label>
            <select value={uth} disabled={disabled} onChange={e => onChange({ uth: e.target.value })}>
              <option value="">Nenhuma</option>
              {uthUnits.map(u => <option key={u.id} value={u.id}>{u.code}</option>)}
            </select>
          </div>
        ) : null}
        {activeManometers.length > 0 ? (
          <div className="field-group">
            <label>Manômetros utilizados</label>
            <div className="rdo-check-grid">
              {activeManometers.map(m => (
                <label className="rdo-check-row" key={m.id}>
                  <input
                    type="checkbox"
                    checked={manometroIds.includes(m.id)}
                    disabled={disabled}
                    onChange={e => onChange({ manometroIds: toggleItem(manometroIds, m.id, e.target.checked) })}
                  />
                  <span>{m.code}</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}
        <EtapasSection serviceType={serviceType} data={data} onChange={onChange} disabled={disabled} />
        {upload('Fotos do manômetro')}
        {upload('Fotos do sistema')}
      </>
    );
  }

  if (normalizedType === 'flushing') {
    const tipoOleo = getString(data.tipoOleo);
    const volumeOleo = getString(data.volumeOleo);
    const tipoFlushing = getString(data.tipoFlushing) || 'primario';
    const uf = getString(data.uf);
    const flushingUnits = units.filter(u => u.category === 'FLUSHING');

    return (
      <>
        <div className="field-group">
          <label>Tipo de óleo</label>
          <input value={tipoOleo} placeholder="Marca/modelo do óleo..." disabled={disabled} onChange={e => onChange({ tipoOleo: e.target.value })} />
        </div>
        <div className="field-group">
          <label>Volume de óleo</label>
          <input value={volumeOleo} placeholder="ex: 200 L" disabled={disabled} onChange={e => onChange({ volumeOleo: e.target.value })} />
        </div>
        <div className="field-group">
          <label>Tipo de flushing</label>
          <div className="rdo-check-grid">
            {[['primario', 'Primário'], ['secundario', 'Secundário']].map(([val, label]) => (
              <label className="rdo-check-row" key={val}>
                <input
                  type="radio"
                  name={`flushing-tipo-${groupKey}`}
                  checked={tipoFlushing === val}
                  disabled={disabled}
                  onChange={() => onChange({ tipoFlushing: val })}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>
        {flushingUnits.length > 0 ? (
          <div className="field-group">
            <label>Unidade de Flushing</label>
            <select value={uf} disabled={disabled} onChange={e => onChange({ uf: e.target.value })}>
              <option value="">Nenhuma</option>
              {flushingUnits.map(u => <option key={u.id} value={u.id}>{u.code}</option>)}
            </select>
          </div>
        ) : null}
        <EtapasSection serviceType={serviceType} data={data} onChange={onChange} disabled={disabled} />
        {upload('Fotos do serviço')}
      </>
    );
  }

  if (normalizedType === 'filtragem') {
    const tipoOleo = getString(data.tipoOleo);
    const volumeOleo = getString(data.volumeOleo);
    const ufg = getString(data.ufg);
    const filtragemUnits = units.filter(u => u.category === 'FILTRAGEM');

    return (
      <>
        <div className="field-group">
          <label>Tipo de óleo</label>
          <input value={tipoOleo} placeholder="Marca/modelo do óleo..." disabled={disabled} onChange={e => onChange({ tipoOleo: e.target.value })} />
        </div>
        <div className="field-group">
          <label>Volume de óleo</label>
          <input value={volumeOleo} placeholder="ex: 200 L" disabled={disabled} onChange={e => onChange({ volumeOleo: e.target.value })} />
        </div>
        {filtragemUnits.length > 0 ? (
          <div className="field-group">
            <label>Unidade de filtragem</label>
            <select value={ufg} disabled={disabled} onChange={e => onChange({ ufg: e.target.value })}>
              <option value="">Nenhuma</option>
              {filtragemUnits.map(u => <option key={u.id} value={u.id}>{u.code}</option>)}
            </select>
          </div>
        ) : null}
        <EtapasSection serviceType={serviceType} data={data} onChange={onChange} disabled={disabled} />
        {upload('Fotos do serviço')}
      </>
    );
  }

  if (normalizedType === 'mecanica') {
    return (
      <>
        <EtapasSection serviceType={serviceType} data={data} onChange={onChange} disabled={disabled} />
        {upload('Imagens da limpeza')}
      </>
    );
  }

  if (normalizedType === 'inibicao') {
    return (
      <>
        <EtapasSection serviceType={serviceType} data={data} onChange={onChange} disabled={disabled} />
        {upload('Fotos do serviço')}
      </>
    );
  }

  return null;
}
