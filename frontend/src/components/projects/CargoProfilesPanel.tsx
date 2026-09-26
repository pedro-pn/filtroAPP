import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getCargoCostProfiles,
  getCostProfiles,
  saveCargoCostParams,
  type CargoCostHistoryEntry,
  type CostProfile
} from '../../api/acompanhamentoCusto';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../ui/ToastContext';
import { Button, Card, DataTable, EmptyState, Field, Input, Select, Skeleton } from '../ui/ds';
import { brl, modelNumber } from './costFields';

function num(params: CostProfile['params'], key: string): number {
  const v = params?.[key];
  return typeof v === 'number' ? v : 0;
}
function frac(params: CostProfile['params'], key: string) {
  return `${(num(params, key) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}
function benefitsTotal(params: CostProfile['params']) {
  const b = (params?.beneficios as Record<string, number>) ?? {};
  return Object.values(b).reduce((sum, v) => sum + (Number(v) || 0), 0);
}
function todayKey() {
  return new Date().toISOString().slice(0, 10);
}
function fmtDate(value?: string | null) {
  if (!value) return 'sem vigência registrada';
  const [y, m, d] = value.slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : value;
}
function fmtDateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fmtDate(value) : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
function modelLabel(key: string | undefined, models: CostProfile[]) {
  const model = key ? models.find(item => item.key === key) : models[0];
  if (!model) return key || '—';
  return `Modelo ${modelNumber(model.key, models.indexOf(model) + 1)} (${model.label})`;
}
function moneyParam(entry: CargoCostHistoryEntry, key: 'salarioBase') {
  const value = entry.params?.[key];
  return typeof value === 'number' ? brl(value) : '—';
}

// Custo por cargo: o cargo herda os adicionais do modelo escolhido e só define salário base.
// Cada alteração cria uma versão com data de vigência.
export function CargoProfilesPanel() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const { user } = useAuth();
  const isManager = user?.accountType === 'ADMIN' || Boolean(user?.moduleRoles?.includes('acompanhamento:manager'));

  const { data: cargos, isLoading } = useQuery({ queryKey: ['cost-cargos'], queryFn: getCargoCostProfiles });
  const { data: modelsRaw } = useQuery({ queryKey: ['cost-profiles'], queryFn: getCostProfiles });

  const models = useMemo(() => {
    const list = [...(modelsRaw ?? [])];
    list.sort((a, b) => modelNumber(a.key, 99) - modelNumber(b.key, 99));
    return list;
  }, [modelsRaw]);

  const [selectedId, setSelectedId] = useState('');
  const [baseModel, setBaseModel] = useState('');
  const [salarioBase, setSalarioBase] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(todayKey());

  const selectedCargo = (cargos ?? []).find(c => c.jobRoleId === selectedId) ?? null;
  const selectedModel = models.find(m => m.key === baseModel) ?? null;

  // Ao trocar de cargo, carrega o override salvo (ou os defaults do modelo).
  useEffect(() => {
    const list = cargos ?? [];
    if (!list.length || !models.length) return;
    const id = selectedId || list[0].jobRoleId;
    if (!selectedId) { setSelectedId(id); return; }
    const cargo = list.find(c => c.jobRoleId === id);
    const params = cargo?.params ?? null;
    const modelKey = params?.baseModel || models[0].key;
    const model = models.find(m => m.key === modelKey) ?? models[0];
    setBaseModel(model.key);
    setSalarioBase(String(params?.salarioBase ?? num(model.params, 'salarioBase')));
    setEffectiveDate(todayKey());
  }, [cargos, selectedId, models]);

  const saveMutation = useMutation({
    mutationFn: () => saveCargoCostParams(selectedId, {
      baseModel,
      salarioBase: Number(salarioBase) || 0
    }, effectiveDate),
    onSuccess: () => {
      showToast('Custo do cargo salvo com nova vigência.');
      queryClient.invalidateQueries({ queryKey: ['cost-cargos'] });
      queryClient.invalidateQueries({ queryKey: ['ponto-colaboradores'] });
      queryClient.invalidateQueries({ queryKey: ['project-cards'] });
    },
    onError: () => showToast('Não foi possível salvar o custo do cargo.')
  });

  if (isLoading) return <Card className="acp-cost-ds__panel"><Skeleton height={180} /></Card>;
  if (!models.length) return <Card className="acp-cost-ds__panel"><EmptyState title="Sem modelos base" description="Configure os modelos na aba Simulador primeiro." /></Card>;

  const list = cargos ?? [];
  const mp = selectedModel?.params ?? null;
  const history = selectedCargo?.history ?? [];

  return (
    <Card className="acp-cost-ds__panel" title="Custo por cargo">
      <p className="acp-cost-ds__copy">
        Cada cargo é calculado com base em um <strong>modelo</strong> (planilha base) e define apenas o
        <strong> salário base</strong>. Os demais parâmetros (salário mínimo, adicionais, FGTS, multa rescisória,
        benefícios) vêm do modelo vigente na data calculada. Ao salvar, informe a data a partir da qual os novos
        valores passam a valer. A insalubridade é calculada por salário mínimo × 20%.
      </p>
      {selectedCargo?.effectiveDate ? (
        <p className="placeholder-copy" style={{ margin: '-6px 0 12px' }}>
          Última vigência salva para este cargo: <strong>{fmtDate(selectedCargo.effectiveDate)}</strong>.
        </p>
      ) : null}

      <div className="acp-cost-ds__fields">
        <Field label="Cargo" optionalText="">
          <Select value={selectedId} onChange={e => setSelectedId(e.target.value)}>
            {list.map(c => (
              <option key={c.jobRoleId} value={c.jobRoleId}>
                {c.name}{c.profileId ? '' : ' — sem custo'}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Modelo base de cálculo" optionalText="">
          <Select value={baseModel} disabled={!isManager} onChange={e => setBaseModel(e.target.value)}>
            {models.map((m, i) => (
              <option key={m.key} value={m.key}>Modelo {modelNumber(m.key, i + 1)} ({m.label})</option>
            ))}
          </Select>
        </Field>
        <Field label="Salário base (R$)" optionalText="">
          <Input type="number" step="any" disabled={!isManager} value={salarioBase} onChange={e => setSalarioBase(e.target.value)} />
        </Field>
        <Field label="Vigente a partir de" required>
          <Input type="date" required disabled={!isManager} value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} />
        </Field>
      </div>

      {selectedCargo && !selectedCargo.profileId ? (
        <p className="placeholder-copy" style={{ margin: '8px 0 0', color: '#a06a00' }}>
          Este cargo ainda não tem custo salvo — os valores acima vêm do modelo selecionado.
        </p>
      ) : null}

      <section className="acp-cost-ds__subsection" aria-label="Histórico de vigências do cargo">
        <h3>Histórico de vigências do cargo</h3>
        {history.length === 0 ? (
          <p className="placeholder-copy" style={{ margin: 0 }}>Nenhuma vigência salva para este cargo.</p>
        ) : (
          <DataTable
            ariaLabel="Histórico de vigências do cargo"
            rows={history}
            getRowId={entry => `${entry.effectiveDate}-${entry.updatedAt ?? ''}`}
            columns={[
              { key: 'date', header: 'Vigente desde', render: entry => fmtDate(entry.effectiveDate) },
              { key: 'model', header: 'Modelo', render: entry => modelLabel(entry.params?.baseModel, models) },
              { key: 'salary', header: 'Salário base', render: entry => moneyParam(entry, 'salarioBase') },
              { key: 'saved', header: 'Salvo em', render: entry => fmtDateTime(entry.updatedAt) }
            ]}
            mobile={{ renderItem: entry => ({
              title: fmtDate(entry.effectiveDate),
              subtitle: modelLabel(entry.params?.baseModel, models),
              value: moneyParam(entry, 'salarioBase'),
              metadata: [{ label: 'Salvo em', value: fmtDateTime(entry.updatedAt) }]
            }) }}
          />
        )}
      </section>

      {mp ? (
        <section className="acp-cost-ds__subsection" aria-label="Herdado do modelo selecionado">
          <h3>Herdado do modelo selecionado</h3>
          <div className="det-row"><span className="det-label">Periculosidade</span><span className="det-val">{frac(mp, 'periculosidadePct')} (integral)</span></div>
          <div className="det-row"><span className="det-label">Produtividade / Gratificação</span><span className="det-val">{frac(mp, 'produtividadePct')}</span></div>
          <div className="det-row"><span className="det-label">Transferência / Viagem</span><span className="det-val">{frac(mp, 'transferenciaPct')}</span></div>
          <div className="det-row"><span className="det-label">Confinamento / Offshore</span><span className="det-val">{frac(mp, 'confinamentoPct')}</span></div>
          <div className="det-row"><span className="det-label">HE 70% / 100%</span><span className="det-val">{frac(mp, 'he70Pct')} / {frac(mp, 'he100Pct')}</span></div>
          <div className="det-row"><span className="det-label">FGTS</span><span className="det-val">{frac(mp, 'fgtsPct')}</span></div>
          <div className="det-row"><span className="det-label">Multa rescisória</span><span className="det-val">{frac(mp, 'multaPct')}</span></div>
          <div className="det-row"><span className="det-label">Benefícios (total)</span><span className="det-val">{brl(benefitsTotal(mp))}</span></div>
        </section>
      ) : null}

      {isManager ? (
        <div className="acp-cost-ds__actions">
          <Button variant="primary" size="sm" loading={saveMutation.isPending} disabled={!selectedId || !effectiveDate} onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending ? 'Salvando…' : 'Salvar custo do cargo'}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
