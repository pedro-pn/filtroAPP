import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getPlannedScope,
  setPlannedScope,
  type PlannedMeasureUnit,
  type PlannedScope,
  type PlannedSystemType
} from '../../api/acompanhamentoComercial';
import { listJobRoles } from '../../api/jobRoles';
import { useToast } from '../ui/Toast';

// Tipos de serviço conhecidos (alinhados ao backend) + rótulos exibidos.
const SERVICE_TYPES: Array<{ value: string; label: string }> = [
  { value: 'LIMPEZA_QUIMICA', label: 'Limpeza química' },
  { value: 'TESTE_PRESSAO', label: 'Teste de pressão' },
  { value: 'FLUSHING', label: 'Flushing' },
  { value: 'FILTRAGEM', label: 'Filtragem' }
];

const SYSTEM_LABELS: Record<PlannedSystemType, string> = {
  TUBULACAO: 'Tubulações',
  TANQUE: 'Tanques',
  OLEO: 'Óleo'
};
const UNIT_LABELS: Record<PlannedMeasureUnit, string> = { M: 'm', KG: 'kg', T: 't', UN: 'un', L: 'L' };

// Unidades compatíveis com cada tipo de sistema.
const SYSTEM_UNITS: Record<PlannedSystemType, PlannedMeasureUnit[]> = {
  TUBULACAO: ['M', 'KG', 'T'], // comprimento (m) ou peso (kg, t)
  TANQUE: ['UN', 'KG'], // unidades (un) ou peso (kg)
  OLEO: ['L'] // litros
};

// Tipos de sistema permitidos por serviço.
const SERVICE_SYSTEMS: Record<string, PlannedSystemType[]> = {
  LIMPEZA_QUIMICA: ['TUBULACAO', 'TANQUE', 'OLEO'],
  TESTE_PRESSAO: ['TUBULACAO'],
  FLUSHING: ['TUBULACAO', 'TANQUE', 'OLEO'],
  FILTRAGEM: ['OLEO']
};
const ALL_SYSTEMS: PlannedSystemType[] = ['TUBULACAO', 'TANQUE', 'OLEO'];

const allowedSystems = (serviceType: string) => SERVICE_SYSTEMS[serviceType] ?? ALL_SYSTEMS;
const defaultUnit = (systemType: PlannedSystemType) => SYSTEM_UNITS[systemType][0];

