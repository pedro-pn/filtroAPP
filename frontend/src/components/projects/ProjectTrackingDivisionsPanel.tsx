import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { getProjectDetail, saveTrackingDivisions, type TrackingDivision, type TrackingDivisionCandidate, type TrackingDivisionsResponse } from '../../api/acompanhamentoComercial';
import { percentageForProjectValue, percentageOfProjectTotal, type TrackingDivisionPlannedField } from '../../utils/trackingDivisionPercentage';
import { Modal } from '../ui/Modal';

type Draft = { enabled: boolean; startDate: string; endDate: string; plannedCost: string; plannedRevenue: string; plannedHours: string; plannedDays: string };
const emptyDraft = (): Draft => ({ enabled: false, startDate: '', endDate: '', plannedCost: '', plannedRevenue: '', plannedHours: '', plannedDays: '' });
const plannedFields: ReadonlyArray<readonly [TrackingDivisionPlannedField, string]> = [
  ['plannedCost', 'Custo previsto (R$)'],
  ['plannedRevenue', 'Receita prevista (R$)'],
  ['plannedHours', 'Horas previstas'],
  ['plannedDays', 'Dias previstos']
] as const;

function draftFromRows(rows: TrackingDivision[]): Record<string, Draft> {
  return Object.fromEntries(rows.map(row => [row.key, {
    enabled: true, startDate: row.startDate, endDate: row.endDate ?? '',
    plannedCost: row.plannedCost == null ? '' : String(row.plannedCost),
    plannedRevenue: row.plannedRevenue == null ? '' : String(row.plannedRevenue),
    plannedHours: row.plannedHours == null ? '' : String(row.plannedHours),
    plannedDays: row.plannedDays == null ? '' : String(row.plannedDays)
  }]));
}

function numeric(value: string): number | null {
  return value.trim() === '' ? null : Number(value);
}

