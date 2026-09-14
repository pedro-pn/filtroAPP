import { forwardRef, type ReactNode, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getPlannedScope,
  setPlannedScope,
  type PlannedDiameterUnit,
  type PlannedMeasureUnit,
  type PlannedScope,
  type PlannedSystemType
} from '../../api/acompanhamentoComercial';
import { listJobRoles } from '../../api/jobRoles';
import { HelpTip } from '../ui/HelpTip';
import { ProjectSystemInput } from './ProjectSystemInput';
import { ProjectSystemAliases } from './ProjectSystemAliases';
import { useToast } from '../ui/ToastContext';

// Tipos de serviço conhecidos (alinhados ao backend) + rótulos exibidos.
const SERVICE_TYPES: Array<{ value: string; label: string }> = [
  { value: 'LIMPEZA_QUIMICA', label: 'Limpeza química' },
  { value: 'TESTE_PRESSAO', label: 'Teste de pressão' },
  { value: 'FLUSHING', label: 'Flushing' },
  { value: 'FILTRAGEM', label: 'Filtragem' }
];

const SYSTEM_LABELS: Record<PlannedSystemType, string> = {
  TUBULACAO: 'Tubulações',
  OLEO: 'Óleo',
  SISTEMA: 'Sistemas completos (unidades)'
};

// Unidade única de cada sistema — escolhida para casar com o que o RDO registra como realizado:
// tubulação por comprimento (m), óleo por volume (L) e limpeza de sistemas completos por unidades.
const SYSTEM_UNIT: Record<PlannedSystemType, PlannedMeasureUnit> = {
  TUBULACAO: 'M',
  OLEO: 'L',
  SISTEMA: 'UN'
};
const UNIT_LABELS: Record<PlannedMeasureUnit, string> = { M: 'm', KG: 'kg', T: 't', UN: 'un', L: 'L' };
const DIAMETER_UNIT_LABELS: Record<PlannedDiameterUnit, string> = { pol: 'pol', mm: 'mm' };
const COMMON_INCH_DIAMETERS = [
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

// Tipos de sistema permitidos por serviço (alinhados ao que cada serviço registra no RDO).
const SERVICE_SYSTEMS: Record<string, PlannedSystemType[]> = {
  LIMPEZA_QUIMICA: ['TUBULACAO', 'SISTEMA'],
  TESTE_PRESSAO: ['TUBULACAO'],
  FLUSHING: ['TUBULACAO', 'OLEO'],
  FILTRAGEM: ['OLEO']
};
const ALL_SYSTEMS: PlannedSystemType[] = ['TUBULACAO', 'OLEO'];

const allowedSystems = (serviceType: string) => SERVICE_SYSTEMS[serviceType] ?? ALL_SYSTEMS;

// Linhas locais usam string nos campos numéricos (inputs controlados); convertem no salvar.
// A unidade é derivada do systemType (SYSTEM_UNIT), não editável.
interface SystemRow {
  key: string;
  projectSystemId: string | null;
  equipment: string;
  systemName: string;
  systemType: PlannedSystemType;
  description: string;
  diameter: string;
  diameterUnit: PlannedDiameterUnit;
  quantity: string;
}
interface ServiceRow {
  key: string;
  serviceType: string;
  weight: string;
  systems: SystemRow[];
}
interface HoursRow {
  key: string;
  jobRoleId: string;
  hours: string;
}

let keySeq = 0;
const nextKey = () => `r${++keySeq}`;
const toStr = (v?: string | number | null) => (v === null || v === undefined ? '' : String(v));
const toNum = (v: string) => {
  if (v.trim() === '') return null;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const toDiameterUnit = (v?: PlannedDiameterUnit | null): PlannedDiameterUnit => (v === 'mm' ? 'mm' : 'pol');
// Distribui inteiros somando exatamente `total`, proporcionais a `weights` (maior resto).
function roundToSum(weights: number[], total: number): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((s, w) => s + w, 0);
  const raw = sum > 0 ? weights.map(w => (w / sum) * total) : weights.map(() => total / weights.length);
  const out = raw.map(v => Math.floor(v));
  let rem = total - out.reduce((s, v) => s + v, 0);
  const order = raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < order.length && rem > 0; k++) { out[order[k].i] += 1; rem -= 1; }
  return out;
}

