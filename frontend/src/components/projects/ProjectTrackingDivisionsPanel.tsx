import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { getProjectDetail, getPlannedScope, saveTrackingDivision, saveTrackingDivisions, type TrackingDivision, type TrackingDivisionInput, type TrackingDivisionCandidate, type TrackingDivisionsResponse } from '../../api/acompanhamentoComercial';
import { percentageForProjectValue, percentageOfProjectTotal, type TrackingDivisionPlannedField } from '../../utils/trackingDivisionPercentage';
import { Modal } from '../ui/Modal';
import { Alert, Button, EmptyState, Field, Input, Switch } from '../ui/ds';
import './ProjectTrackingDivisionsPanel.ds.css';

type Draft = { enabled: boolean; startDate: string; endDate: string; mobilizationDate: string; plannedCost: string; plannedRevenue: string; plannedHours: string; plannedDays: string };
const emptyDraft = (): Draft => ({ enabled: false, startDate: '', endDate: '', mobilizationDate: '', plannedCost: '', plannedRevenue: '', plannedHours: '', plannedDays: '' });
const plannedFields: ReadonlyArray<readonly [TrackingDivisionPlannedField, string]> = [
  ['plannedCost', 'Custo previsto (R$)'],
  ['plannedRevenue', 'Receita prevista (R$)'],
  ['plannedHours', 'Horas previstas'],
  ['plannedDays', 'Dias previstos']
] as const;

