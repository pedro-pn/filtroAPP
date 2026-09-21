import { useQuery } from '@tanstack/react-query';

import { getPlanningOverview } from '../../../api/efetivoPlanning';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  MetricCard,
  Skeleton,
  type SemanticTone
} from '../../../components/ui/ds';
import { displayDateOnly } from '../../../utils/calendarGrid';
import { missionFinalAllocations } from '../../../utils/missionAllocationPeriod';
import type { EfetivoPlanningSection } from '../../../utils/planningNavigation';

function percentage(value: number | null) {
  return value == null ? 'Indisponível' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

export function OverviewBoard({ date, jobRoleId, onNavigate }: {
  date: string;
  jobRoleId?: string;
  onNavigate: (section: EfetivoPlanningSection, params?: Record<string, string>) => void;
}) {
  const query = useQuery({
    queryKey: ['efetivo-planning-overview', date, jobRoleId || 'all'],
    queryFn: () => getPlanningOverview(date, jobRoleId)
  });
  if (query.isLoading) {
    return (
      <Card padding="sm" aria-label="Calculando capacidade operacional">
        <div className="efetivo-loading-grid">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton variant="card" height={48} key={index} />
          ))}
        </div>
      </Card>
    );
  }
  if (query.isError || !query.data) {
    return (
      <Alert
        tone="danger"
        title="Não foi possível carregar a capacidade"
        action={{ label: 'Tentar novamente', onClick: () => query.refetch() }}
      >
        Verifique a conexão e tente atualizar os dados desta visão.
      </Alert>
    );
  }
  const data = query.data;
  const metricTones: Record<string, SemanticTone> = {
    'Efetivo ativo': 'neutral',
    Alocados: 'info',
    Indisponíveis: 'warning',
    Livres: 'success',
    Déficit: data.totals.deficit ? 'danger' : 'neutral'
  };
  return (
    <div className="efetivo-board" data-efetivo-overview>
      <section className="efetivo-executive-metrics" data-efetivo-planning-kpis aria-label="Resumo da capacidade operacional">
        {[
          ['Efetivo ativo', data.totals.active],
          ['Alocados', data.totals.allocated],
          ['Indisponíveis', data.totals.unavailable],
          ['Livres', data.totals.free],
          ['Déficit', data.totals.deficit]
        ].map(([label, value]) => (
          <MetricCard
            key={label}
            label={label}
            value={value}
            tone={metricTones[label]}
            description={
              label === 'Déficit'
                ? value
                  ? 'Contratação ou remanejamento'
                  : 'Todas as vagas cobertas'
                : `Em ${displayDateOnly(date)}`
            }
          />
        ))}
      </section>

      <Card className="efetivo-utilization-card" padding="md">
        <div>
          <span className="efetivo-eyebrow">Utilização planejada · 90 dias</span>
          <strong>{percentage(data.plannedUtilization90d)}</strong>
          <small>Meta configurada: {percentage(data.target)}</small>
          <Button variant="link" size="sm" onClick={() => onNavigate('produtividade')}>Abrir produtividade</Button>
        </div>
        <div className="efetivo-utilization-track" aria-label={`Utilização ${percentage(data.plannedUtilization90d)}`}>
          <span style={{ width: `${Math.min(100, data.plannedUtilization90d || 0)}%` }} />
          <i style={{ left: `${Math.min(100, data.target)}%` }} />
        </div>
      </Card>

      <div className="efetivo-two-column">
        <Card
          className="efetivo-overview-card"
          title={<div className="efetivo-overview-card__heading"><strong>Próximas mobilizações</strong><p>Equipe prevista e vagas pendentes.</p></div>}
          actions={<Button variant="link" size="sm" onClick={() => onNavigate('missoes')}>Ver missões</Button>}
        >
          {data.upcomingMobilizations.length ? <div className="efetivo-compact-list">{data.upcomingMobilizations.map(mission => {
            return <button type="button" onClick={() => onNavigate('missoes', { missao: mission.id })} key={`${mission.id}-${mission.mobilizationDate}`}><strong>{mission.project.code} · {mission.project.name}</strong><span>{displayDateOnly(mission.mobilizationDate)} · {missionFinalAllocations(mission).length} participante(s)</span></button>;
          })}</div> : <EmptyState title="Nenhuma mobilização próxima" description="Não há mobilizações confirmadas nesta janela." icon={null} />}
        </Card>
        <Card
          className="efetivo-overview-card"
          title={<div className="efetivo-overview-card__heading"><strong>Folgas a programar</strong><p>Permanência contínua em obra e limite de cada função.</p></div>}
          actions={<Button variant="link" size="sm" onClick={() => onNavigate('colaboradores', { date })}>Ver colaboradores</Button>}
        >
          {data.continuousStayAlerts.length ? <div className="efetivo-compact-list">{data.continuousStayAlerts.map(alert => <button type="button" onClick={() => onNavigate('colaboradores', { date, colaborador: alert.collaboratorId })} key={alert.collaboratorId}><strong>{alert.collaboratorName}</strong><span>{alert.jobRoleName} · limite de {alert.limitDays} dias atingido ({alert.projectedDays} projetados) · programar folga até {displayDateOnly(alert.restDueDate)}</span>{alert.missions?.length ? <small>Missões: {alert.missions.map(mission => mission.code || mission.name).join(', ')}</small> : null}</button>)}</div> : <p className="placeholder-copy">✓ Nenhum colaborador atingirá o alerta de permanência na janela projetada.</p>}
        </Card>
      </div>

      <Card
        className="efetivo-overview-card"
        title={<div className="efetivo-overview-card__heading"><strong>Capacidade por função</strong><p>Demanda confirmada, equipe e déficit sem dupla contagem.</p></div>}
        actions={<Button variant="link" size="sm" onClick={() => onNavigate('calendario', { date })}>Ver calendário</Button>}
      >
        {data.byRole.length ? <div className="efetivo-role-grid">{data.byRole.map(role => (
          <article className="efetivo-role-card" key={role.jobRoleId} style={{ borderTopColor: role.calendarColor }}>
            <header><strong>{role.jobRoleName}</strong>{role.deficit ? <Badge tone="warning">Déficit {role.deficit}</Badge> : <Badge tone="success">Coberta</Badge>}</header>
            <dl><div><dt>Demanda</dt><dd>{role.demand}</dd></div><div><dt>Alocados</dt><dd>{role.allocated}</dd></div><div><dt>Livres</dt><dd>{role.free}</dd></div><div><dt>Indisponíveis</dt><dd>{role.unavailable}</dd></div></dl>
            <small>Utilização 90d: {percentage(role.plannedUtilization90d ?? null)}</small>
          </article>
        ))}</div> : <EmptyState className="efetivo-executive-empty" title="Nenhuma função no recorte" description="Altere a data ou remova o filtro de função para ampliar a consulta." icon={null} />}
      </Card>
    </div>
  );
}