// Aplica pesos (inteiros, somando 100%) a uma lista de serviços mantendo a proporção atual.
function withWeights(services: ServiceRow[], ints: number[]): ServiceRow[] {
  return services.map((s, i) => ({ ...s, weight: String(ints[i]) }));
}

// Reequilíbrio "inteligente": os serviços que o usuário JÁ editou (touched) ficam fixos; só os
// não editados dividem igualmente o que sobra para o total tentar fechar 100%. Assim dá para
// digitar cada um manualmente — quando todos estão fixos, nada é mexido (a soma guia via aviso).
function rebalanceUntouched(services: ServiceRow[], touched: Set<string>): ServiceRow[] {
  const untouched = services.filter(s => !touched.has(s.key));
  if (untouched.length === 0) return services;
  const touchedSum = services
    .filter(s => touched.has(s.key))
    .reduce((sum, s) => sum + (toNum(s.weight) ?? 0), 0);
  const ints = roundToSum(untouched.map(() => 1), Math.max(0, 100 - touchedSum));
  let ui = 0;
  return services.map(s => (touched.has(s.key) ? s : { ...s, weight: String(ints[ui++]) }));
}

// Reequilibra os pesos para somar 100% mantendo a proporção (fallback: igualitário). Usado só ao
// carregar (normaliza dados antigos).
function rescaleTo100(services: ServiceRow[]): ServiceRow[] {
  if (services.length === 0) return services;
  const vals = services.map(s => toNum(s.weight) ?? 0);
  const base = vals.some(v => v > 0) ? vals : services.map(() => 1);
  return withWeights(services, roundToSum(base, 100));
}

function fromScope(scope: PlannedScope): { services: ServiceRow[]; normalHours: HoursRow[]; overtime: HoursRow[] } {
  const services = scope.services.map(s => {
    const serviceType = s.serviceType || 'LIMPEZA_QUIMICA';
    const allowed = allowedSystems(serviceType);
    return {
      key: nextKey(),
      serviceType,
      weight: s.weight === null || s.weight === undefined ? '' : toStr(s.weight),
      systems: (s.systems ?? [])
        .filter(sys => allowed.includes(sys.systemType))
        .map(sys => ({
          key: nextKey(),
          projectSystemId: sys.projectSystemId || null,
          equipment: toStr(sys.equipment), systemName: toStr(sys.systemName),
          systemType: sys.systemType,
          description: toStr(sys.description),
          diameter: sys.systemType === 'TUBULACAO' ? toStr(sys.diameter) : '',
          diameterUnit: toDiameterUnit(sys.diameterUnit),
          quantity: toStr(sys.quantity)
        }))
    };
  });
  return {
    services: rescaleTo100(services), // garante soma 100% (corrige dados antigos)
    normalHours: (scope.normalHours ?? []).map(o => ({
      key: nextKey(),
      jobRoleId: o.jobRoleId || '',
      hours: toStr(o.hours)
    })),
    overtime: (scope.overtime ?? []).map(o => ({
      key: nextKey(),
      jobRoleId: o.jobRoleId || '',
      hours: toStr(o.hours)
    }))
  };
}

function normalize(services: ServiceRow[], normalHours: HoursRow[], overtime: HoursRow[]) {
  return JSON.stringify({
    services: services.map(s => ({
      serviceType: s.serviceType,
      weight: s.weight,
      systems: s.systems.map(sys => ({
        projectSystemId: sys.projectSystemId, equipment: sys.equipment.trim(), systemName: sys.systemName.trim(),
        systemType: sys.systemType,
        description: sys.description.trim(),
        diameter: sys.systemType === 'TUBULACAO' ? sys.diameter.trim() : '',
        diameterUnit: sys.systemType === 'TUBULACAO' ? sys.diameterUnit : null,
        quantity: sys.quantity
      }))
    })),
    normalHours: normalHours.map(o => ({ jobRoleId: o.jobRoleId, hours: o.hours })),
    overtime: overtime.map(o => ({ jobRoleId: o.jobRoleId, hours: o.hours }))
  });
}

