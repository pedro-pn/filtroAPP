import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getCostProfiles,
  saveCostParams,
  simulateCost,
  type CostParameterHistoryEntry,
  type CostParams,
  type CostResult
} from '../../api/acompanhamentoCusto';
import { useToast } from '../ui/ToastContext';
import { Button, Card, Field, Input, Select, Skeleton } from '../ui/ds';
import { PARAM_FIELDS, BENEFIT_FIELDS, INPUT_FIELDS, brl, modelNumber } from './costFields';

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

const PERCENT_PARAM_KEYS = new Set([
  'periculosidadePct',
  'produtividadePct',
  'transferenciaPct',
  'confinamentoPct',
  'he70Pct',
  'he100Pct',
  'fgtsPct',
  'multaPct'
]);

function paramNumber(params: CostParams | null | undefined, key: string) {
  const value = params?.[key];
  return typeof value === 'number' ? value : null;
}
function formatParam(params: CostParams | null | undefined, key: string) {
  const value = paramNumber(params, key);
  if (value === null) return '—';
  if (key === 'salarioBase' || key === 'salarioMinimo') return brl(value);
  if (PERCENT_PARAM_KEYS.has(key)) {
    return `${(value * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% (${value.toLocaleString('pt-BR', { maximumFractionDigits: 4 })})`;
  }
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}
function benefits(params: CostParams | null | undefined) {
  const value = params?.beneficios;
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, number> : {};
}
function benefitTotal(params: CostParams | null | undefined) {
  return Object.values(benefits(params)).reduce((sum, value) => sum + (Number(value) || 0), 0);
}
function activeCostParams(params: CostParams) {
  const next = { ...params };
  delete next.inssPatronalPct;
  delete next.offshoreBonusPct;
  return next;
}