function formatPlannedValue(field: TrackingDivisionPlannedField, value: number): string {
  if (field === 'plannedCost' || field === 'plannedRevenue') {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  return `${value.toLocaleString('pt-BR')}${field === 'plannedHours' ? ' h' : ' dias'}`;
}

export function ProjectTrackingDivisionsPanel({ projectId, data, onClose }: {
  projectId: string;
  data: TrackingDivisionsResponse;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<string, Draft>>(() => draftFromRows(data.divisions));
  const [percentDraft, setPercentDraft] = useState<Record<string, Partial<Record<TrackingDivisionPlannedField, string>>>>({});
  const [error, setError] = useState<string | null>(null);
  const { data: projectTotal, isPending: projectTotalLoading, isError: projectTotalError } = useQuery({
    queryKey: ['project-detail', projectId, ''],
    queryFn: () => getProjectDetail(projectId)
  });
  const totals: Record<TrackingDivisionPlannedField, number | null> = {
    plannedCost: projectTotal?.consumo.previsto ?? null,
    plannedRevenue: projectTotal?.faturamento.previsto == null ? null : Number(projectTotal.faturamento.previsto),
    plannedHours: projectTotal?.workedHours.plannedTotalHours ?? null,
    plannedDays: projectTotal?.diasCorridos.planned ?? null
  };
  const save = useMutation({
    mutationFn: (rows: TrackingDivision[]) => saveTrackingDivisions(projectId, rows),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tracking-divisions', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['project-detail', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['commercial-dashboard'] })
      ]);
      onClose();
    },
    onError: (cause: unknown) => setError(axios.isAxiosError(cause)
      ? String(cause.response?.data?.error ?? 'Não foi possível salvar as divisões.')
      : 'Não foi possível salvar as divisões.')
  });

  function update(key: string, patch: Partial<Draft>) {
    setDraft(current => ({ ...current, [key]: { ...(current[key] ?? emptyDraft()), ...patch } }));
    setError(null);
  }

  function setPercentage(key: string, field: TrackingDivisionPlannedField, percentage: string | null) {
    setPercentDraft(current => {
      const next = { ...(current[key] ?? {}) };
      if (percentage == null) delete next[field];
      else next[field] = percentage;
      return { ...current, [key]: next };
    });
    setError(null);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const rows: TrackingDivision[] = [];
    for (const candidate of data.candidates.flatMap(scope => [scope, ...(scope.equipments ?? [])])) {
      const item = draft[candidate.key];
      if (!item?.enabled) continue;
      if (!item.startDate) { setError(`Informe a data inicial de ${candidate.label}.`); return; }
      if (item.endDate && item.endDate < item.startDate) { setError(`Confira a data final de ${candidate.label}.`); return; }
      const planned = Object.fromEntries(plannedFields.map(([field]) => {
        const percentage = percentDraft[candidate.key]?.[field];
        if (percentage === undefined) return [field, numeric(item[field])];
        const total = totals[field];
        if (percentage.trim() && (total == null || !Number.isFinite(total) || total <= 0 ||
          !Number.isFinite(Number(percentage)) || Number(percentage) < 0 || Number(percentage) > 100)) {
          return [field, NaN];
        }
        return [field, percentageOfProjectTotal(total, percentage, field)];
      }));
      if (Object.values(planned).some(value => value != null && (!Number.isFinite(value) || value < 0))) {
        setError(`Confira os valores ou percentuais previstos de ${candidate.label} (0% a 100%).`); return;
      }
      if (planned.plannedDays != null && !Number.isInteger(planned.plannedDays)) {
        setError(`Dias previstos devem ser inteiros em ${candidate.label}.`); return;
      }
      rows.push({ key: candidate.key, startDate: item.startDate, endDate: item.endDate || null,
        plannedCost: planned.plannedCost, plannedRevenue: planned.plannedRevenue,
        plannedHours: planned.plannedHours, plannedDays: planned.plannedDays });
    }
    save.mutate(rows);
  }

  function fields(candidate: TrackingDivisionCandidate) {
    const item = draft[candidate.key] ?? emptyDraft();
    const index = data.candidates.flatMap(scope => [scope, ...(scope.equipments ?? [])])
      .findIndex(entry => entry.key === candidate.key);
    const fieldId = (field: string) => `acp-division-${index}-${field}`;
    return <div className="acp-tracking-division-row" key={candidate.key}>
      <div className="field-group">
        <label className="acp-checkbox-inline acp-tracking-division-toggle">
          <input type="checkbox" checked={item.enabled} onChange={event => update(candidate.key, { enabled: event.target.checked })} />
          <strong>{candidate.kind === 'SCOPE' ? 'Aba do escopo' : candidate.label}</strong>
          {candidate.kind === 'EQUIPMENT' ? <small>{candidate.systemCount ?? 0} sistema{candidate.systemCount === 1 ? '' : 's'} agrupado{candidate.systemCount === 1 ? '' : 's'}</small> : null}
        </label>
      </div>
      {item.enabled ? <div className="acp-tracking-division-fields">
        <div className="field-group">
          <label htmlFor={fieldId('start')}>Início</label>
          <input id={fieldId('start')} type="date" required value={item.startDate} onChange={event => update(candidate.key, { startDate: event.target.value })} />
        </div>
        <div className="field-group">
          <label htmlFor={fieldId('end')}>Fim (opcional)</label>
          <input id={fieldId('end')} type="date" min={item.startDate || undefined} value={item.endDate} onChange={event => update(candidate.key, { endDate: event.target.value })} />
        </div>
        {plannedFields.map(([field, label]) => {
          const percentage = percentDraft[candidate.key]?.[field];
          const total = totals[field];
          const canUsePercentage = total != null && Number.isFinite(total) && total > 0;
          const calculated = percentage === undefined ? null : percentageOfProjectTotal(total, percentage, field);
          return <div className="field-group acp-tracking-division-planned" key={field}>
            <label htmlFor={fieldId(field)}>{label}</label>
            <div className="acp-tracking-division-input-row">
              <input id={fieldId(field)} type="number" min="0" max={percentage === undefined ? undefined : 100}
                step={percentage === undefined ? field === 'plannedDays' ? '1' : '0.01' : 'any'}
                inputMode={field === 'plannedDays' && percentage === undefined ? 'numeric' : 'decimal'}
                placeholder={percentage === undefined ? '—' : '%'} value={percentage === undefined ? item[field] : percentage}
                onChange={event => percentage === undefined
                  ? update(candidate.key, { [field]: event.target.value })
                  : setPercentage(candidate.key, field, event.target.value)} />
              <button type="button" className="mini-btn alt acp-tracking-division-unit"
                aria-label={`${label}: usar ${percentage === undefined ? 'percentual' : 'valor nominal'}`}
                title={percentage === undefined ? 'Preencher como percentual do total do projeto' : 'Preencher como valor nominal'}
                disabled={percentage === undefined && !canUsePercentage}
                onClick={() => {
                  if (percentage === undefined && canUsePercentage) setPercentage(candidate.key, field, percentageForProjectValue(item[field], total));
                  else if (percentage !== undefined) {
                    update(candidate.key, { [field]: calculated == null ? '' : String(calculated) });
                    setPercentage(candidate.key, field, null);
                  }
                }}>{percentage === undefined ? '%' : field === 'plannedCost' || field === 'plannedRevenue' ? 'R$' : field === 'plannedHours' ? 'h' : 'dias'}</button>
            </div>
            {percentage !== undefined ? <small className="acp-tracking-division-hint">{calculated == null ? 'Informe um percentual de 0% a 100%.'
              : `Calculado: ${formatPlannedValue(field, calculated)} de ${formatPlannedValue(field, total!)}`}</small>
              : <small className="acp-tracking-division-hint">{canUsePercentage ? `Total do projeto: ${formatPlannedValue(field, total)}`
                : projectTotalLoading ? 'Carregando total do projeto…' : projectTotalError ? 'Total do projeto indisponível.' : 'Sem total do projeto para calcular %.'}</small>}
          </div>;
        })}
      </div> : null}
    </div>;
  }

  return <Modal open onClose={onClose} ariaLabelledBy="acp-tracking-divisions-title" panelClassName="modal-card acp-manage-card acp-tracking-divisions-panel">
    <form className="acp-manage" onSubmit={submit}>
      <header className="acp-manage-head">
        <h2 id="acp-tracking-divisions-title" className="sec">Divisões do acompanhamento</h2>
        <button type="button" className="mini-btn alt" aria-label="Fechar divisões" onClick={onClose}>✕</button>
      </header>
      <div className="acp-manage-body">
        <p className="acp-tracking-divisions-intro">Ative as abas desejadas por escopo e equipamento do cliente. Em cada meta, use o botão % para calcular pelo total do projeto. Dias calculados são arredondados para o inteiro mais próximo. Sem data final, o período vai até hoje.</p>
        {data.candidates.length ? data.candidates.map(scope => <section className="acp-tracking-division-scope" key={scope.key}>
          <div className="acp-tracking-division-scope-head">
            <h3>{scope.label}</h3>
            <small>{scope.equipments?.length ?? 0} equipamento{scope.equipments?.length === 1 ? '' : 's'}</small>
          </div>
          {fields(scope)}
          {(scope.equipments ?? []).length ? <div className="acp-tracking-division-system-list">
            {(scope.equipments ?? []).map(fields)}
          </div> : null}
        </section>) : <p className="placeholder-copy">Nenhum escopo foi cadastrado no cronograma.</p>}
        {error ? <p role="alert" className="form-error">{error}</p> : null}
      </div>
      <footer className="acp-manage-foot">
        <button type="button" className="mini-btn alt" onClick={onClose}>Cancelar</button>
        <button type="submit" className="mini-btn" disabled={save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar divisões'}</button>
      </footer>
    </form>
  </Modal>;
}