export interface ScopeEditorHandle { save: () => void }

// Editor do escopo previsto (vendido): serviços com seus sistemas + previsão de horas.
// Preenchimento manual — esses dados ainda não vêm do banco comercial. Sem botão próprio de salvar:
// expõe save() via ref e reporta dirty; o modal do cronograma tem o único Salvar/Cancelar.
export const ProjectPlannedScopeEditor = forwardRef<ScopeEditorHandle, {
  projectId: string;
  onDirtyChange?: (dirty: boolean) => void;
  beforeOvertime?: ReactNode;
}>(function ProjectPlannedScopeEditor({ projectId, onDirtyChange, beforeOvertime }, ref) {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const queryKey = ['planned-scope', projectId];

  const { data, isLoading } = useQuery({ queryKey, queryFn: () => getPlannedScope(projectId) });
  const { data: roles } = useQuery({ queryKey: ['job-roles'], queryFn: () => listJobRoles() });

  const [services, setServices] = useState<ServiceRow[]>([]);
  const [normalHours, setNormalHours] = useState<HoursRow[]>([]);
  const [overtime, setOvertime] = useState<HoursRow[]>([]);
  const [baseline, setBaseline] = useState('');
  // Serviços cujo peso o usuário já editou manualmente (ficam fixos no reequilíbrio).
  const touchedWeights = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!data) return;
    const next = fromScope(data);
    setServices(next.services);
    setNormalHours(next.normalHours);
    setOvertime(next.overtime);
    setBaseline(normalize(next.services, next.normalHours, next.overtime));
    // Dados carregados já têm pesos definidos: trata como fixos (edição livre, sem "brigar").
    touchedWeights.current = new Set(next.services.map(s => s.key));
  }, [data]);

  const dirty = useMemo(() => normalize(services, normalHours, overtime) !== baseline, [services, normalHours, overtime, baseline]);

  // Handle estável que sempre chama o save mais recente (só quando há mudança).
  const runSave = useRef<() => void>(() => {});
  runSave.current = () => { if (dirty) save(); };
  useImperativeHandle(ref, () => ({ save: () => runSave.current() }), []);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const mutation = useMutation({
    mutationFn: (payload: PlannedScope) => setPlannedScope(projectId, payload),
    onSuccess: (saved) => {
      showToast('Escopo previsto salvo.');
      queryClient.setQueryData(queryKey, saved);
      queryClient.invalidateQueries({ queryKey: ['commercial-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['project-cards'] });
      queryClient.invalidateQueries({ queryKey: ['project-detail', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project-progress', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project-systems'] });
    },
    onError: (error: Error) => showToast(error.message || 'Não foi possível salvar o escopo previsto.')
  });

  function save() {
    if (services.some(service => service.systems.some(row => row.systemType === 'SISTEMA' && (
      !row.equipment.trim() || !row.systemName.trim() || !Number.isSafeInteger(toNum(row.quantity)) || (toNum(row.quantity) ?? 0) <= 0
    )))) {
      showToast('Sistemas por unidade exigem equipamento/UG, nome do sistema e quantidade inteira positiva.');
      return;
    }
    const payload: PlannedScope = {
      services: services.map(s => ({
        serviceType: s.serviceType,
        weight: toNum(s.weight) ?? 0,
        systems: s.systems.map(sys => ({
          projectSystemId: sys.projectSystemId, equipment: sys.equipment.trim() || null, systemName: sys.systemName.trim() || null,
          systemType: sys.systemType,
          description: sys.description.trim() || null,
          diameter: sys.systemType === 'TUBULACAO' ? (sys.diameter.trim() || null) : null,
          diameterUnit: sys.systemType === 'TUBULACAO' ? sys.diameterUnit : null,
          quantity: toNum(sys.quantity),
          unit: SYSTEM_UNIT[sys.systemType]
        }))
      })),
      normalHours: normalHours
        .filter(o => o.jobRoleId || toNum(o.hours))
        .map(o => ({
          jobRoleId: o.jobRoleId || null,
          hours: toNum(o.hours) ?? 0
        })),
      overtime: overtime
        .filter(o => o.jobRoleId || toNum(o.hours))
        .map(o => ({
          jobRoleId: o.jobRoleId || null,
          hours: toNum(o.hours) ?? 0
        }))
    };
    mutation.mutate(payload);
  }

  // Edita o peso: o campo mexido vira "fixo" e só os NÃO editados absorvem o que falta p/ 100%.
  // Assim dá para digitar os 3 manualmente (ex.: 10, 30, 60) sem o app mexer nos já preenchidos.
  function changeWeight(key: string, raw: string) {
    const parsed = toNum(raw);
    const value = parsed === null ? raw : parsed > 100 ? '100' : parsed < 0 ? '0' : raw; // trava 0–100
    touchedWeights.current.add(key);
    setServices(prev => rebalanceUntouched(
      prev.map(s => (s.key === key ? { ...s, weight: value } : s)),
      touchedWeights.current
    ));
  }

  // Adiciona um serviço (não editado): os não editados dividem igualmente o que sobra dos fixos.
  // Sem nenhum fixo, dá a divisão igual clássica (1→100, 2→50/50, 3→34/33/33…).
  function addService() {
    setServices(prev => rebalanceUntouched(
      [...prev, { key: nextKey(), serviceType: 'LIMPEZA_QUIMICA', weight: '', systems: [] } as ServiceRow],
      touchedWeights.current
    ));
  }

  // Remove um serviço e deixa os não editados reabsorverem o que sobra.
  function removeService(key: string) {
    touchedWeights.current.delete(key);
    setServices(prev => rebalanceUntouched(prev.filter(s => s.key !== key), touchedWeights.current));
  }

  // Troca o serviço: descarta sistemas não permitidos pelo novo tipo.
  function changeServiceType(key: string, serviceType: string) {
    const allowed = allowedSystems(serviceType);
    setServices(prev => prev.map(s => (
      s.key === key ? { ...s, serviceType, systems: s.systems.filter(sys => allowed.includes(sys.systemType)) } : s
    )));
  }

  function addSystem(serviceKey: string) {
    setServices(prev => prev.map(s => {
      if (s.key !== serviceKey) return s;
      const used = new Set(s.systems.map(sys => sys.systemType));
      const next = allowedSystems(s.serviceType).find(t => !used.has(t)) ?? allowedSystems(s.serviceType)[0];
      return {
        ...s,
        systems: [
          ...s.systems,
          { key: nextKey(), projectSystemId: null, equipment: s.systems.at(-1)?.equipment || '', systemName: '', systemType: next, description: '', diameter: '', diameterUnit: 'pol', quantity: '' }
        ]
      };
    }));
  }

  function changeSystemType(serviceKey: string, sysKey: string, systemType: PlannedSystemType) {
    setServices(prev => prev.map(s => (
      s.key === serviceKey
        ? {
            ...s,
            systems: s.systems.map(sys => (
              sys.key === sysKey
                ? {
                    ...sys,
                    systemType,
                    quantity: sys.systemType === systemType ? sys.quantity : '',
                    diameter: systemType === 'TUBULACAO' ? sys.diameter : '',
                    diameterUnit: systemType === 'TUBULACAO' && sys.diameterUnit === 'mm' ? 'mm' : 'pol'
                  }
                : sys
            ))
          }
        : s
    )));
  }

  function changeSystem(serviceKey: string, sysKey: string, patch: Partial<SystemRow>) {
    setServices(prev => prev.map(s => (
      s.key === serviceKey
        ? { ...s, systems: s.systems.map(sys => (sys.key === sysKey ? { ...sys, ...patch } : sys)) }
        : s
    )));
  }

  function removeSystem(serviceKey: string, sysKey: string) {
    setServices(prev => prev.map(s => (
      s.key === serviceKey ? { ...s, systems: s.systems.filter(sys => sys.key !== sysKey) } : s
    )));
  }

  if (isLoading) return <div className="placeholder-copy">Carregando escopo…</div>;

  const weightSum = services.reduce((sum, s) => sum + (toNum(s.weight) ?? 0), 0);

  return (
    <div className="acp-scope">
      <div className="sec" style={{ marginTop: 4 }}>Serviços previstos (vendido)</div>
      <p className="placeholder-copy" style={{ margin: '2px 0 8px' }}>
        Preenchimento manual — para cada serviço, adicione os sistemas vendidos e seus quantitativos.
      </p>

      {services.length === 0 ? (
        <div className="placeholder-copy">Nenhum serviço previsto.</div>
      ) : (
        <div className="acp-svc-list">
          {services.map(svc => (
            <div className="acp-svc-card" key={svc.key}>
              <div className="acp-svc-head">
                <div className="field-group acp-svc-type-fg">
                  <label>Serviço <HelpTip icon help="Tipo de serviço vendido nesta obra (limpeza química, teste de pressão, flushing, filtragem)." /></label>
                  <select value={svc.serviceType} onChange={e => changeServiceType(svc.key, e.target.value)}>
                    {SERVICE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div className="field-group acp-svc-weight-fg">
                  <label htmlFor={`scope-weight-${svc.key}`}>Peso <HelpTip icon help="Quanto este serviço representa do avanço da obra (%). Ao adicionar serviços, eles dividem 100% igualmente. Quando você digita um valor, ele fica fixo e só os que você ainda não mexeu se ajustam — assim dá para definir os três manualmente (ex.: 10, 30, 60). O ideal é somar 100%." /></label>
                  <div className="acp-pct-field">
                    <input
                      id={`scope-weight-${svc.key}`}
                      type="number" min="0" max="100" step="1" inputMode="numeric" placeholder="0"
                      value={svc.weight}
                      onChange={e => changeWeight(svc.key, e.target.value)}
                    />
                    <span className="acp-pct-suffix">%</span>
                  </div>
                </div>
                <button type="button" className="mini-btn alt" onClick={() => removeService(svc.key)}>
                  Remover serviço
                </button>
              </div>

              {svc.systems.length === 0 ? (
                <div className="placeholder-copy" style={{ margin: '4px 0' }}>Nenhum sistema adicionado.</div>
              ) : (
                <div className="acp-sys-list">
                  {svc.systems.map(sys => {
                    const isTube = sys.systemType === 'TUBULACAO';
                    const inchDiameters = sys.diameter && !COMMON_INCH_DIAMETERS.includes(sys.diameter)
                      ? [sys.diameter, ...COMMON_INCH_DIAMETERS]
                      : COMMON_INCH_DIAMETERS;
                    return (
                      <div key={sys.key}>
                      <div className="acp-system-identity" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, padding: '8px 0' }}>
                        {(['equipmentId', 'system'] as const).map(field => <div className="field-group" key={field}>
                          <label>{field === 'equipmentId' ? 'Equipamento do cliente / UG' : 'Sistema do cliente'}</label>
                          <ProjectSystemInput projectId={projectId} source="scope" field={field}
                            data={{ equipmentId: sys.equipment, system: sys.systemName, __projectSystemId: sys.projectSystemId }}
                            suggestions={services.flatMap(s => s.systems).filter(row => row.equipment && row.systemName).map(row => ({ id: row.projectSystemId || '', projectId, equipment: row.equipment, name: row.systemName, revision: 1 }))}
                            onChange={patch => changeSystem(svc.key, sys.key, {
                              ...(typeof patch.equipmentId === 'string' ? { equipment: patch.equipmentId } : {}),
                              ...(typeof patch.system === 'string' ? { systemName: patch.system } : {}),
                              projectSystemId: typeof patch.__projectSystemId === 'string' ? patch.__projectSystemId : null
                            })} />
                        </div>)}
                      </div>
                      <div className={`acp-sys-row ${isTube ? 'tube' : 'oil'}`}>
                        <div className="field-group">
                          <label>Tipo de medição <HelpTip icon help="Tubulação em metros, óleo em litros ou limpeza de sistemas completos em unidades." /></label>
                          <select
                            value={sys.systemType}
                            onChange={e => changeSystemType(svc.key, sys.key, e.target.value as PlannedSystemType)}
                          >
                            {allowedSystems(svc.serviceType).map(t => <option key={t} value={t}>{SYSTEM_LABELS[t]}</option>)}
                          </select>
                        </div>
                        <div className="field-group acp-sys-desc">
                          <label>Detalhes / trecho (opcional)</label>
                          <input
                            type="text"
                            maxLength={180}
                            value={sys.description}
                            onChange={e => changeSystem(svc.key, sys.key, { description: e.target.value })}
                          />
                        </div>
                        {isTube ? (
                          <div className="field-group acp-sys-diameter">
                            <label htmlFor={`scope-diameter-${sys.key}`}>Diâmetro <HelpTip icon help="Mesmo padrão do RDO: polegadas por seleção comum ou milímetros digitados." /></label>
                            <div className="num-unit acp-diameter-field">
                              {sys.diameterUnit === 'pol' ? (
                                <select
                                  id={`scope-diameter-${sys.key}`}
                                  value={sys.diameter}
                                  onChange={e => changeSystem(svc.key, sys.key, { diameter: e.target.value })}
                                  aria-label="Diâmetro em polegadas"
                                >
                                  <option value="">—</option>
                                  {inchDiameters.map(value => <option key={value} value={value}>{value}</option>)}
                                </select>
                              ) : (
                                <input
                                  id={`scope-diameter-${sys.key}`}
                                  type="number"
                                  min="0"
                                  step="any"
                                  inputMode="decimal"
                                  placeholder="0"
                                  value={sys.diameter}
                                  onChange={e => changeSystem(svc.key, sys.key, { diameter: e.target.value })}
                                />
                              )}
                              <select
                                value={sys.diameterUnit}
                                onChange={e => changeSystem(svc.key, sys.key, { diameterUnit: e.target.value as PlannedDiameterUnit, diameter: '' })}
                                aria-label="Unidade do diâmetro"
                              >
                                {Object.entries(DIAMETER_UNIT_LABELS).map(([value, label]) => (
                                  <option key={value} value={value}>{label}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        ) : null}
                        <div className="field-group">
                          <label htmlFor={`scope-quantity-${sys.key}`}>
                            {isTube ? 'Comprimento (m)' : sys.systemType === 'SISTEMA' ? 'Quantidade prevista (unidades)' : 'Litros de óleo (L)'} <HelpTip icon help="Quantitativo vendido/previsto deste sistema. É o denominador do avanço (realizado ÷ previsto)." />
                          </label>
                          <div className="num-unit">
                            <input
                              id={`scope-quantity-${sys.key}`}
                              type="number" min={sys.systemType === 'SISTEMA' ? '1' : '0'} step={sys.systemType === 'SISTEMA' ? '1' : 'any'} inputMode={sys.systemType === 'SISTEMA' ? 'numeric' : 'decimal'} placeholder="0"
                              value={sys.quantity}
                              onChange={e => changeSystem(svc.key, sys.key, { quantity: e.target.value })}
                            />
                            <span className="acp-unit-tag">{UNIT_LABELS[SYSTEM_UNIT[sys.systemType]]}</span>
                          </div>
                        </div>
                        <button type="button" className="mini-btn alt acp-sys-del" onClick={() => removeSystem(svc.key, sys.key)} aria-label="Remover sistema">✕</button>
                      </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <button type="button" className="mini-btn alt acp-add-sys" onClick={() => addSystem(svc.key)}>
                + Adicionar sistema
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        className="mini-btn"
        style={{ marginTop: 8 }}
        onClick={addService}
      >
        + Adicionar serviço
      </button>
      {services.length > 0 ? (
        <div className={`acp-weight-sum ${Math.round(weightSum) === 100 ? 'ok' : 'warn'}`}>
          Soma dos pesos: {weightSum.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
          {Math.round(weightSum) !== 100 ? ' — o ideal é somar 100%' : ''}
        </div>
      ) : null}

      <p className="placeholder-copy">Preencha uma linha por equipamento/UG, sistema e bitola. Deixe os dois nomes vazios somente para uma meta global. Não repita um total agrupado em cada UG.</p>
      <ProjectSystemAliases projectId={projectId} />
      {beforeOvertime}

      <div className="sec" style={{ marginTop: 18 }}>Previsão de horas normais</div>
      <p className="placeholder-copy" style={{ margin: '2px 0 8px' }}>
        Informe o total de horas normais previstas. O valor já deve incluir todos os colaboradores; se houver mais de uma linha, elas são somadas.
      </p>

      {normalHours.length === 0 ? (
        <div className="placeholder-copy">Nenhuma hora normal prevista.</div>
      ) : (
        <div className="acp-ot-list">
          {normalHours.map(row => (
            <div className="acp-ot-row" key={row.key}>
              <div className="field-group acp-ot-role">
                <label>Cargo (opcional) <HelpTip icon help="Use apenas se quiser quebrar o total previsto por cargo. O cálculo soma todas as linhas." /></label>
                <select value={row.jobRoleId} onChange={e => updateRow(setNormalHours, row.key, { jobRoleId: e.target.value })}>
                  <option value="">— selecione —</option>
                  {(roles ?? []).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div className="field-group">
                <label htmlFor={`scope-normal-hours-${row.key}`}>Horas previstas <HelpTip icon help="Total de horas normais previstas (vendidas). Não multiplica por colaborador." /></label>
                <input
                  id={`scope-normal-hours-${row.key}`}
                  type="number" min="0" step="any" inputMode="decimal" placeholder="0"
                  value={row.hours}
                  onChange={e => updateRow(setNormalHours, row.key, { hours: e.target.value })}
                />
              </div>
              <button type="button" className="mini-btn alt acp-sys-del" onClick={() => removeRow(setNormalHours, row.key)} aria-label="Remover horas normais">✕</button>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        className="mini-btn"
        style={{ marginTop: 8 }}
        onClick={() => setNormalHours(prev => [...prev, { key: nextKey(), jobRoleId: '', hours: '' }])}
      >
        + Adicionar horas normais
      </button>

      <div className="sec" style={{ marginTop: 18 }}>Previsão de hora extra</div>
      <p className="placeholder-copy" style={{ margin: '2px 0 8px' }}>
        Informe o total de horas extras previstas. O valor já deve incluir todos os colaboradores; se houver mais de uma linha, elas são somadas.
      </p>

      {overtime.length === 0 ? (
        <div className="placeholder-copy">Nenhuma hora extra prevista.</div>
      ) : (
        <div className="acp-ot-list">
          {overtime.map(row => (
            <div className="acp-ot-row" key={row.key}>
              <div className="field-group acp-ot-role">
                <label>Cargo (opcional) <HelpTip icon help="Use apenas se quiser quebrar o total previsto por cargo. O cálculo soma todas as linhas." /></label>
                <select value={row.jobRoleId} onChange={e => updateRow(setOvertime, row.key, { jobRoleId: e.target.value })}>
                  <option value="">— selecione —</option>
                  {(roles ?? []).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div className="field-group">
                <label htmlFor={`scope-overtime-hours-${row.key}`}>Horas previstas <HelpTip icon help="Total de horas extras previstas (vendidas). Não multiplica por colaborador." /></label>
                <input
                  id={`scope-overtime-hours-${row.key}`}
                  type="number" min="0" step="any" inputMode="decimal" placeholder="0"
                  value={row.hours}
                  onChange={e => updateRow(setOvertime, row.key, { hours: e.target.value })}
                />
              </div>
              <button type="button" className="mini-btn alt acp-sys-del" onClick={() => removeRow(setOvertime, row.key)} aria-label="Remover hora extra">✕</button>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        className="mini-btn"
        style={{ marginTop: 8 }}
        onClick={() => setOvertime(prev => [...prev, { key: nextKey(), jobRoleId: '', hours: '' }])}
      >
        + Adicionar hora extra
      </button>
    </div>
  );
});

function updateRow<T extends { key: string }>(
  setter: React.Dispatch<React.SetStateAction<T[]>>,
  key: string,
  patch: Partial<T>
) {
  setter(prev => prev.map(r => (r.key === key ? { ...r, ...patch } : r)));
}

function removeRow<T extends { key: string }>(setter: React.Dispatch<React.SetStateAction<T[]>>, key: string) {
  setter(prev => prev.filter(r => r.key !== key));
}
