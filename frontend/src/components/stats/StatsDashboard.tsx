import { useEffect, useMemo, useState } from 'react';

import { exportProjectStats, type ProjectStatsParams, type ProjectStatsService } from '../../api/statistics';
import { useProjectSegments, useProjects } from '../../hooks/useProjects';
import { useProjectStats } from '../../hooks/useProjectStats';
import { downloadBlob } from '../../utils/download';

const assetsBaseUrl = (import.meta.env.VITE_ASSETS_BASE_URL || '').replace(/\/$/, '');
const headerLogoUrl = `${assetsBaseUrl}/assets/Logo/LOGO_HEADER.png`;

function localDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfWeek(date = new Date()) {
  const next = new Date(date);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + diff);
  return localDate(next);
}

function startOfMonth(date = new Date()) {
  return localDate(new Date(date.getFullYear(), date.getMonth(), 1));
}

function startOfYear(date = new Date()) {
  return localDate(new Date(date.getFullYear(), 0, 1));
}

function defaultParams(): ProjectStatsParams {
  return {
    projectId: 'all',
    projectStatus: 'all',
    from: startOfYear(),
    to: localDate(),
    granularity: 'month'
  };
}

function hours(minutes: number) {
  return `${Math.round((minutes / 60) * 10) / 10} h`;
}

function numberPt(value: number) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value || 0);
}

function serviceTypeLabel(type: string, service: ProjectStatsService) {
  return service.label || type;
}

function serviceTotal(tubesByDiameter?: Record<string, { meters: number }>) {
  return Object.values(tubesByDiameter || {}).reduce((sum, item) => sum + (item.meters || 0), 0);
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('pt-BR');
}

function serviceSummaryText(service: Pick<ProjectStatsService, 'volumeOleoLiters' | 'tubesByDiameter'>) {
  const parts: string[] = [];
  if ((service.volumeOleoLiters || 0) > 0) parts.push(`${numberPt(service.volumeOleoLiters || 0)} L`);
  const meters = serviceTotal(service.tubesByDiameter);
  if (meters > 0) parts.push(`${numberPt(meters)} m`);
  return parts.join(' · ');
}

function contributionTitle(system?: string | null, equipmentName?: string | null) {
  return [system || 'Sem sistema', equipmentName || 'Sem equipamento'].join(' · ');
}

function selectedValues(select: HTMLSelectElement) {
  return Array.from(select.selectedOptions).map(option => option.value).filter(Boolean);
}

