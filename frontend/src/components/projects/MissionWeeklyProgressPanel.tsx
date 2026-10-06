import { BrandLoading } from '../brand/BrandLoading';
import { useId, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { buildWeeklyProgressComparison, corporateToday, weekStartKey, weeklyTargetDefinition, weeklyTargetGoalMetric, WEEKLY_TARGET_SERVICES, type WeeklyTargetDeleteInput, type WeeklyTargetInput, type WeeklyProgressComparison } from '../../../../shared/modules/mission-weekly-progress.js';
import { deleteWeeklyProgressTarget, listWeeklyProgressTargets, saveWeeklyProgressTarget, weeklyTargetPath, type WeeklyTargetOwner } from '../../api/weeklyProgressTargets';
import { ApiClientError } from '../../api/client';
import type { ProgressHistoryPoint } from '../../api/acompanhamentoComercial';
import { Alert, Field, Input } from '../ui/ds';
import { WorkflowButton as Button } from '../ui/WorkflowButton';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { formatDateOnly } from '../../utils/dateOnly';
import { WeeklyTargetEditor } from './WeeklyTargetEditor';
import { newScenario, onlyFilteringGoals, scenarioToDraft, type TargetDraft } from './weeklyTargetDraft';
import { WeeklyGoalResults, WeeklyTargetConfiguration } from './WeeklyTargetDisplay';
import { weeklyValueLabel } from './weeklyTargetPresentation';
import { ProjectDetailSection } from './ProjectDetailSection';
import { ProjectDetailDisclosure } from './ProjectDetailDisclosure';
import './mission-weekly-progress.css';

const STATUS_LABEL: Record<WeeklyProgressComparison['status'], string> = {
  ON_TARGET: 'Dentro da meta', ABOVE: 'Acima da meta', BELOW: 'Abaixo da meta',
  NO_TARGET: 'Sem meta definida', NO_DATA: 'Sem dados suficientes', NO_RULE: 'Sem cenário aplicável', PLANNED: 'Semana futura'
};
function comparisonValue(row: WeeklyProgressComparison, key: 'plannedValue' | 'actualValue' | 'differenceValue', showScenario = false) {
  return <div>{row.mixedUnits ? 'Por serviço' : weeklyValueLabel(row[key], row.metric, key === 'differenceValue')}{row.goals.length > 1 ? row.goals.map(goal =>
    <small key={goal.serviceType}>{WEEKLY_TARGET_SERVICES[goal.serviceType!]}: {weeklyValueLabel(goal[key], goal.metric, key === 'differenceValue')}</small>) : null}{showScenario && row.scenarioName ? <small>{row.scenarioName}</small> : null}</div>;
}

export function MissionWeeklyProgressPanel({ owner, progressHistory, canManage = false, workflowAppearance = false, compact = false }: {
  owner: WeeklyTargetOwner;
  progressHistory?: ProgressHistoryPoint[];
  canManage?: boolean;
  workflowAppearance?: boolean;
  compact?: boolean;
}) {
  const id = useId();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<TargetDraft | null>(null);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [showDetails, setShowDetails] = useState(!compact);
  const [deleteTarget, setDeleteTarget] = useState<WeeklyTargetDeleteInput | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const targetsQuery = useQuery({
    queryKey: ['mission-weekly-targets', weeklyTargetPath(owner), progressHistory === undefined],
    queryFn: () => listWeeklyProgressTargets(owner, progressHistory === undefined),
    staleTime: 30_000
  });
  const targets = targetsQuery.data?.targets ?? [];
  const rows = buildWeeklyProgressComparison({ targets, progressHistory: progressHistory ?? targetsQuery.data?.progressHistory ?? [], serviceHistory: targetsQuery.data?.serviceHistory ?? [] });
  const currentWeek = weekStartKey(corporateToday())!;
  const closedWithTarget = rows.filter(row => !row.inProgress && row.weekStartDate < currentWeek && ['ON_TARGET', 'ABOVE', 'BELOW'].includes(row.status));
  const achieved = closedWithTarget.filter(row => ['ON_TARGET', 'ABOVE'].includes(row.status)).length;
  const current = rows.find(row => row.weekStartDate === currentWeek)!;
  const latestFor = (week: string) => targets.filter(target => target.weekStartDate === week).sort((a, b) => b.revision - a.revision)[0];
  const editWeek = (week: string) => {
    const target = latestFor(week);
    const definition = target && !target.isDeleted ? weeklyTargetDefinition(target) : null;
    setDraft({ weekStartDate: week, metric: definition?.metric ?? 'PCT_POINTS', basis: definition?.basis ?? 'WEEK_TOTAL',
      referenceDayHours: String(definition?.referenceDayHours ?? targetsQuery.data?.defaultReferenceDayHours ?? ''),
      scenarios: definition ? definition.scenarios.map(scenarioToDraft) : [newScenario()], expectedRevision: target?.revision ?? 0 });
    setError('');
  };
  const save = useMutation({
    mutationFn: (payload: WeeklyTargetInput) => saveWeeklyProgressTarget(owner, payload),
    onSuccess: async () => {
      setDraft(null);
      setError('');
      await queryClient.invalidateQueries({ queryKey: ['mission-weekly-targets'] });
    },
    onError: async (cause: Error) => {
      setError(cause.message || 'Não foi possível salvar a meta.');
      if (cause instanceof ApiClientError && cause.status === 409) {
        await queryClient.invalidateQueries({ queryKey: ['mission-weekly-targets'] });
        setDraft(null);
      }
    }
  });
  const remove = useMutation({
    mutationFn: (payload: WeeklyTargetDeleteInput) => deleteWeeklyProgressTarget(owner, payload),
    onSuccess: async (_, payload) => {
      setDeleteTarget(null);
      setDeleteError('');
      setError('');
      setDraft(currentDraft => currentDraft?.weekStartDate === payload.weekStartDate ? null : currentDraft);
      await queryClient.invalidateQueries({ queryKey: ['mission-weekly-targets'] });
    },
    onError: async (cause: Error) => {
      const message = cause.message || 'Não foi possível excluir a meta.';
      if (cause instanceof ApiClientError && (cause.status === 409 || cause.status === 404)) {
        setDeleteTarget(null);
        setError(message);
        await queryClient.invalidateQueries({ queryKey: ['mission-weekly-targets'] });
      } else setDeleteError(message);
    }
  });
  const busy = save.isPending || remove.isPending;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft || !canManage || busy) return;
    const scenarios = draft.scenarios.map(scenario => ({ name: scenario.name, condition: scenario.condition, goals: scenario.goals.map(goal => ({ serviceType: goal.serviceType, value: Number(goal.value.replace(',', '.')) })) }));
    const referenceDayHours = Number(draft.referenceDayHours.replace(',', '.'));
    if (!draft.weekStartDate || draft.scenarios.some(scenario => !scenario.name.trim() || !scenario.goals.length
      || scenario.goals.some(goal => !goal.value.trim()) || (scenario.condition.kind === 'SERVICE_SET' && !scenario.condition.serviceTypes.length))
      || scenarios.some(scenario => scenario.goals.some(goal => !Number.isFinite(goal.value) || goal.value < 0
        || goal.value > (draft.metric === 'PCT_POINTS' ? 100 : 999999999.99) || Math.abs(goal.value * 100 - Math.round(goal.value * 100)) > 1e-5
        || (weeklyTargetGoalMetric(draft.metric, goal, scenario.condition) === 'UN' && draft.basis === 'WEEK_TOTAL' && !Number.isInteger(goal.value))))
      || (draft.basis === 'PER_PRODUCTIVE_DAY' && (!draft.referenceDayHours.trim() || !Number.isFinite(referenceDayHours)
        || referenceDayHours <= 0 || referenceDayHours > 24 || Math.abs(referenceDayHours * 100 - Math.round(referenceDayHours * 100)) > 1e-5))) {
      setError('Preencha a semana, as condições e os valores de cada meta. Use até duas casas decimais e uma jornada de referência entre 0,01 e 24 horas.');
      return;
    }
    save.mutate(draft.metric === 'PCT_POINTS'
      ? { weekStartDate: draft.weekStartDate, plannedPctPoints: scenarios[0].goals[0].value, expectedRevision: draft.expectedRevision }
      : { weekStartDate: draft.weekStartDate, definition: { metric: onlyFilteringGoals(draft) ? 'L' : draft.metric, basis: draft.basis,
        ...(draft.basis === 'PER_PRODUCTIVE_DAY' ? { referenceDayHours } : {}), scenarios }, expectedRevision: draft.expectedRevision });
  }

  return <section className="fv-ds mission-weekly-progress" aria-label="Metas semanais de avanço" onClick={event => event.stopPropagation()}>
    <ProjectDetailSection collapsible={compact} label="Meta semanal de avanço" header={<>
      <header className="mission-weekly-progress-head">
        <strong>Meta semanal de avanço</strong>
        {compact && targetsQuery.isSuccess ? <span className="mission-weekly-status status-on_target" data-acp-weekly-wins>{achieved} de {closedWithTarget.length} semanas com meta atingida</span> : null}
        {canManage ? <Button workflowAppearance={workflowAppearance} workflowVariant="mini" size="sm" variant="secondary" disabled={targetsQuery.isPending || targetsQuery.isError || busy} onClick={() => editWeek(currentWeek)}>Definir meta</Button> : null}
      </header>

    </>}>
      {!compact ? <p className="mission-weekly-progress-hint">Segunda a domingo · Metas em p.p., metros, litros ou unidades de sistema. Valores gerais, por tipo de serviço ou por colaborador produtivo/dia. De 30% para 40% = 10 p.p.</p> : null}
      {targetsQuery.isPending ? <p role="status"><BrandLoading label="Carregando metas semanais" inline size="sm" /></p> : targetsQuery.isError ? <Alert tone="warning" title="Não foi possível carregar as metas." action={<Button workflowAppearance={workflowAppearance} workflowVariant="mini" size="sm" variant="secondary" onClick={() => targetsQuery.refetch()}>Tentar novamente</Button>} /> : <>
        <ProjectDetailDisclosure disabled={!compact} label="Consultar a semana atual" compact><div className="mission-weekly-progress-current">
          <span>Semana de {formatDateOnly(currentWeek)} · Em andamento</span>
          <dl>
            <div><dt>Previsto</dt><dd>{current.mixedUnits ? comparisonValue(current, 'plannedValue') : weeklyValueLabel(current.plannedValue, current.metric)}</dd></div>
            <div><dt>Realizado</dt><dd>{current.mixedUnits ? comparisonValue(current, 'actualValue') : weeklyValueLabel(current.actualValue, current.metric)}</dd></div>
            <div><dt>Diferença</dt><dd>{current.mixedUnits ? comparisonValue(current, 'differenceValue') : weeklyValueLabel(current.differenceValue, current.metric, true)}</dd></div>
          </dl>
          <span className={`mission-weekly-status status-${current.status.toLowerCase()}`}>{STATUS_LABEL[current.status]}</span>
          {current.metric !== 'PCT_POINTS' ? <WeeklyGoalResults row={current} /> : null}
          {current.target?.definition ? <details><summary>Regras cadastradas para a semana</summary><WeeklyTargetConfiguration target={current.target} /></details> : null}
        </div></ProjectDetailDisclosure>
        {draft && canManage ? <form className="mission-weekly-progress-form" onSubmit={submit}>
          <Field id={`${id}-week`} label="Semana" required helperText="Selecione um dia; a semana começa na segunda-feira."><Input type="date" required value={draft.weekStartDate} disabled={busy} onChange={event => {
            const week = weekStartKey(event.target.value) ?? '';
            setDraft(currentDraft => currentDraft ? { ...currentDraft, weekStartDate: week,
              expectedRevision: week && week !== currentDraft.weekStartDate ? latestFor(week)?.revision ?? 0 : currentDraft.expectedRevision } : null);
            setError('');
          }} /></Field>
          <WeeklyTargetEditor id={id} draft={draft} disabled={busy} onChange={setDraft} />
          <div className="mission-weekly-progress-actions"><Button workflowAppearance={workflowAppearance} workflowVariant="primary" type="submit" size="sm" disabled={busy}>{save.isPending ? 'Salvando…' : 'Salvar meta'}</Button><Button workflowAppearance={workflowAppearance} workflowVariant="mini" type="button" size="sm" variant="secondary" disabled={busy} onClick={() => { setDraft(null); setError(''); }}>Cancelar</Button></div>
        </form> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {compact ? <Button size="sm" variant="secondary" workflowAppearance={workflowAppearance} aria-expanded={showDetails} onClick={() => setShowDetails(!showDetails)}>{showDetails ? 'Recolher detalhes e edição' : 'Detalhes e edição das metas'}</Button> : null}
        <div className="mission-weekly-progress-table" role="region" aria-label="Comparativo semanal de avanço" tabIndex={0}>
          <table>
            <thead><tr><th scope="col">Semana</th><th scope="col">Avanço previsto</th><th scope="col">Avanço realizado</th><th scope="col">Diferença</th><th scope="col">Situação</th>{showDetails ? <th scope="col">Meta registrada</th> : null}{canManage && showDetails ? <th scope="col">Ação</th> : null}</tr></thead>
            <tbody>{(showAll ? rows : rows.slice(0, 12)).map(row => {
              const revisions = targets.filter(target => target.weekStartDate === row.weekStartDate).sort((a, b) => b.revision - a.revision);
              return <tr key={row.weekStartDate}>
                <th scope="row">{formatDateOnly(row.weekStartDate)}<small>até {formatDateOnly(row.weekEndDate)}{row.inProgress ? ' · Em andamento' : ''}</small></th>
                <td data-label="Avanço previsto">{comparisonValue(row, 'plannedValue', true)}</td><td data-label="Avanço realizado">{comparisonValue(row, 'actualValue')}</td><td data-label="Diferença">{comparisonValue(row, 'differenceValue')}</td>
                <td data-label="Situação"><span className={`mission-weekly-status status-${compact && row.inProgress && row.status === 'BELOW' ? 'planned' : row.status.toLowerCase()}`}>{!compact ? STATUS_LABEL[row.status] : row.inProgress && row.status === 'BELOW' ? 'Em andamento' : ['ON_TARGET', 'ABOVE'].includes(row.status) ? 'Meta atingida' : row.status === 'BELOW' ? 'Meta não atingida' : STATUS_LABEL[row.status]}</span></td>
                {showDetails ? <td data-label="Meta registrada">{revisions.length ? <div className="mission-weekly-record">{revisions[0].isDeleted ? <strong>Meta excluída</strong> : null}<span>{revisions[0].author.name}</span><small>{new Date(revisions[0].createdAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</small><details><summary>{revisions.length > 1 ? `${revisions.length} versões` : 'Ver regras'}</summary>{revisions.map(revision => <div key={revision.id}><small>Versão {revision.revision} · {revision.author.name} · {new Date(revision.createdAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</small>{revision.isDeleted ? <span>Meta excluída</span> : <WeeklyTargetConfiguration target={revision} />}</div>)}</details></div> : '—'}</td> : null}
                {canManage && showDetails ? <td data-label="Ação"><div className="mission-weekly-row-actions"><Button workflowAppearance={workflowAppearance} workflowVariant="mini" size="sm" variant="secondary" disabled={busy} aria-label={`${row.target ? 'Editar' : 'Definir'} meta da semana de ${formatDateOnly(row.weekStartDate)}`} onClick={() => editWeek(row.weekStartDate)}>{row.target ? 'Editar' : 'Definir'}</Button>{row.target ? <Button workflowAppearance={workflowAppearance} workflowVariant="danger" size="sm" variant="danger" disabled={busy} aria-label={`Excluir meta da semana de ${formatDateOnly(row.weekStartDate)}`} onClick={() => {
                  setDeleteError('');
                  setDeleteTarget({ weekStartDate: row.weekStartDate, expectedRevision: row.target!.revision });
                }}>Excluir</Button> : null}</div></td> : null}
              </tr>;
            })}</tbody>
          </table>
        </div>
        {rows.length > 12 ? <Button workflowAppearance={workflowAppearance} workflowVariant="mini" size="sm" variant="secondary" onClick={() => setShowAll(!showAll)}>{showAll ? 'Mostrar últimas 12 semanas' : `Ver todas as ${rows.length} semanas`}</Button> : null}
        <ProjectDetailDisclosure disabled={!compact} label="Como a meta é calculada" compact>
      {compact ? <p className="mission-weekly-progress-hint">Segunda a domingo · Metas em p.p., metros, litros ou unidades de sistema. Valores gerais, por tipo de serviço ou por colaborador produtivo/dia. De 30% para 40% = 10 p.p.</p> : null}
        <p className="mission-weekly-progress-hint">Diferença = realizado − previsto. Quantidades físicas usam serviços finalizados. Os cenários também consideram serviços em andamento nos RDOs. Metas por colaborador/dia usam as horas produtivas registradas no RDO, por serviço, divididas pela jornada de referência. Cada serviço deve cumprir sua meta. A semana atual ainda está em andamento e é recalculada conforme os RDOs.</p>
        </ProjectDetailDisclosure>
      </>}
    </ProjectDetailSection>
    <ConfirmDialog open={Boolean(deleteTarget) && canManage} appearance="design-system" title="Excluir meta semanal"
      description="A semana ficará sem meta definida. As versões anteriores e o registro da exclusão permanecerão no histórico."
      highlight={deleteTarget ? `Semana de ${formatDateOnly(deleteTarget.weekStartDate)}` : undefined}
      confirmLabel={remove.isPending ? 'Excluindo…' : 'Excluir meta'} confirmDisabled={busy} errorMessage={deleteError}
      onCancel={() => { if (!remove.isPending) { setDeleteTarget(null); setDeleteError(''); } }}
      onConfirm={() => { if (deleteTarget && canManage && !busy) remove.mutate(deleteTarget); }} />
  </section>;
}
