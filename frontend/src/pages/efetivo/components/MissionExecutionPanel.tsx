import { useQuery } from '@tanstack/react-query';

import { getMissionExecutionComparison } from '../../../api/efetivoPlanning';
import { displayDateOnly } from '../../../utils/calendarGrid';

function minutesLabel(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes ? `${hours}h ${minutes}min` : `${hours}h`;
}

export function MissionExecutionPanel({ missionId }: { missionId: string }) {
  const comparison = useQuery({
    queryKey: ['efetivo-mission-execution', missionId],
    queryFn: () => getMissionExecutionComparison(missionId),
    staleTime: 30_000
  });

  if (comparison.isLoading) return <div className="efetivo-execution-panel placeholder-copy">Carregando execução observada…</div>;
  if (comparison.isError || !comparison.data) {
    return <div className="efetivo-execution-panel placeholder-copy">Não foi possível carregar o comparativo da execução.</div>;
  }

  const data = comparison.data;
  const plannedById = new Map(data.planned.collaborators.map(item => [item.id, item]));
  const observedById = new Map(data.observed.collaborators.map(item => [item.id, item]));

  return (
    <section className="efetivo-execution-panel" aria-label="Planejado e realizado" onClick={event => event.stopPropagation()}>
      <header><strong>Planejado × realizado</strong><span>{data.observed.reportCount} RDO(s)</span></header>
      <div className="efetivo-execution-grid">
        <div>
          <span>Início planejado</span>
          <strong>{displayDateOnly(data.planned.dates.executionStartDate)}</strong>
        </div>
        <div>
          <span>Primeiro RDO</span>
          <strong>{data.observed.firstReportDate ? displayDateOnly(data.observed.firstReportDate) : 'Sem execução'}</strong>
        </div>
        <div>
          <span>Equipe</span>
          <strong>{data.planned.collaborators.length} planejados · {data.observed.collaborators.length} observados</strong>
        </div>
        <div>
          <span>Horas observadas</span>
          <strong>{minutesLabel(data.observed.totalWorkedMinutes)} · {minutesLabel(data.observed.totalOvertimeMinutes)} extra</strong>
        </div>
      </div>
      {data.observed.progressPct != null ? <p>Avanço observado: <strong>{data.observed.progressPct}%</strong></p> : null}
      {data.divergences.missingPlannedCollaboratorIds.length ? (
        <p className="danger">Sem registro no RDO: {data.divergences.missingPlannedCollaboratorIds.map(id => plannedById.get(id)?.name || id).join(', ')}</p>
      ) : null}
      {data.divergences.unplannedObservedCollaboratorIds.length ? (
        <p className="danger">Fora da equipe planejada: {data.divergences.unplannedObservedCollaboratorIds.map(id => observedById.get(id)?.name || id).join(', ')}</p>
      ) : null}
      {data.divergences.executionStartedOnDifferentDate ? <p className="danger">A execução começou em data diferente da programação.</p> : null}
      {data.divergences.workforceConflicts.length ? <p className="danger">Há {data.divergences.workforceConflicts.length} conflito(s) de disponibilidade registrado(s).</p> : null}
      {data.suggestion ? <p className="efetivo-execution-suggestion">Sugestão operacional: <strong>{data.suggestion.reason}</strong> A etapa não foi alterada automaticamente.</p> : null}
    </section>
  );
}
