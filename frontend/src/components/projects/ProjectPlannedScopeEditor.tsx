import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getPlannedScope,
  setPlannedScope,
  type PlannedScope,
  type ReservoirUnit,
  type TubingUnit
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

// Linhas locais usam string nos campos numéricos (inputs controlados); convertem no salvar.
interface ServiceRow {
  key: string;
  serviceType: string;
  tubingQty: string;
  tubingUnit: TubingUnit;
  oilLiters: string;
  reservoirQty: string;
  reservoirUnit: ReservoirUnit;
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
    services: scope.services.map(s => ({
      key: nextKey(),
      serviceType: s.serviceType || 'LIMPEZA_QUIMICA',
      tubingQty: toStr(s.tubingQty),
      tubingUnit: (s.tubingUnit as TubingUnit) || 'M',
      oilLiters: toStr(s.oilLiters),
      reservoirQty: toStr(s.reservoirQty),
      reservoirUnit: (s.reservoirUnit as ReservoirUnit) || 'UN'
    })),
    overtime: scope.overtime.map(o => ({
      key: nextKey(),
      jobRoleId: o.jobRoleId || '',
      collaboratorCount: toStr(o.collaboratorCount),
      hours: toStr(o.hours)
    }))
  };
}

// Editor do escopo previsto (vendido): quantitativo por serviço + previsão de hora extra.
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
    setBaseline(JSON.stringify(next.services.map(stripKey)) + JSON.stringify(next.overtime.map(stripKey)));
  }, [data]);

  const dirty = useMemo(() => {
    const current = JSON.stringify(services.map(stripKey)) + JSON.stringify(overtime.map(stripKey));
    return current !== baseline;
  }, [services, overtime, baseline]);

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
        tubingQty: toNum(s.tubingQty),
        tubingUnit: toNum(s.tubingQty) === null ? null : s.tubingUnit,
        oilLiters: toNum(s.oilLiters),
        reservoirQty: toNum(s.reservoirQty),
        reservoirUnit: toNum(s.reservoirQty) === null ? null : s.reservoirUnit
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

  if (isLoading) return <div className="placeholder-copy">Carregando escopo…</div>;

  return (
    <div className="acp-scope">
      <div className="sec" style={{ marginTop: 4 }}>Serviços previstos (vendido)</div>
      <p className="placeholder-copy" style={{ margin: '2px 0 6px' }}>
        Preenchimento manual — quantitativo vendido por serviço.
      </p>

      {services.length === 0 ? (
        <div className="placeholder-copy">Nenhum serviço previsto.</div>
      ) : (
        <div className="acp-scope-list">
          {services.map(row => (
            <div className="acp-scope-row" key={row.key}>
              <div className="acp-scope-field acp-scope-type">
                <label>Serviço</label>
                <select
                  value={row.serviceType}
                  onChange={e => updateRow(setServices, row.key, { serviceType: e.target.value })}
                >
                  {SERVICE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="acp-scope-field">
                <label>Tubulação</label>
                <div className="acp-scope-measure">
                  <input
                    type="number" min="0" step="any" inputMode="decimal" placeholder="0"
                    value={row.tubingQty}
                    onChange={e => updateRow(setServices, row.key, { tubingQty: e.target.value })}
                  />
                  <select value={row.tubingUnit} onChange={e => updateRow(setServices, row.key, { tubingUnit: e.target.value as TubingUnit })}>
                    <option value="M">m</option>
                    <option value="KG">kg</option>
                  </select>
                </div>
              </div>
              <div className="acp-scope-field">
                <label>Óleo</label>
                <div className="acp-scope-measure">
                  <input
                    type="number" min="0" step="any" inputMode="decimal" placeholder="0"
                    value={row.oilLiters}
                    onChange={e => updateRow(setServices, row.key, { oilLiters: e.target.value })}
                  />
                  <span className="acp-scope-unit">L</span>
                </div>
              </div>
              <div className="acp-scope-field">
                <label>Reservatórios</label>
                <div className="acp-scope-measure">
                  <input
                    type="number" min="0" step="any" inputMode="decimal" placeholder="0"
                    value={row.reservoirQty}
                    onChange={e => updateRow(setServices, row.key, { reservoirQty: e.target.value })}
                  />
                  <select value={row.reservoirUnit} onChange={e => updateRow(setServices, row.key, { reservoirUnit: e.target.value as ReservoirUnit })}>
                    <option value="UN">un</option>
                    <option value="KG">kg</option>
                  </select>
                </div>
              </div>
              <button type="button" className="mini-btn alt acp-scope-del" onClick={() => removeRow(setServices, row.key)} aria-label="Remover serviço">✕</button>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        className="mini-btn"
        style={{ marginTop: 6 }}
        onClick={() => setServices(prev => [...prev, {
          key: nextKey(), serviceType: 'LIMPEZA_QUIMICA', tubingQty: '', tubingUnit: 'M', oilLiters: '', reservoirQty: '', reservoirUnit: 'UN'
        }])}
      >
        + Adicionar serviço
      </button>

      <div className="sec" style={{ marginTop: 16 }}>Previsão de hora extra</div>
      <p className="placeholder-copy" style={{ margin: '2px 0 6px' }}>
        Por cargo, nº de colaboradores e total de horas previstas.
      </p>

      {overtime.length === 0 ? (
        <div className="placeholder-copy">Nenhuma hora extra prevista.</div>
      ) : (
        <div className="acp-scope-list">
          {overtime.map(row => (
            <div className="acp-scope-row acp-scope-ot" key={row.key}>
              <div className="acp-scope-field acp-scope-type">
                <label>Cargo</label>
                <select value={row.jobRoleId} onChange={e => updateRow(setOvertime, row.key, { jobRoleId: e.target.value })}>
                  <option value="">— selecione —</option>
                  {(roles ?? []).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div className="acp-scope-field">
                <label>Colaboradores</label>
                <input
                  type="number" min="1" step="1" inputMode="numeric" placeholder="1"
                  value={row.collaboratorCount}
                  onChange={e => updateRow(setOvertime, row.key, { collaboratorCount: e.target.value })}
                />
              </div>
              <div className="acp-scope-field">
                <label>Horas previstas</label>
                <input
                  type="number" min="0" step="any" inputMode="decimal" placeholder="0"
                  value={row.hours}
                  onChange={e => updateRow(setOvertime, row.key, { hours: e.target.value })}
                />
              </div>
              <button type="button" className="mini-btn alt acp-scope-del" onClick={() => removeRow(setOvertime, row.key)} aria-label="Remover hora extra">✕</button>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        className="mini-btn"
        style={{ marginTop: 6 }}
        onClick={() => setOvertime(prev => [...prev, { key: nextKey(), jobRoleId: '', collaboratorCount: '1', hours: '' }])}
      >
        + Adicionar hora extra
      </button>

      <div style={{ marginTop: 14 }}>
        <button type="button" className="mini-btn" disabled={mutation.isPending || !dirty} onClick={save}>
          {mutation.isPending ? 'Salvando…' : 'Salvar escopo previsto'}
        </button>
      </div>
    </div>
  );
}

function stripKey<T extends { key: string }>(row: T) {
  const { key, ...rest } = row;
  void key;
  return rest;
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