function draftFromRows(rows: TrackingDivision[]): Record<string, Draft> {
  return Object.fromEntries(rows.map(row => [row.key, {
    enabled: true, startDate: row.startDate, endDate: row.endDate ?? '',
    mobilizationDate: row.mobilizationDate ?? '',
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

export function ProjectTrackingDivisionsPanel({ projectId, data, selectedDivisionKey, onClose }: {
  projectId: string;
  data: TrackingDivisionsResponse;
  selectedDivisionKey?: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<string, Draft>>(() => draftFromRows(data.divisions));
  const [percentDraft, setPercentDraft] = useState<Record<string, Partial<Record<TrackingDivisionPlannedField, string>>>>({});
  const [error, setError] = useState<string | null>(null);
  const candidates = data.candidates.flatMap(scope => [scope, ...(scope.equipments ?? [])]);
  const selectedCandidate = candidates.find(candidate => candidate.key === selectedDivisionKey);
  const visibleScopes = selectedDivisionKey
    ? data.candidates.filter(scope => scope.key === selectedDivisionKey || scope.equipments?.some(item => item.key === selectedDivisionKey))
    : data.candidates;
  const { data: projectTotal, isPending: projectTotalLoading, isError: projectTotalError } = useQuery({
    queryKey: ['project-detail', projectId],
    queryFn: () => getProjectDetail(projectId)
  });
  const { data: scope } = useQuery({ queryKey: ['planned-scope', projectId], queryFn: () => getPlannedScope(projectId) });
  const totals: Record<TrackingDivisionPlannedField, number | null> = {
    plannedCost: projectTotal?.consumo.previstoIntegral ?? projectTotal?.consumo.previsto ?? null,
    plannedRevenue: projectTotal?.faturamento.previstoIntegral == null ? null : Number(projectTotal.faturamento.previstoIntegral),
    plannedHours: scope ? [...scope.normalHours, ...scope.overtime].reduce((sum, row) => sum + Number(row.hours), 0) : null,
    plannedDays: projectTotal?.fullPlannedDays ?? projectTotal?.diasCorridos.planned ?? null
  };
  const save = useMutation({
    mutationFn: (rows: TrackingDivisionInput[]) => {
      if (!selectedDivisionKey) return saveTrackingDivisions(projectId, rows);
      const row = rows.find(item => item.key === selectedDivisionKey);
      if (!row) throw new Error('Divisão não encontrada.');
      return saveTrackingDivision(projectId, row);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tracking-divisions', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['project-detail', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['project-progress', projectId] }),
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
    const rows: TrackingDivisionInput[] = [];
    for (const candidate of candidates) {
      if (selectedDivisionKey && candidate.key !== selectedDivisionKey) continue;
      const item = draft[candidate.key];
      if (!item?.enabled) continue;
      if (!item.startDate) { setError(`Informe o início do escopo de ${candidate.label}.`); return; }
      if (!item.mobilizationDate) { setError(`Informe a mobilização do escopo de ${candidate.label}.`); return; }
      if (item.endDate && item.endDate < item.startDate) { setError(`Confira o fim do escopo de ${candidate.label}.`); return; }
      if (item.endDate && item.mobilizationDate > item.endDate) { setError(`Confira a mobilização do escopo de ${candidate.label}.`); return; }
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
        mobilizationDate: item.mobilizationDate,
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
      {!selectedDivisionKey ? <Switch
        checked={item.enabled}
        disabled={save.isPending}
        label={candidate.kind === 'SCOPE' ? 'Aba do escopo' : candidate.label}
        description={candidate.kind === 'EQUIPMENT' ? `${candidate.systemCount ?? 0} sistema${candidate.systemCount === 1 ? '' : 's'} agrupado${candidate.systemCount === 1 ? '' : 's'}` : undefined}
        onChange={event => update(candidate.key, { enabled: event.target.checked })}
      /> : null}
      {item.enabled ? <div className="acp-tracking-division-fields">
        <Field id={fieldId('start')} label="Início do escopo" required helperText="Data de corte para considerar os gastos e faturamentos deste escopo. Preencha manualmente.">
          <Input size="sm" type="date" required disabled={save.isPending} value={item.startDate} onChange={event => update(candidate.key, { startDate: event.target.value })} />
        </Field>
        <Field id={fieldId('end')} label="Fim do escopo" optionalText="Opcional" helperText="Fim deste escopo. Se vazio, considera até hoje, sem usar o fim do projeto completo.">
          <Input size="sm" type="date" min={item.startDate || undefined} disabled={save.isPending} value={item.endDate} onChange={event => update(candidate.key, { endDate: event.target.value })} />
        </Field>
        <Field id={fieldId('mobilization')} label="Mobilização do escopo" required helperText="Início da contagem dos dias corridos e da apuração dos colaboradores alocados neste escopo. Preencha manualmente.">
          <Input size="sm" type="date" required max={item.endDate || undefined} disabled={save.isPending} value={item.mobilizationDate} onChange={event => update(candidate.key, { mobilizationDate: event.target.value })} />
        </Field>
        {plannedFields.map(([field, label]) => {
          const percentage = percentDraft[candidate.key]?.[field];
          const total = totals[field];
          const canUsePercentage = total != null && Number.isFinite(total) && total > 0;
          const calculated = percentage === undefined ? null : percentageOfProjectTotal(total, percentage, field);
          const helperText = percentage !== undefined
            ? calculated == null ? 'Informe um percentual de 0% a 100%.'
              : `Calculado: ${formatPlannedValue(field, calculated)} de ${formatPlannedValue(field, total!)}`
            : canUsePercentage ? `Total do projeto: ${formatPlannedValue(field, total)}`
              : projectTotalLoading ? 'Carregando total do projeto…'
                : projectTotalError ? 'Total do projeto indisponível.' : 'Sem total do projeto para calcular %.';
          return <Field id={fieldId(field)} label={label} helperText={helperText} key={field}>
            <div className="acp-tracking-division-input-row">
              <Input id={`${fieldId(field)}-control`} size="sm" type="number" min="0" max={percentage === undefined ? undefined : 100}
                step={percentage === undefined ? field === 'plannedDays' ? '1' : '0.01' : 'any'}
                inputMode={field === 'plannedDays' && percentage === undefined ? 'numeric' : 'decimal'}
                placeholder={percentage === undefined ? '—' : '%'} disabled={save.isPending} value={percentage === undefined ? item[field] : percentage}
                onChange={event => percentage === undefined
                  ? update(candidate.key, { [field]: event.target.value })
                  : setPercentage(candidate.key, field, event.target.value)} />
              <Button type="button" size="sm" variant="secondary" className="acp-tracking-division-unit"
                aria-label={`${label}: usar ${percentage === undefined ? 'percentual' : 'valor nominal'}`}
                title={percentage === undefined ? 'Preencher como percentual do total do projeto' : 'Preencher como valor nominal'}
                disabled={save.isPending || (percentage === undefined && !canUsePercentage)}
                onClick={() => {
                  if (percentage === undefined && canUsePercentage) setPercentage(candidate.key, field, percentageForProjectValue(item[field], total));
                  else if (percentage !== undefined) {
                    update(candidate.key, { [field]: calculated == null ? '' : String(calculated) });
                    setPercentage(candidate.key, field, null);
                  }
                }}>{percentage === undefined ? '%' : field === 'plannedCost' || field === 'plannedRevenue' ? 'R$' : field === 'plannedHours' ? 'h' : 'dias'}</Button>
            </div>
          </Field>;
        })}
      </div> : null}
    </div>;
  }

  return <Modal open onClose={onClose} appearance="design-system" title={selectedDivisionKey ? `Cronograma da divisão — ${selectedCandidate?.label ?? 'Divisão'}` : 'Divisões do acompanhamento'} size="lg"
    panelClassName="acp-tracking-divisions-panel" fullscreenOnMobile={false} closeOnEscape={!save.isPending}
    footer={<div className="acp-tracking-divisions-actions">
      <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={save.isPending}>Cancelar</Button>
      <Button type="submit" size="sm" form="acp-tracking-divisions-form" loading={save.isPending}>{selectedDivisionKey ? 'Salvar divisão' : 'Salvar divisões'}</Button>
    </div>}>
    <form id="acp-tracking-divisions-form" className="acp-tracking-divisions-form" onSubmit={submit}>
      <p className="acp-tracking-divisions-intro">{selectedDivisionKey ? 'Edite as datas e metas desta divisão. Sem data final, o período vai até hoje.' : 'Ative as abas desejadas por escopo e equipamento do cliente. Os sistemas de cada equipamento ficam agrupados. Em cada meta, use o botão % para calcular pelo total do projeto. Dias calculados são arredondados para o inteiro mais próximo. Sem data final, o período vai até hoje.'}</p>
      <p className="acp-tracking-divisions-intro">As datas de cada divisão são independentes das datas do projeto completo e das demais divisões.</p>
      <p className="acp-tracking-divisions-intro">Cadastre os valores integrais das metas. O percentual da proposta definido no cronograma será aplicado aos indicadores de cada divisão.</p>
      {visibleScopes.length ? visibleScopes.map(scope => <section className="acp-tracking-division-scope" key={scope.key}>
          <div className="acp-tracking-division-scope-head">
            <h3>{scope.label}</h3>
            <small>{scope.equipments?.length ?? 0} equipamento{scope.equipments?.length === 1 ? '' : 's'}</small>
          </div>
          {!selectedDivisionKey || scope.key === selectedDivisionKey ? fields(scope) : null}
          {(scope.equipments ?? []).some(item => !selectedDivisionKey || item.key === selectedDivisionKey) ? <div className="acp-tracking-division-system-list">
            {(scope.equipments ?? []).filter(item => !selectedDivisionKey || item.key === selectedDivisionKey).map(fields)}
          </div> : null}
        </section>) : <EmptyState title="Nenhum escopo cadastrado" description="Cadastre o escopo previsto no cronograma para criar divisões." />}
      {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
    </form>
  </Modal>;
}
