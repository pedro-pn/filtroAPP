import { useQuery } from '@tanstack/react-query';

import { listPlanningAbsences, listPlanningCollaborators, listPlanningMissions } from '../../../api/efetivoPlanning';
import { displayDateOnly } from '../../../utils/calendarGrid';
import { AVAILABILITY_STATUSES, buildAvailabilityColumns, type AvailabilityStatus } from '../../../utils/collaboratorAvailability';

const COLUMN_META: Record<AvailabilityStatus, { label: string; description: string }> = {
  AVAILABLE: { label: 'Disponíveis', description: 'Sem missão ou indisponibilidade na data' },
  AWAITING_MOBILIZATION: { label: 'Aguardando mobilização', description: 'Equipe definida, ainda em Stand by' },
  MOBILIZED: { label: 'Mobilizados', description: 'Em mobilização, execução ou medição' },
  ON_VACATION: { label: 'De férias', description: 'Férias vigentes na data consultada' }
};

function initials(name: string) {
  return name.split(' ').filter(Boolean).map(part => part[0]).slice(0, 2).join('').toLocaleUpperCase('pt-BR');
}

export function AvailabilityBoard({ date, jobRoleId }: { date: string; jobRoleId?: string }) {
  const collaborators = useQuery({
    queryKey: ['efetivo-planning-availability-collaborators', date, jobRoleId || 'all'],
    queryFn: () => listPlanningCollaborators({ date, jobRoleId })
  });
  const missions = useQuery({ queryKey: ['efetivo-planning-missions', 'availability'], queryFn: () => listPlanningMissions() });
  const absences = useQuery({
    queryKey: ['efetivo-planning-availability-absences', date],
    queryFn: () => listPlanningAbsences({ startDate: date, endDate: date })
  });

  if (collaborators.isLoading || missions.isLoading || absences.isLoading) {
    return <section className="page-card placeholder-copy">Carregando disponibilidade do efetivo…</section>;
  }
  if (collaborators.isError || missions.isError || absences.isError) {
    return <section className="page-card placeholder-copy">Não foi possível carregar a disponibilidade.</section>;
  }

  const { columns, otherUnavailable } = buildAvailabilityColumns(collaborators.data || [], missions.data || [], absences.data || [], date);
  const shown = AVAILABILITY_STATUSES.reduce((total, status) => total + columns[status].length, 0);

  return (
    <div className="efetivo-board" data-efetivo-availability>
      <section className="page-card efetivo-kanban-intro">
        <div><h2>Disponibilidade do efetivo</h2><p>Posição em {displayDateOnly(date)}. Este quadro é somente para consulta: os cards não podem ser movidos.</p></div>
        <span className="efetivo-readonly-badge">Somente leitura</span>
      </section>
      <section className="page-card efetivo-summary-strip" data-efetivo-availability-summary>
        <span><strong>{shown}</strong> colaboradores no quadro</span>
        <span><strong>{columns.AVAILABLE.length}</strong> disponíveis</span>
        <span><strong>{columns.AWAITING_MOBILIZATION.length}</strong> aguardando</span>
        <span><strong>{columns.MOBILIZED.length}</strong> mobilizados</span>
        <span><strong>{columns.ON_VACATION.length}</strong> de férias</span>
      </section>
      {otherUnavailable ? <p className="efetivo-availability-note">{otherUnavailable} colaborador(es) em folga ou afastamento não são contabilizados como disponíveis.</p> : null}
      <section className="efetivo-availability-kanban" aria-label="Disponibilidade dos colaboradores">
        {AVAILABILITY_STATUSES.map(status => (
          <div className="efetivo-kanban-column efetivo-availability-column" data-availability-status={status} key={status}>
            <header><div><strong><span className="efetivo-stage-dot" aria-hidden="true" />{COLUMN_META[status].label}</strong><span>{columns[status].length}</span></div><small>{COLUMN_META[status].description}</small></header>
            <div className="efetivo-kanban-list">
              {columns[status].length ? columns[status].map(entry => (
                <article className="efetivo-availability-card" data-collaborator-id={entry.collaborator.id} key={entry.collaborator.id}>
                  <div className="efetivo-availability-person"><i aria-hidden="true">{initials(entry.collaborator.name)}</i><span><strong>{entry.collaborator.name}</strong><small>{entry.collaborator.role}</small></span></div>
                  {entry.mission ? <div className="efetivo-availability-context"><span>{entry.mission.project.code} · {entry.mission.project.name}</span><small>Mobilização em {displayDateOnly(entry.mission.mobilizationDate)}</small></div> : null}
                  {entry.absence ? <div className="efetivo-availability-context"><span>Férias programadas</span><small>Até {displayDateOnly(entry.absence.endDate)}</small></div> : null}
                </article>
              )) : <p className="efetivo-kanban-empty">Nenhum colaborador nesta situação</p>}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