export function StatsDashboard() {
  const [params, setParams] = useState<ProjectStatsParams>(() => defaultParams());
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const projectsQuery = useProjects();
  const segmentsQuery = useProjectSegments();
  const statsQuery = useProjectStats(params);
  const stats = statsQuery.data;

  const selectedProjectIds = Array.isArray(params.projectId) ? params.projectId : [];
  const visibleProjects = useMemo(() => {
    const projects = projectsQuery.data || [];
    return projects
      .filter(project => !params.segment || project.clientSegment === params.segment)
      .filter(project => params.projectStatus === 'all' || (params.projectStatus === 'active' ? project.isActive : !project.isActive))
      .sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''), 'pt-BR'));
  }, [params.projectStatus, params.segment, projectsQuery.data]);

  function setQuickRange(range: 'today' | 'week' | 'month' | 'year') {
    const today = localDate();
    if (range === 'today') setParams(current => ({ ...current, from: today, to: today, granularity: 'day' }));
    if (range === 'week') setParams(current => ({ ...current, from: startOfWeek(), to: today, granularity: 'day' }));
    if (range === 'month') setParams(current => ({ ...current, from: startOfMonth(), to: today, granularity: 'week' }));
    if (range === 'year') setParams(current => ({ ...current, from: startOfYear(), to: today, granularity: 'month' }));
  }

  async function handleExport(section: 'summary' | 'byProject' | 'services') {
    const blob = await exportProjectStats(params, section);
    downloadBlob(blob, `estatisticas_${section}_${params.from}_${params.to}.csv`);
  }

  const maxTimelineMinutes = Math.max(
    1,
    ...(stats?.timeline || []).map(item =>
      item.daytimeWorkedMinutes + item.nighttimeWorkedMinutes + item.daytimeOvertimeMinutes + item.nighttimeOvertimeMinutes
    )
  );

  return (
    <div className="stats-dashboard">
      <section className="survey-dash-card stats-filter-card">
        <div className="stats-filter-grid">
          <div className="field-group">
            <label htmlFor="stats-projects">Projetos</label>
            <select
              id="stats-projects"
              multiple
              value={selectedProjectIds}
              onChange={event => {
                const values = selectedValues(event.currentTarget);
                setParams(current => ({ ...current, projectId: values.length ? values : 'all' }));
              }}
            >
              {visibleProjects.map(project => (
                <option key={project.id} value={project.id}>{project.code} - {project.name}</option>
              ))}
            </select>
            <button className="mini-btn alt" type="button" onClick={() => setParams(current => ({ ...current, projectId: 'all' }))}>
              Todos
            </button>
          </div>
          <div className="field-group">
            <label htmlFor="stats-project-status">Status do projeto</label>
            <select id="stats-project-status" value={params.projectStatus || 'all'} onChange={event => setParams(current => ({ ...current, projectStatus: event.target.value as ProjectStatsParams['projectStatus'], projectId: 'all' }))}>
              <option value="all">Todos</option>
              <option value="active">Em andamento</option>
              <option value="archived">Arquivados/finalizados</option>
            </select>
          </div>
          <div className="field-group">
            <label htmlFor="stats-segment">Segmento</label>
            <select id="stats-segment" value={params.segment || ''} onChange={event => setParams(current => ({ ...current, segment: event.target.value || undefined, projectId: 'all' }))}>
              <option value="">Todos</option>
              {(segmentsQuery.data || []).map(segment => (
                <option key={segment.id} value={segment.slug}>{segment.label}</option>
              ))}
            </select>
          </div>
          <div className="field-group">
            <label htmlFor="stats-from">Início</label>
            <input id="stats-from" type="date" value={params.from} onChange={event => setParams(current => ({ ...current, from: event.target.value }))} />
          </div>
          <div className="field-group">
            <label htmlFor="stats-to">Fim</label>
            <input id="stats-to" type="date" value={params.to} onChange={event => setParams(current => ({ ...current, to: event.target.value }))} />
          </div>
          <div className="field-group">
            <label htmlFor="stats-granularity">Agrupamento</label>
            <select id="stats-granularity" value={params.granularity} onChange={event => setParams(current => ({ ...current, granularity: event.target.value as ProjectStatsParams['granularity'] }))}>
              <option value="day">Dia</option>
              <option value="week">Semana</option>
              <option value="month">Mês</option>
              <option value="year">Ano</option>
            </select>
          </div>
        </div>
        <div className="stats-filter-actions">
          <button className="mini-btn alt" type="button" onClick={() => setQuickRange('today')}>Hoje</button>
          <button className="mini-btn alt" type="button" onClick={() => setQuickRange('week')}>Semana</button>
          <button className="mini-btn alt" type="button" onClick={() => setQuickRange('month')}>Mês</button>
          <button className="mini-btn alt" type="button" onClick={() => setQuickRange('year')}>Ano</button>
          <span className="stats-filter-spacer" />
          <button className="mini-btn alt" type="button" onClick={() => void handleExport('summary')} disabled={!stats?.summary.reportCount}>Resumo CSV</button>
          <button className="mini-btn alt" type="button" onClick={() => void handleExport('byProject')} disabled={!stats?.summary.reportCount}>Projetos CSV</button>
          <button className="mini-btn alt" type="button" onClick={() => void handleExport('services')} disabled={!stats?.summary.reportCount}>Serviços CSV</button>
        </div>
      </section>

      {statsQuery.isLoading ? (
        <p className="placeholder-copy">Carregando estatísticas...</p>
      ) : !stats || stats.summary.reportCount === 0 ? (
        <section className="survey-dash-card">
          <p className="placeholder-copy">Nenhum RDO aprovado ou assinado no período selecionado.</p>
        </section>
      ) : (
        <>
          <div className="survey-dash-kpis stats-kpis">
            <div className="stat-card-react"><div className="stat-number-react">{stats.summary.totalDays}</div><div className="stat-label-react">Dias/RDOs</div></div>
            <div className="stat-card-react"><div className="stat-number-react">{hours(stats.summary.daytimeWorkedMinutes)}</div><div className="stat-label-react">Horas diurnas</div></div>
            <div className="stat-card-react"><div className="stat-number-react">{hours(stats.summary.nighttimeWorkedMinutes)}</div><div className="stat-label-react">Horas noturnas</div></div>
            <div className="stat-card-react"><div className="stat-number-react">{hours(stats.summary.daytimeOvertimeMinutes + stats.summary.nighttimeOvertimeMinutes)}</div><div className="stat-label-react">Horas extras</div></div>
            <div className="stat-card-react"><div className="stat-number-react">{stats.summary.standbyCount}</div><div className="stat-label-react">Dias standby</div></div>
            <div className="stat-card-react"><div className="stat-number-react">{hours(stats.summary.standbyMinutes)}</div><div className="stat-label-react">Horas standby</div></div>
            <div className="stat-card-react"><div className="stat-number-react">{numberPt(stats.summary.avgDaytimeCollaborators)}</div><div className="stat-label-react">Colab. diurnos médios</div></div>
            <div className="stat-card-react"><div className="stat-number-react">{numberPt(stats.summary.avgNighttimeCollaborators)}</div><div className="stat-label-react">Colab. noturnos médios</div></div>
          </div>

          <section className="survey-dash-card">
            <div className="survey-dash-card-title">Timeline</div>
            <div className="stats-timeline">
              {stats.timeline.map(item => {
                const total = item.daytimeWorkedMinutes + item.nighttimeWorkedMinutes + item.daytimeOvertimeMinutes + item.nighttimeOvertimeMinutes;
                const height = Math.max(8, Math.round((total / maxTimelineMinutes) * 140));
                const serviceCount = Object.values(item.serviceBreakdown || {}).reduce((sum, count) => sum + count, 0);
                return (
                  <div className="stats-timeline-col" key={item.period}>
                    <div className="stats-timeline-value">{hours(total)}</div>
                    <div className="stats-timeline-stack" style={{ height }}>
                      <span className="stats-bar-day" style={{ flexGrow: item.daytimeWorkedMinutes }} />
                      <span className="stats-bar-night" style={{ flexGrow: item.nighttimeWorkedMinutes }} />
                      <span className="stats-bar-ot-day" style={{ flexGrow: item.daytimeOvertimeMinutes }} />
                      <span className="stats-bar-ot-night" style={{ flexGrow: item.nighttimeOvertimeMinutes }} />
                    </div>
                    <div className="stats-timeline-services">{serviceCount} serv.</div>
                    <div className="stats-timeline-label">{item.label}</div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="survey-dash-card">
            <div className="survey-dash-card-title">Serviços</div>
            <div className="stats-services-grid">
              {Object.entries(stats.services).map(([type, service]) => (
                <article className="stats-service-card" key={type}>
                  <div>
                    <strong>{serviceTypeLabel(type, service)}</strong>
                    <span>{service.serviceCount} serviço{service.serviceCount === 1 ? '' : 's'}</span>
                  </div>
                  {(service.volumeOleoLiters || 0) > 0 ? <p>Volume: {numberPt(service.volumeOleoLiters || 0)} L</p> : null}
                  {serviceTotal(service.tubesByDiameter) > 0 ? (
                    <div className="stats-tube-list">
                      {Object.entries(service.tubesByDiameter || {}).map(([diameter, value]) => (
                        <span key={diameter}>{diameter}: {numberPt(value.meters)} m</span>
                      ))}
                    </div>
                  ) : null}
                  {selectedProjectIds.length === 1 && service.bySystemEquipment?.length ? (
                    <div className="stats-contribution-list">
                      {service.bySystemEquipment.map((item, index) => (
                        <div className="stats-contribution-row" key={`${type}-${index}`}>
                          <strong>{contributionTitle(item.system, item.equipmentName)}</strong>
                          <span>{item.serviceCount} serv.</span>
                          {serviceSummaryText({ ...service, ...item }) ? <small>{serviceSummaryText({ ...service, ...item })}</small> : null}
                          {serviceTotal(item.tubesByDiameter) > 0 ? (
                            <div className="stats-tube-list">
                              {Object.entries(item.tubesByDiameter || {}).map(([diameter, value]) => (
                                <span key={diameter}>{diameter}: {numberPt(value.meters)} m</span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </section>

          {stats.meta.ignoredLegacyRows.volumeOleo || stats.meta.ignoredLegacyRows.tubulacao ? (
            <section className="survey-dash-alert">
              Dados antigos ignorados: {stats.meta.ignoredLegacyRows.volumeOleo} volume(s), {stats.meta.ignoredLegacyRows.tubulacao} tubulação(ões).
            </section>
          ) : null}

          {stats.byProject.length ? (
            <section className="survey-dash-card">
              <div className="survey-dash-card-title">Por projeto</div>
              <div className="stats-project-list">
                {stats.byProject.map(item => (
                  <article className="stats-project-row" key={item.projectId}>
                    <button type="button" onClick={() => setExpandedProjectId(current => current === item.projectId ? null : item.projectId)}>
                      <span>{expandedProjectId === item.projectId ? '▾' : '▸'}</span>
                      <strong>{item.code} - {item.name}</strong>
                      <small>{item.isActive ? 'Em andamento' : 'Arquivado'} · {item.summary.reportCount} RDOs · {hours(item.summary.daytimeWorkedMinutes + item.summary.nighttimeWorkedMinutes)}</small>
                    </button>
                    {expandedProjectId === item.projectId ? (
                      <div className="stats-project-detail-wrap">
                        <div className="stats-project-detail">
                          <span>HE: {hours(item.summary.daytimeOvertimeMinutes + item.summary.nighttimeOvertimeMinutes)}</span>
                          <span>Standby: {item.summary.standbyCount} dia(s)</span>
                          <span>Colab. médios: {numberPt(item.summary.avgDaytimeCollaborators)} diurno / {numberPt(item.summary.avgNighttimeCollaborators)} noturno</span>
                        </div>
                        <div className="stats-daily-list">
                          {item.dailyReports.map(day => (
                            <article className="stats-daily-card" key={day.reportId}>
                              <div className="stats-daily-head">
                                <strong>{formatDate(day.reportDate)}{day.sequenceNumber ? ` · RDO ${day.sequenceNumber}` : ''}</strong>
                                <span>{day.status === 'SIGNED' ? 'Assinado' : 'Aprovado'}</span>
                              </div>
                              <div className="stats-daily-metrics">
                                <span>Diurno: {hours(day.daytimeWorkedMinutes)}</span>
                                <span>Noturno: {hours(day.nighttimeWorkedMinutes)}</span>
                                <span>HE: {hours(day.daytimeOvertimeMinutes + day.nighttimeOvertimeMinutes)}</span>
                                <span>Standby: {day.standby ? hours(day.standbyMinutes) : 'Não'}</span>
                                <span>Colab.: {day.daytimeCollaborators} diurno / {day.nighttimeCollaborators} noturno</span>
                              </div>
                              <div className="stats-daily-services">
                                {Object.entries(day.services).length ? Object.entries(day.services).map(([type, service]) => (
                                  <div key={type}>
                                    <strong>{serviceTypeLabel(type, service)}</strong>
                                    <span>{service.serviceCount} serv.</span>
                                    {serviceSummaryText(service) ? <small>{serviceSummaryText(service)}</small> : null}
                                    {service.items?.length ? (
                                      <div className="stats-service-item-list">
                                        {service.items.map(item => (
                                          <div className="stats-service-item" key={item.serviceId}>
                                            <span>{contributionTitle(item.system, item.equipmentName)}</span>
                                            {serviceSummaryText(item) ? <small>{serviceSummaryText(item)}</small> : null}
                                          </div>
                                        ))}
                                      </div>
                                    ) : null}
                                    {serviceTotal(service.tubesByDiameter) > 0 ? (
                                      <div className="stats-tube-list">
                                        {Object.entries(service.tubesByDiameter || {}).map(([diameter, value]) => (
                                          <span key={diameter}>{diameter}: {numberPt(value.meters)} m</span>
                                        ))}
                                      </div>
                                    ) : null}
                                  </div>
                                )) : (
                                  <p className="placeholder-copy">Nenhum serviço medido neste RDO.</p>
                                )}
                              </div>
                            </article>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

interface StatsDashboardOverlayProps {
  onClose: () => void;
}

export function StatsDashboardOverlay({ onClose }: StatsDashboardOverlayProps) {
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [onClose]);

  return (
    <div className="survey-dash-overlay" role="dialog" aria-modal="true" aria-label="Dashboard de estatísticas">
      <div className="survey-dash-overlay-topbar">
        <img className="survey-dash-overlay-logo" src={headerLogoUrl} alt="Filtrovali" />
        <span className="survey-dash-overlay-title">Dashboard de Estatísticas</span>
        <button className="survey-dash-overlay-back" type="button" onClick={onClose}>← Voltar</button>
      </div>
      <div className="survey-dash-overlay-scroll">
        <div className="survey-dash-overlay-content">
          <StatsDashboard />
        </div>
      </div>
    </div>
  );
}
