import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { saveTrackingDivisions, type TrackingDivision, type TrackingDivisionCandidate, type TrackingDivisionsResponse } from '../../api/acompanhamentoComercial';
import { Modal } from '../ui/Modal';

type Draft = { enabled: boolean; startDate: string; endDate: string; plannedCost: string; plannedRevenue: string; plannedHours: string; plannedDays: string };
const emptyDraft = (): Draft => ({ enabled: false, startDate: '', endDate: '', plannedCost: '', plannedRevenue: '', plannedHours: '', plannedDays: '' });
const plannedFields = [
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

export function ProjectTrackingDivisionsPanel({ projectId, data, onClose }: {
  projectId: string;
  data: TrackingDivisionsResponse;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<string, Draft>>(() => draftFromRows(data.divisions));
  const [error, setError] = useState<string | null>(null);
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

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const rows: TrackingDivision[] = [];
    for (const candidate of data.candidates.flatMap(scope => [scope, ...(scope.equipments ?? [])])) {
      const item = draft[candidate.key];
      if (!item?.enabled) continue;
      if (!item.startDate) { setError(`Informe a data inicial de ${candidate.label}.`); return; }
      if (item.endDate && item.endDate < item.startDate) { setError(`Confira a data final de ${candidate.label}.`); return; }
      const planned = Object.fromEntries(plannedFields.map(([field]) => [field, numeric(item[field])]));
      if (Object.values(planned).some(value => value != null && (!Number.isFinite(value) || value < 0))) {
        setError(`Confira os valores previstos de ${candidate.label}.`); return;
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
        {plannedFields.map(([field, label]) => <div className="field-group" key={field}>
          <label htmlFor={fieldId(field)}>{label}</label>
          <input id={fieldId(field)} type="number" min="0" step={field === 'plannedDays' ? '1' : '0.01'} inputMode={field === 'plannedDays' ? 'numeric' : 'decimal'}
            placeholder="—" value={item[field]} onChange={event => update(candidate.key, { [field]: event.target.value })} />
        </div>)}
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
        <p className="acp-tracking-divisions-intro">Ative as abas desejadas por escopo e equipamento do cliente. Os sistemas de cada equipamento ficam agrupados. Sem data final, o período vai até hoje.</p>
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