function ModelHistory({ history }: { history: CostParameterHistoryEntry[] }) {
  if (!history.length) {
    return <p className="acp-cost-ds__copy">Nenhuma vigência salva para este modelo.</p>;
  }

  const seenDates = new Set<string>();
  return (
    <div className="acp-cost-ds__history">
      {history.map((entry, index) => {
        const dateKey = entry.effectiveDate?.slice(0, 10) || '';
        const isUsed = !seenDates.has(dateKey);
        seenDates.add(dateKey);
        return (
          <details key={`${dateKey}-${entry.updatedAt ?? index}`} className="acp-cost-ds__history-entry">
            <summary className="acp-cost-ds__history-summary">
              <span>{fmtDate(entry.effectiveDate)}</span>
              <span className="acp-cost-ds__history-meta">
                {isUsed ? 'Usada pelo motor' : 'Substituída por correção posterior'} · salvo em {fmtDateTime(entry.updatedAt)}
              </span>
            </summary>
            <section className="acp-cost-ds__history-section" aria-label="Parâmetros">
              <h4>Parâmetros</h4>
              <dl className="acp-cost-ds__facts">
                {PARAM_FIELDS.map(([key, label]) => (
                  <div className="acp-cost-ds__fact" key={key}>
                    <dt>{label}</dt>
                    <dd>{formatParam(entry.params, key)}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section className="acp-cost-ds__history-section" aria-label="Benefícios">
              <h4>Benefícios</h4>
              <dl className="acp-cost-ds__facts">
                {BENEFIT_FIELDS.map(([key, label]) => (
                  <div className="acp-cost-ds__fact" key={key}>
                    <dt>{label}</dt>
                    <dd>{brl(benefits(entry.params)[key])}</dd>
                  </div>
                ))}
                <div className="acp-cost-ds__fact">
                  <dt>Total</dt>
                  <dd>{brl(benefitTotal(entry.params))}</dd>
                </div>
              </dl>
            </section>
            {entry.note ? <p className="acp-cost-ds__copy">Nota: {entry.note}</p> : null}
          </details>
        );
      })}
    </div>
  );
}

// Editor dos perfis-modelo (operador/auxiliar) + simulador mensal de custo.
export function CostSimulatorPanel() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const { data, isLoading } = useQuery({ queryKey: ['cost-profiles'], queryFn: getCostProfiles });

  const [selectedKey, setSelectedKey] = useState('');
  const [params, setParams] = useState<CostParams>({});
  const [effectiveDate, setEffectiveDate] = useState(todayKey());
  const [note, setNote] = useState('');
  const [inputs, setInputs] = useState<Record<string, number>>({ diasCasa: 22, diasFora: 0, offshoreDays: 0, he70Horas: 0, he100Horas: 0 });
  const [result, setResult] = useState<CostResult | null>(null);

  useEffect(() => {
    const profiles = data ?? [];
    if (!profiles.length) return;
    const key = selectedKey || profiles[0].key;
    if (!selectedKey) setSelectedKey(key);
    const profile = profiles.find(p => p.key === key);
    if (profile?.params) setParams(profile.params);
    setEffectiveDate(todayKey());
    setNote('');
  }, [data, selectedKey]);

  const saveMutation = useMutation({
    mutationFn: () => saveCostParams(selectedKey, activeCostParams(params), effectiveDate, note.trim() || undefined),
    onSuccess: () => {
      showToast('Parâmetros salvos com nova vigência.');
      setNote('');
      queryClient.invalidateQueries({ queryKey: ['cost-profiles'] });
      queryClient.invalidateQueries({ queryKey: ['cost-cargos'] });
      queryClient.invalidateQueries({ queryKey: ['ponto-colaboradores'] });
      queryClient.invalidateQueries({ queryKey: ['project-cards'] });
    },
    onError: () => showToast('Não foi possível salvar os parâmetros.')
  });

  const simulateMutation = useMutation({
    mutationFn: () => simulateCost({ params, inputs }),
    onSuccess: setResult,
    onError: () => showToast('Não foi possível simular.')
  });

  if (isLoading) return <Card className="acp-cost-ds__panel"><Skeleton height={180} /></Card>;

  const profiles = data ?? [];
  const selectedProfile = profiles.find(p => p.key === selectedKey) ?? null;
  const history = selectedProfile?.history ?? [];
  const num = (key: string) => Number((params[key] as number) ?? 0);
  const benefits = (params.beneficios as Record<string, number>) ?? {};
  const setNum = (key: string, value: string) => setParams(current => ({ ...current, [key]: Number(value) }));
  const setBenefit = (key: string, value: string) => setParams(current => ({ ...current, beneficios: { ...((current.beneficios as Record<string, number>) ?? {}), [key]: Number(value) } }));

  return (
    <Card className="acp-cost-ds__panel" title="Modelos base e simulador">
      <p className="acp-cost-ds__copy">
        Planilha base de cálculo (Modelo 1 = Operador+, Modelo 2 = Auxiliar). Os cargos herdam estes
        parâmetros pela data de vigência (aba <strong>Cargos</strong>). Salvar cria uma nova vigência que
        passa a valer a partir da data informada. Frações: 0,3 = 30%. A insalubridade é calculada por
        salário mínimo × 20%.
      </p>

      <Field className="acp-cost-ds__month" label="Modelo base" optionalText="">
        <Select value={selectedKey} onChange={e => { setSelectedKey(e.target.value); setResult(null); }}>
          {profiles.map((p, i) => <option key={p.key} value={p.key}>Modelo {modelNumber(p.key, i + 1)} ({p.label})</option>)}
        </Select>
      </Field>
      {selectedProfile?.effectiveDate ? (
        <p className="acp-cost-ds__copy">
          Última vigência salva para este modelo: <strong>{fmtDate(selectedProfile.effectiveDate)}</strong>.
        </p>
      ) : null}

      <div className="acp-cost-ds__fields">
        {PARAM_FIELDS.map(([key, label]) => (
          <Field label={label} optionalText="" key={key}>
            <Input type="number" step="any" value={num(key)} onChange={e => setNum(key, e.target.value)} />
          </Field>
        ))}
        {BENEFIT_FIELDS.map(([key, label]) => (
          <Field label={`${label} (R$)`} optionalText="" key={key}>
            <Input type="number" step="any" value={Number(benefits[key] ?? 0)} onChange={e => setBenefit(key, e.target.value)} />
          </Field>
        ))}
        <Field label="Vigente a partir de" required>
          <Input type="date" required value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} />
        </Field>
        <Field label="Nota da alteração" optionalText="">
          <Input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="Ex.: correção do histórico" />
        </Field>
      </div>

      <div className="acp-cost-ds__actions">
        <Button variant="primary" size="sm" loading={saveMutation.isPending} disabled={!effectiveDate} onClick={() => saveMutation.mutate()}>
          {saveMutation.isPending ? 'Salvando…' : 'Salvar parâmetros do modelo'}
        </Button>
      </div>

      <section className="acp-cost-ds__subsection" aria-label="Histórico de vigências do modelo">
        <h3>Histórico de vigências do modelo</h3>
        <ModelHistory history={history} />
      </section>

      <h3 className="acp-cost-ds__section-title acp-cost-ds__section-title--divided">Simulador mensal</h3>
      <div className="acp-cost-ds__fields">
        {INPUT_FIELDS.map(([key, label]) => (
          <Field label={label} optionalText="" key={key}>
            <Input type="number" step="any" value={inputs[key] ?? 0} onChange={e => setInputs(c => ({ ...c, [key]: Number(e.target.value) }))} />
          </Field>
        ))}
      </div>
      <div className="acp-cost-ds__actions">
        <Button variant="secondary" size="sm" loading={simulateMutation.isPending} onClick={() => simulateMutation.mutate()}>
          {simulateMutation.isPending ? 'Calculando…' : 'Simular custo'}
        </Button>
      </div>

      {result ? (
        <section className="acp-cost-ds__surface" aria-label="Resultado da simulação">
          <dl className="acp-cost-ds__facts">
            <div className="acp-cost-ds__fact"><dt>Remuneração bruta</dt><dd>{brl(result.remuneracaoBruta)}</dd></div>
            <div className="acp-cost-ds__fact"><dt>Encargos (FGTS)</dt><dd>{brl(result.encargos)}</dd></div>
            <div className="acp-cost-ds__fact"><dt>Provisões (13º+férias+FGTS)</dt><dd>{brl(result.provisoes)}</dd></div>
            <div className="acp-cost-ds__fact"><dt>Benefícios</dt><dd>{brl(result.beneficios)}</dd></div>
            <div className="acp-cost-ds__fact"><dt>Passivo rescisório</dt><dd>{brl(result.passivoRescisorio)}</dd></div>
            <div className="acp-cost-ds__fact acp-cost-ds__fact--total"><dt>Custo total mensal</dt><dd>{brl(result.totalMensal)}</dd></div>
            <div className="acp-cost-ds__fact"><dt>Custo/hora (220h)</dt><dd>{brl(result.custoHora220)}</dd></div>
            <div className="acp-cost-ds__fact"><dt>Custo/dia útil</dt><dd>{brl(result.custoDiaUtil)}</dd></div>
          </dl>
        </section>
      ) : null}
    </Card>
  );
}
