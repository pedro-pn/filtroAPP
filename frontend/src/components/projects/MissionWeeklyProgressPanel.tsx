import { SortableTable } from '../ui/SortableTable';
import { BrandLoading } from '../brand/BrandLoading';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { corporateToday, currentWeeklyProgressComparison, type WeeklyTargetDeleteInput, type WeeklyProgressComparison } from '../../../../shared/modules/mission-weekly-progress.js';
import { deleteWeeklyProgressTarget, type WeeklyTargetOwner } from '../../api/weeklyProgressTargets';
import { ApiClientError } from '../../api/client';
import type { ProgressHistoryPoint } from '../../api/acompanhamentoComercial';
import { Alert } from '../ui/ds';
import { WorkflowButton as Button } from '../ui/WorkflowButton';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { formatDateOnly } from '../../utils/dateOnly';
import { WeeklyGoalResults, WeeklyTargetConfiguration } from './WeeklyTargetDisplay';
import { WeeklyTargetDialog, type WeeklyTargetRequest } from './WeeklyTargetDialog';
import { attendanceBalanceLabel, weeklyGoalLabel, weeklyValueLabel, WEEKLY_STATUS_LABEL as STATUS_LABEL } from './weeklyTargetPresentation';
import { ProjectDetailSection } from './ProjectDetailSection';
import { ProjectDetailDisclosure } from './ProjectDetailDisclosure';
import { useWeeklyTargets } from './useWeeklyTargets';
import './mission-weekly-progress.css';

const REACHED = ['ON_TARGET', 'ABOVE'];
const JOURNEY_HINT = 'Metas por colaborador/dia contam cada pessoa da equipe do RDO como 1 em cada dia com RDO do serviço, sem considerar horários. "Qualquer serviço" soma a medida de todos os serviços.';
const EVALUATED = ['ON_TARGET', 'ABOVE', 'BELOW', 'PARTIAL'];
function comparisonValue(row: WeeklyProgressComparison, key: 'plannedValue' | 'actualValue' | 'differenceValue', showScenario = false) {
  return <div>{row.mixedUnits ? row.goals.some(goal => goal.kind && goal.kind !== 'SERVICE') ? 'Por meta' : 'Por serviço' : weeklyValueLabel(row[key], row.metric, key === 'differenceValue')}{row.goals.length > 1 ? row.goals.map(goal =>
    <small key={`${goal.kind ?? ''}-${goal.serviceType ?? ''}`}>{weeklyGoalLabel(goal)}: {weeklyValueLabel(goal[key], goal.metric, key === 'differenceValue')}</small>) : null}{showScenario && row.scenarioName ? <small>{row.scenarioName}</small> : null}</div>;
}

