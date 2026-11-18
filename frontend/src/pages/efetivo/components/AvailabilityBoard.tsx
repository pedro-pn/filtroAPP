import { useQuery } from '@tanstack/react-query';

import { listPlanningAbsences, listPlanningCollaborators, listPlanningMissions } from '../../../api/efetivoPlanning';
import { Alert, Badge, Card, MetricCard, Skeleton } from '../../../components/ui/ds';
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
    return (
      <Card padding="sm" aria-label="Carregando disponibilidade do efetivo">
        <div className="efetivo-loading-grid">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton variant="card" height={48} key={index} />
          ))}
        </div>
      </Card>
    );
  }
  if (collaborators.isError || missions.isError || absences.isError) {
    return (
      <Alert
        tone="danger"
        title="Não foi possível carregar a disponibilidade"
        action={{
          label: 'Tentar novamente',
          onClick: () => {
            void Promise.all([
              collaborators.refetch(),
              missions.refetch(),
              absences.refetch()
            ]);
          }
        }}
      >
        Verifique a conexão e tente atualizar a posição da equipe.
      </Alert>
    );
  }

  const { columns, otherUnavailable } = buildAvailabilityColumns(collaborators.data || [], missions.data || [], absences.data || [], date);
  const shown = AVAILABILITY_STATUSES.reduce((total, status) => total + columns[status].length, 0);

  return (
    <div className="efetivo-board" data-efetivo-availability>
      <Card className="efetivo-kanban-intro efetivo-availability-intro" padding="md">
        <div><h2>Disponibilidade do efetivo</h2><p>Posição em {displayDateOnly(date)}. Este quadro é somente para consulta: os cards não podem ser movidos.</p></div>
        <Badge tone="neutral">Somente leitura</Badge>
      </Card>
      <section className="efetivo-executive-metrics" data-efetivo-availability-summary aria-label="Resumo da disponibilidade">
        <MetricCard label="No quadro" value={shown} description="Colaboradores exibidos" />
        <MetricCard label="Disponíveis" value={columns.AVAILABLE.length} tone="success" description="Sem alocação na data" />
        <MetricCard label="Aguardando" value={columns.AWAITING_MOBILIZATION.length} tone="warning" description="Mobilização pendente" />
        <MetricCard label="Mobilizados" value={columns.MOBILIZED.length} tone="info" description="Em missão" />
        <MetricCard label="De férias" value={columns.ON_VACATION.length} tone="brand" description="Férias vigentes" />
      </section>
      {otherUnavailable ? <Alert tone="info">{otherUnavailable} colaborador(es) em folga ou afastamento não são contabilizados como disponíveis.</Alert> : null}
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