// Linhas locais usam string nos campos numéricos (inputs controlados); convertem no salvar.
interface SystemRow {
  key: string;
  systemType: PlannedSystemType;
  quantity: string;
  unit: PlannedMeasureUnit;
}
interface ServiceRow {
  key: string;
  serviceType: string;
  systems: SystemRow[];
}
interface OvertimeRow {
  key: string;
  jobRoleId: string;
  collaboratorCount: string;
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

function fromScope(scope: PlannedScope): { services: ServiceRow[]; overtime: OvertimeRow[] } {
  return {
    services: scope.services.map(s => {
      const serviceType = s.serviceType || 'LIMPEZA_QUIMICA';
      const allowed = allowedSystems(serviceType);
      return {
        key: nextKey(),
        serviceType,
        systems: (s.systems ?? [])
          .filter(sys => allowed.includes(sys.systemType))
          .map(sys => {
            const units = SYSTEM_UNITS[sys.systemType];
            const unit = sys.unit && units.includes(sys.unit) ? sys.unit : units[0];
            return { key: nextKey(), systemType: sys.systemType, quantity: toStr(sys.quantity), unit };
          })
      };
    }),
    overtime: scope.overtime.map(o => ({
      key: nextKey(),
      jobRoleId: o.jobRoleId || '',
      collaboratorCount: toStr(o.collaboratorCount),
      hours: toStr(o.hours)
    }))
  };
}

function normalize(services: ServiceRow[], overtime: OvertimeRow[]) {
  return JSON.stringify({
    services: services.map(s => ({
      serviceType: s.serviceType,
      systems: s.systems.map(sys => ({ systemType: sys.systemType, quantity: sys.quantity, unit: sys.unit }))
    })),
    overtime: overtime.map(o => ({ jobRoleId: o.jobRoleId, collaboratorCount: o.collaboratorCount, hours: o.hours }))
  });
}

// Editor do escopo previsto (vendido): serviços com seus sistemas + previsão de hora extra.
// Preenchimento manual — esses dados ainda não vêm do banco comercial.
export function ProjectPlannedScopeEditor({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const queryKey = ['planned-scope', projectId];

  const { data, isLoading } = useQuery({ queryKey, queryFn: () => getPlannedScope(projectId) });
  const { data: roles } = useQuery({ queryKey: ['job-roles'], queryFn: () => listJobRoles() });

  const [services, setServices] = useState<ServiceRow[]>([]);
  const [overtime, setOvertime] = useState<OvertimeRow[]>([]);
  const [baseline, setBaseline] = useState('');

  useEffect(() => {
    if (!data) return;
    const next = fromScope(data);
    setServices(next.services);
    setOvertime(next.overtime);
    setBaseline(normalize(next.services, next.overtime));
  }, [data]);

  const dirty = useMemo(() => normalize(services, overtime) !== baseline, [services, overtime, baseline]);

  const mutation = useMutation({
    mutationFn: (payload: PlannedScope) => setPlannedScope(projectId, payload),
    onSuccess: (saved) => {
      showToast('Escopo previsto salvo.');
      queryClient.setQueryData(queryKey, saved);
      queryClient.invalidateQueries({ queryKey: ['commercial-dashboard'] });
    },
    onError: () => showToast('Não foi possível salvar o escopo previsto.')
  });

  function save() {
    const payload: PlannedScope = {
      services: services.map(s => ({
        serviceType: s.serviceType,
        systems: s.systems.map(sys => ({
          systemType: sys.systemType,
          quantity: toNum(sys.quantity),
          unit: sys.unit
        }))
      })),
      overtime: overtime
        .filter(o => o.jobRoleId || toNum(o.hours))
        .map(o => ({
          jobRoleId: o.jobRoleId || null,
          collaboratorCount: Math.max(1, Math.trunc(toNum(o.collaboratorCount) ?? 1)),
          hours: toNum(o.hours) ?? 0
        }))
    };
    mutation.mutate(payload);
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
      return { ...s, systems: [...s.systems, { key: nextKey(), systemType: next, quantity: '', unit: defaultUnit(next) }] };
    }));
  }

  function changeSystem(serviceKey: string, sysKey: string, patch: Partial<SystemRow>) {
    setServices(prev => prev.map(s => {
      if (s.key !== serviceKey) return s;
      return {
        ...s,
        systems: s.systems.map(sys => {
          if (sys.key !== sysKey) return sys;
          const merged = { ...sys, ...patch };
          // Ao trocar o tipo de sistema, garante uma unidade compatível.
          if (patch.systemType && !SYSTEM_UNITS[merged.systemType].includes(merged.unit)) {
            merged.unit = defaultUnit(merged.systemType);
          }
          return merged;
        })
      };
    }));
  }

  function removeSystem(serviceKey: string, sysKey: string) {
    setServices(prev => prev.map(s => (
      s.key === serviceKey ? { ...s, systems: s.systems.filter(sys => sys.key !== sysKey) } : s
    )));
  }

  if (isLoading) return <div className="placeholder-copy">Carregando escopo…</div>;

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
                <div className="field-group">
                  <label>Serviço</label>
                  <select value={svc.serviceType} onChange={e => changeServiceType(svc.key, e.target.value)}>
                    {SERVICE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <button type="button" className="mini-btn alt" onClick={() => setServices(prev => prev.filter(s => s.key !== svc.key))}>
                  Remover serviço
                </button>
              </div>

              {svc.systems.length === 0 ? (
                <div className="placeholder-copy" style={{ margin: '4px 0' }}>Nenhum sistema adicionado.</div>
              ) : (
                <div className="acp-sys-list">
                  {svc.systems.map(sys => {
                    const units = SYSTEM_UNITS[sys.systemType];
                    return (
                      <div className="acp-sys-row" key={sys.key}>
                        <div className="field-group">
                          <label>Sistema</label>
                          <select
                            value={sys.systemType}
                            onChange={e => changeSystem(svc.key, sys.key, { systemType: e.target.value as PlannedSystemType })}
                          >
                            {allowedSystems(svc.serviceType).map(t => <option key={t} value={t}>{SYSTEM_LABELS[t]}</option>)}
                          </select>
                        </div>
                        <div className="field-group">
                          <label>Quantidade</label>
                          <div className="num-unit">
                            <input
                              type="number" min="0" step="any" inputMode="decimal" placeholder="0"
                              value={sys.quantity}
                              onChange={e => changeSystem(svc.key, sys.key, { quantity: e.target.value })}
                            />
                            <select
                              value={sys.unit}
                              disabled={units.length === 1}
                              onChange={e => changeSystem(svc.key, sys.key, { unit: e.target.value as PlannedMeasureUnit })}
                            >
                              {units.map(u => <option key={u} value={u}>{UNIT_LABELS[u]}</option>)}
                            </select>
                          </div>
                        </div>
                        <button type="button" className="mini-btn alt acp-sys-del" onClick={() => removeSystem(svc.key, sys.key)} aria-label="Remover sistema">✕</button>
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
        onClick={() => setServices(prev => {
          const serviceType = 'LIMPEZA_QUIMICA';
          return [...prev, { key: nextKey(), serviceType, systems: [] }];
        })}
      >
        + Adicionar serviço
      </button>

      <div className="sec" style={{ marginTop: 18 }}>Previsão de hora extra</div>
      <p className="placeholder-copy" style={{ margin: '2px 0 8px' }}>
        Por cargo, nº de colaboradores e total de horas previstas.
      </p>

      {overtime.length === 0 ? (
        <div className="placeholder-copy">Nenhuma hora extra prevista.</div>
      ) : (
        <div className="acp-ot-list">
          {overtime.map(row => (
            <div className="acp-ot-row" key={row.key}>
              <div className="field-group acp-ot-role">
                <label>Cargo</label>
                <select value={row.jobRoleId} onChange={e => updateRow(setOvertime, row.key, { jobRoleId: e.target.value })}>
                  <option value="">— selecione —</option>
                  {(roles ?? []).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div className="field-group">
                <label>Colaboradores</label>
                <input
                  type="number" min="1" step="1" inputMode="numeric" placeholder="1"
                  value={row.collaboratorCount}
                  onChange={e => updateRow(setOvertime, row.key, { collaboratorCount: e.target.value })}
                />
              </div>
              <div className="field-group">
                <label>Horas previstas</label>
                <input
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
        onClick={() => setOvertime(prev => [...prev, { key: nextKey(), jobRoleId: '', collaboratorCount: '1', hours: '' }])}
      >
        + Adicionar hora extra
      </button>

      <div style={{ marginTop: 16 }}>
        <button type="button" className="mini-btn" disabled={mutation.isPending || !dirty} onClick={save}>
          {mutation.isPending ? 'Salvando…' : 'Salvar escopo previsto'}
        </button>
      </div>
    </div>
  );
}

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