export function MissionWeeklyProgressPanel({ owner, progressHistory, canManage = false, workflowAppearance = false, compact = false }: {
  owner: WeeklyTargetOwner;
  progressHistory?: ProgressHistoryPoint[];
  canManage?: boolean;
  workflowAppearance?: boolean;
  compact?: boolean;
}) {
  const queryClient = useQueryClient();
  const [request, setRequest] = useState<WeeklyTargetRequest | null>(null);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [showDetails, setShowDetails] = useState(!compact);
  const [deleteTarget, setDeleteTarget] = useState<WeeklyTargetDeleteInput | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const { query: targetsQuery, targets, rows, workdays } = useWeeklyTargets(owner, progressHistory);
  const today = corporateToday();
  const closedWithTarget = rows.filter(row => row.periodEndDate < today && EVALUATED.includes(row.status));
  const achieved = closedWithTarget.filter(row => REACHED.includes(row.status)).length;
  const current = currentWeeklyProgressComparison(rows, today)!;
  const hasAttendance = rows.some(row => row.metric === 'COLLABORATORS' || row.goals.some(goal => goal.kind === 'ATTENDANCE'));
  const progressOnly = rows.every(row => !row.target || (row.metric === 'PCT_POINTS' && !row.mixedUnits));
  const plannedHeading = progressOnly ? 'Avanço previsto' : 'Previsto';
  const actualHeading = progressOnly ? 'Avanço realizado' : 'Realizado';
  const title = progressOnly ? 'Meta semanal de avanço' : 'Metas da semana';
  const editWeek = (row: WeeklyProgressComparison) => {
    setRequest({ weekStartDate: row.weekStartDate, referenceDate: row.periodStartDate <= today && today <= row.periodEndDate ? today : row.periodStartDate });
    setError('');
  };
  const remove = useMutation({
    mutationFn: (payload: WeeklyTargetDeleteInput) => deleteWeeklyProgressTarget(owner, payload),
    onSuccess: async () => {
      setDeleteTarget(null);
      setDeleteError('');
      setError('');
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
  const busy = remove.isPending;

  return <section className="fv-ds mission-weekly-progress" aria-label="Metas semanais de avanço" onClick={event => event.stopPropagation()}>
    <ProjectDetailSection collapsible={compact} label={title} header={<>
      <header className="mission-weekly-progress-head">
        <strong>{title}</strong>
        {compact && targetsQuery.isSuccess ? <span className="mission-weekly-status status-on_target" data-acp-weekly-wins>{achieved} de {closedWithTarget.length} semanas com meta atingida</span> : null}
        {canManage ? <Button workflowAppearance={workflowAppearance} workflowVariant="mini" size="sm" variant="secondary" disabled={targetsQuery.isPending || targetsQuery.isError || busy} onClick={() => editWeek(current)}>Definir meta</Button> : null}
      </header>

    </>}>
      {!compact ? <p className="mission-weekly-progress-hint">{hasAttendance
      ? 'Metas por serviço (metros, litros ou unidades), de avanço do projeto em p.p. ou de equipe mínima por dia. Várias metas podem exigir todas (E) ou pelo menos uma (OU).'
      : 'Metas por serviço (metros, litros ou unidades) ou de avanço do projeto em p.p. Várias metas podem exigir todas (E) ou pelo menos uma (OU). De 30% para 40% = 10 p.p.'}</p> : null}
      {targetsQuery.isPending ? <p role="status"><BrandLoading label="Carregando metas semanais" inline size="sm" /></p> : targetsQuery.isError ? <Alert tone="warning" title="Não foi possível carregar as metas." action={<Button workflowAppearance={workflowAppearance} workflowVariant="mini" size="sm" variant="secondary" onClick={() => targetsQuery.refetch()}>Tentar novamente</Button>} /> : <>
        <ProjectDetailDisclosure disabled={!compact} label="Consultar a semana atual" compact><div className="mission-weekly-progress-current">
          <span>{formatDateOnly(current.periodStartDate)} a {formatDateOnly(current.periodEndDate)} · {current.inProgress ? 'Em andamento' : current.periodStartDate > today ? 'Aguardando início' : 'Período encerrado'}</span>
          <dl>
            <div><dt>{current.metric === 'COLLABORATORS' ? 'Previsto por dia' : 'Previsto'}</dt><dd>{current.mixedUnits ? comparisonValue(current, 'plannedValue') : weeklyValueLabel(current.plannedValue, current.metric)}</dd></div>
            <div><dt>{current.metric === 'COLLABORATORS' ? 'Menor efetivo diário' : 'Realizado'}</dt><dd>{current.mixedUnits ? comparisonValue(current, 'actualValue') : weeklyValueLabel(current.actualValue, current.metric)}</dd></div>
            <div><dt>Diferença</dt><dd>{current.mixedUnits ? comparisonValue(current, 'differenceValue') : weeklyValueLabel(current.differenceValue, current.metric, true)}</dd></div>
          </dl>
          <span className={`mission-weekly-status status-${current.status.toLowerCase()}`}>{STATUS_LABEL[current.status]}</span>
          {current.cumulativeAttendance ? <div className="mission-weekly-attendance-balance">
            <strong>Presença acumulada</strong>
            <dl>
              <div><dt>Previsto acumulado</dt><dd>{current.cumulativeAttendance.plannedValue} presenças</dd></div>
              <div><dt>Realizado acumulado</dt><dd>{current.cumulativeAttendance.actualValue == null ? '—' : `${current.cumulativeAttendance.actualValue} presenças`}</dd></div>
              <div><dt>Saldo acumulado</dt><dd>{attendanceBalanceLabel(current.cumulativeAttendance.differenceValue)}</dd></div>
            </dl>
            <p className="mission-weekly-progress-hint">Cada colaborador em um dia conta como uma presença. O saldo soma excedentes e faltas desde a primeira semana com meta de presença, nos dias selecionados já ocorridos. Dias sem meta não entram; a avaliação diária continua independente.</p>
          </div> : null}
          {current.metric !== 'PCT_POINTS' || current.goals.length > 1 ? <WeeklyGoalResults row={current} showBalance={false} /> : null}
          {current.target?.repeatedFromWeekStartDate ? <p className="mission-weekly-progress-hint">Meta reutilizada automaticamente desde {formatDateOnly(current.target.repeatedFromWeekStartDate)}.</p> : current.target?.definition?.repeatWeekly ? <p className="mission-weekly-progress-hint">Repetição semanal ativada.</p> : null}
          {current.target?.definition ? <details><summary>Regras cadastradas para a semana</summary><WeeklyTargetConfiguration target={current.target} /></details> : null}
        </div></ProjectDetailDisclosure>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {compact ? <Button size="sm" variant="secondary" workflowAppearance={workflowAppearance} aria-expanded={showDetails} onClick={() => setShowDetails(!showDetails)}>{showDetails ? 'Recolher detalhes e edição' : 'Detalhes e edição das metas'}</Button> : null}
        <div className="mission-weekly-progress-table" role="region" aria-label="Comparativo semanal de avanço" tabIndex={0}>
          <SortableTable>
            <thead><tr><th scope="col">Semana</th><th scope="col">{plannedHeading}</th><th scope="col">{actualHeading}</th><th scope="col">Diferença</th><th scope="col">Situação</th>{showDetails ? <th scope="col">Meta registrada</th> : null}{canManage && showDetails ? <th scope="col" data-sortable="false">Ação</th> : null}</tr></thead>
            <tbody>{(showAll ? rows : rows.slice(0, 12)).map(row => {
              const revisions = targets.filter(target => target.weekStartDate === row.weekStartDate).sort((a, b) => b.revision - a.revision);
              return <tr key={row.weekStartDate}>
                <th scope="row" data-sort-value={row.periodStartDate}>{formatDateOnly(row.periodStartDate)}<small>até {formatDateOnly(row.periodEndDate)}{row.inProgress ? ' · Em andamento' : ''}</small></th>
                <td data-label={plannedHeading} data-sort-value={row.plannedValue}>{comparisonValue(row, 'plannedValue', true)}</td><td data-label={actualHeading} data-sort-value={row.actualValue}><div>{comparisonValue(row, 'actualValue')}{row.metric === 'COLLABORATORS' ? <details><summary>Presença por dia · menor efetivo diário</summary><WeeklyGoalResults row={row} /></details> : null}</div></td><td data-label="Diferença" data-sort-value={row.differenceValue}><div>{comparisonValue(row, 'differenceValue')}{row.cumulativeAttendance ? <small>Acumulado: {attendanceBalanceLabel(row.cumulativeAttendance.differenceValue)}</small> : null}</div></td>
                <td data-label="Situação"><span className={`mission-weekly-status status-${compact && row.inProgress && row.status === 'BELOW' ? 'planned' : row.status.toLowerCase()}`}>{!compact ? STATUS_LABEL[row.status] : row.inProgress && row.status === 'BELOW' ? 'Em andamento' : REACHED.includes(row.status) ? 'Meta atingida' : row.status === 'BELOW' ? 'Meta não atingida' : STATUS_LABEL[row.status]}</span></td>
                {showDetails ? <td data-label="Meta registrada" data-sort-value={revisions[0]?.createdAt}>{revisions.length ? <div className="mission-weekly-record">{revisions[0].isDeleted ? <strong>Meta excluída</strong> : null}<span>{revisions[0].author.name}</span><small>{new Date(revisions[0].createdAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</small><details><summary>{revisions.length > 1 ? `${revisions.length} versões` : 'Ver regras'}</summary>{revisions.map(revision => <div key={revision.id}><small>Versão {revision.revision} · {revision.author.name} · {new Date(revision.createdAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</small>{revision.isDeleted ? <span>Meta excluída</span> : <WeeklyTargetConfiguration target={revision} />}</div>)}</details></div> : row.target?.repeatedFromWeekStartDate ? <div className="mission-weekly-record"><strong>Meta reutilizada</strong><small>Desde {formatDateOnly(row.target.repeatedFromWeekStartDate)}</small><span>{row.target.author.name}</span></div> : '—'}</td> : null}
                {canManage && showDetails ? <td data-label="Ação"><div className="mission-weekly-row-actions"><Button workflowAppearance={workflowAppearance} workflowVariant="mini" size="sm" variant="secondary" disabled={busy} aria-label={`${row.target ? 'Editar' : 'Definir'} meta da semana de ${formatDateOnly(row.weekStartDate)}`} onClick={() => editWeek(row)}>{row.target ? 'Editar' : 'Definir'}</Button>{row.target ? <Button workflowAppearance={workflowAppearance} workflowVariant="danger" size="sm" variant="danger" disabled={busy} aria-label={`Excluir meta da semana de ${formatDateOnly(row.weekStartDate)}`} onClick={() => {
                  setDeleteError('');
                  setDeleteTarget({ weekStartDate: row.weekStartDate, expectedRevision: row.target!.revision });
                }}>Excluir</Button> : null}</div></td> : null}
              </tr>;
            })}</tbody>
          </SortableTable>
        </div>
        {rows.length > 12 ? <Button workflowAppearance={workflowAppearance} workflowVariant="mini" size="sm" variant="secondary" onClick={() => setShowAll(!showAll)}>{showAll ? 'Mostrar últimas 12 semanas' : `Ver todas as ${rows.length} semanas`}</Button> : null}
        <ProjectDetailDisclosure disabled={!compact} label="Como a meta é calculada" compact>
      {compact ? <p className="mission-weekly-progress-hint">{hasAttendance
      ? 'Metas por serviço (metros, litros ou unidades), de avanço do projeto em p.p. ou de equipe mínima por dia. Várias metas podem exigir todas (E) ou pelo menos uma (OU).'
      : 'Metas por serviço (metros, litros ou unidades) ou de avanço do projeto em p.p. Várias metas podem exigir todas (E) ou pelo menos uma (OU). De 30% para 40% = 10 p.p.'}</p> : null}
        <p className="mission-weekly-progress-hint">Somente as datas dentro do período configurado entram na meta, incluindo o dia inicial e o final. Metas antigas mantêm a contagem de segunda a domingo. Nas metas de presença, contam os dias de trabalho selecionados que estão dentro desse intervalo.</p>
        <p className="mission-weekly-progress-hint">{hasAttendance
        ? `Diferença = realizado − previsto. Quantidades físicas usam serviços finalizados. ${JOURNEY_HINT} Metas de presença comparam a equipe do RDO com a quantidade mínima em cada dia de trabalho; o resumo mostra o menor efetivo diário e dias sem RDO ficam pendentes. A semana atual está em andamento e é recalculada conforme os RDOs.`
        : `Diferença = realizado − previsto. Quantidades físicas usam serviços finalizados. ${JOURNEY_HINT} Um serviço sem RDO na semana conta 0. A semana atual ainda está em andamento e é recalculada conforme os RDOs.`}</p>
        </ProjectDetailDisclosure>
      </>}
    </ProjectDetailSection>
    {canManage ? <WeeklyTargetDialog owner={owner} request={request} targets={targets} workdays={workdays} onClose={() => setRequest(null)} /> : null}
    <ConfirmDialog open={Boolean(deleteTarget) && canManage} appearance="design-system" title="Excluir meta semanal"
      description="A semana ficará sem meta definida e a repetição será interrompida a partir dela. As versões anteriores e o registro da exclusão permanecerão no histórico."
      highlight={deleteTarget ? `Semana de ${formatDateOnly(deleteTarget.weekStartDate)}` : undefined}
      confirmLabel={remove.isPending ? 'Excluindo…' : 'Excluir meta'} confirmDisabled={busy} errorMessage={deleteError}
      onCancel={() => { if (!remove.isPending) { setDeleteTarget(null); setDeleteError(''); } }}
      onConfirm={() => { if (deleteTarget && canManage && !busy) remove.mutate(deleteTarget); }} />
  </section>;
}
