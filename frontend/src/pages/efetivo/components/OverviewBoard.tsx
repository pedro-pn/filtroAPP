import { useQuery } from '@tanstack/react-query';

import { getPlanningOverview } from '../../../api/efetivoPlanning';
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
  if (query.isLoading) return <div className="page-card placeholder-copy">Calculando capacidade operacional…</div>;
  if (query.isError || !query.data) return <div className="page-card placeholder-copy">Não foi possível carregar a capacidade.</div>;
  const data = query.data;
  return (
    <div className="efetivo-board" data-efetivo-overview>
      <section className="efetivo-kpis" data-efetivo-planning-kpis>
        {[
          ['Efetivo ativo', data.totals.active],
          ['Alocados', data.totals.allocated],
          ['Indisponíveis', data.totals.unavailable],
          ['Livres', data.totals.free],
          ['Déficit', data.totals.deficit]
        ].map(([label, value]) => <article className={`efetivo-kpi ${label === 'Déficit' && value ? 'efetivo-kpi-danger' : ''}`} key={label}><span>{label}</span><strong>{value}</strong><small>{label === 'Déficit' ? (value ? 'Contratação ou remanejamento' : 'Todas as vagas cobertas') : `em ${displayDateOnly(date)}`}</small></article>)}
      </section>

      <section className="page-card efetivo-utilization-card">
        <div>
          <span className="efetivo-eyebrow">Utilização planejada · 90 dias</span>
          <strong>{percentage(data.plannedUtilization90d)}</strong>
          <small>Meta configurada: {percentage(data.target)}</small>
          <button className="efetivo-panel-link" type="button" onClick={() => onNavigate('produtividade')}>Abrir produtividade →</button>
        </div>
        <div className="efetivo-utilization-track" aria-label={`Utilização ${percentage(data.plannedUtilization90d)}`}>
          <span style={{ width: `${Math.min(100, data.plannedUtilization90d || 0)}%` }} />
          <i style={{ left: `${Math.min(100, data.target)}%` }} />
        </div>
      </section>

      <section className="page-card">
        <div className="efetivo-section-heading"><div><h2>Capacidade por função</h2><p>Demanda confirmada, equipe e déficit sem dupla contagem.</p></div><button className="efetivo-panel-link" type="button" onClick={() => onNavigate('calendario', { date })}>Ver calendário →</button></div>
        {data.byRole.length ? <div className="efetivo-role-grid">{data.byRole.map(role => (
          <article className="efetivo-role-card" key={role.jobRoleId} style={{ borderTopColor: role.calendarColor }}>
            <header><strong>{role.jobRoleName}</strong>{role.deficit ? <span className="efetivo-badge warning">Déficit {role.deficit}</span> : <span className="efetivo-badge">Coberta</span>}</header>
            <dl><div><dt>Demanda</dt><dd>{role.demand}</dd></div><div><dt>Alocados</dt><dd>{role.allocated}</dd></div><div><dt>Livres</dt><dd>{role.free}</dd></div><div><dt>Indisponíveis</dt><dd>{role.unavailable}</dd></div></dl>
            <small>Utilização 90d: {percentage(role.plannedUtilization90d ?? null)}</small>
          </article>
        ))}</div> : <p className="placeholder-copy">Nenhuma função operacional no recorte.</p>}
      </section>

      <div className="efetivo-two-column">
        <section className="page-card">
          <div className="efetivo-section-heading"><div><h2>Próximas mobilizações</h2><p>Equipe prevista e vagas pendentes.</p></div><button className="efetivo-panel-link" type="button" onClick={() => onNavigate('missoes')}>Ver missões →</button></div>
          {data.upcomingMobilizations.length ? <div className="efetivo-compact-list">{data.upcomingMobilizations.map(mission => {
            return <button type="button" onClick={() => onNavigate('missoes', { missao: mission.id })} key={`${mission.id}-${mission.mobilizationDate}`}><strong>{mission.project.code} · {mission.project.name}</strong><span>{displayDateOnly(mission.mobilizationDate)} · {missionFinalAllocations(mission).length} participante(s)</span></button>;
          })}</div> : <p className="placeholder-copy">Nenhuma mobilização confirmada na janela.</p>}
        </section>
        <section className="page-card">
          <div className="efetivo-section-heading"><div><h2>Folgas a programar</h2><p>Permanência contínua em obra, pelo limite configurado para cada função.</p></div><button className="efetivo-panel-link" type="button" onClick={() => onNavigate('colaboradores', { date })}>Ver colaboradores →</button></div>
          {data.continuousStayAlerts.length ? <div className="efetivo-compact-list">{data.continuousStayAlerts.map(alert => <button type="button" onClick={() => onNavigate('colaboradores', { date, colaborador: alert.collaboratorId })} key={alert.collaboratorId}><strong>{alert.collaboratorName}</strong><span>{alert.jobRoleName} · limite de {alert.limitDays} dias atingido ({alert.projectedDays} projetados) · programar folga até {displayDateOnly(alert.restDueDate)}</span>{alert.missions?.length ? <small>Missões: {alert.missions.map(mission => mission.code || mission.name).join(', ')}</small> : null}</button>)}</div> : <p className="placeholder-copy">✓ Nenhum colaborador atingirá o alerta de permanência na janela projetada.</p>}
        </section>
      </div>
    </div>
  );
}
