import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from 'react';

import { PortalTip } from '../../../components/ui/PortalTip';
import { getPlanningAvailability, type PeriodAvailabilityStatus, type PlanningAvailabilityPeriod } from '../../../api/efetivoPlanning';
import { displayDateOnly, parseDateOnly } from '../../../utils/calendarGrid';
import { buildCalendarBuckets, type CalendarBucket, type CalendarScale } from '../../../utils/availabilityCalendar';

const STATUSES: PeriodAvailabilityStatus[] = ['AVAILABLE', 'AWAITING_MOBILIZATION', 'MOBILIZED', 'ON_VACATION', 'OTHER_UNAVAILABLE'];
const STATUS_META: Record<PeriodAvailabilityStatus, { label: string; short: string; description: string }> = {
  AVAILABLE: { label: 'Disponíveis', short: 'Disponível', description: 'Livres durante todo o período' },
  AWAITING_MOBILIZATION: { label: 'Aguardando mobilização', short: 'Aguardando', description: 'Com missão em Stand by' },
  MOBILIZED: { label: 'Mobilizados', short: 'Mobilizado', description: 'Com alocação no período' },
  ON_VACATION: { label: 'De férias', short: 'Férias', description: 'Com férias no período' },
  OTHER_UNAVAILABLE: { label: 'Indisponíveis', short: 'Indisponível', description: 'Folga, afastamento ou fora do vínculo' }
};
const STATUS_COLOR: Record<PeriodAvailabilityStatus | 'OUTSIDE_EMPLOYMENT', string> = {
  AVAILABLE: '#16a34a',
  AWAITING_MOBILIZATION: '#f59e0b',
  MOBILIZED: '#2563eb',
  ON_VACATION: '#8b5cf6',
  OTHER_UNAVAILABLE: '#dc6a58',
  OUTSIDE_EMPLOYMENT: '#9ca3af'
};

type Person = PlanningAvailabilityPeriod['people'][number];

function personStatus(person: Person, totalDays: number): PeriodAvailabilityStatus {
  for (const status of ['MOBILIZED', 'ON_VACATION', 'AWAITING_MOBILIZATION', 'OTHER_UNAVAILABLE'] as const) {
    if (person.days.some(day => day.status === status)) return status;
  }
  return person.days.length < totalDays ? 'OTHER_UNAVAILABLE' : 'AVAILABLE';
}

function initials(name: string) {
  return name.split(' ').filter(Boolean).map(part => part[0]).slice(0, 2).join('').toLocaleUpperCase('pt-BR');
}

function dayLabel(date: string) {
  return parseDateOnly(date).toLocaleDateString('pt-BR', { timeZone: 'UTC', weekday: 'short' }).replace('.', '');
}

function bucketLabel(bucket: CalendarBucket, scale: CalendarScale) {
  if (scale === 'day') return <><small>{dayLabel(bucket.start)}</small><strong>{bucket.start.slice(8, 10)}</strong><small>{bucket.start.slice(5, 7)}</small></>;
  if (scale === 'week') return <><strong>{bucket.start.slice(8, 10)}–{bucket.end.slice(8, 10)}</strong><small>{bucket.start.slice(5, 7) === bucket.end.slice(5, 7) ? bucket.start.slice(5, 7) : `${bucket.start.slice(5, 7)}/${bucket.end.slice(5, 7)}`}</small></>;
  return <><strong>{parseDateOnly(bucket.start).toLocaleDateString('pt-BR', { timeZone: 'UTC', month: 'short' }).replace('.', '')}</strong><small>{bucket.start.slice(0, 4)}</small></>;
}

function bucketPeriod(bucket: CalendarBucket) {
  return bucket.start === bucket.end ? displayDateOnly(bucket.start) : `${displayDateOnly(bucket.start)} a ${displayDateOnly(bucket.end)}`;
}

function statusStripe(statuses: Array<PeriodAvailabilityStatus | 'OUTSIDE_EMPLOYMENT'>) {
  const width = 100 / statuses.length;
  return `linear-gradient(to right, ${statuses.map((status, index) => `${STATUS_COLOR[status]} ${(index * width).toFixed(3)}% ${((index + 1) * width).toFixed(3)}%`).join(', ')})`;
}

function AvailabilityCalendarCell({ personName, bucket, byDate }: {
  personName: string;
  bucket: CalendarBucket;
  byDate: Map<string, Person['days'][number]>;
}) {
  const [hoveredIndex, setHoveredIndex] = useState(0);
  const states = bucket.dates.map(date => byDate.get(date));
  const statuses = states.map(state => state?.status || 'OUTSIDE_EMPLOYMENT');
  const hoveredDate = bucket.dates[hoveredIndex] || bucket.start;
  const hoveredState = states[hoveredIndex];
  const summary = `${personName} · ${bucketPeriod(bucket)} · ${[...new Set(statuses)].map(status => `${statuses.filter(item => item === status).length} ${status === 'OUTSIDE_EMPLOYMENT' ? 'fora do vínculo' : STATUS_META[status].short.toLocaleLowerCase('pt-BR')}`).join(', ')}`;
  const updateHoveredDate = (event: MouseEvent<HTMLElement>) => {
    if (bucket.dates.length === 1) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const index = Math.max(0, Math.min(bucket.dates.length - 1, Math.floor((event.clientX - bounds.left) / bounds.width * bucket.dates.length)));
    setHoveredIndex(current => current === index ? current : index);
  };

  return <PortalTip
    triggerClassName="efetivo-period-cell"
    balloonClassName="efetivo-period-cell-tip"
    ariaLabel={summary}
    triggerTabIndex={-1}
    content={<div className="efetivo-period-tooltip">
      <strong>{personName}</strong>
      <span>{dayLabel(hoveredDate)} · {displayDateOnly(hoveredDate)}</span>
      <p>{hoveredState ? STATUS_META[hoveredState.status].short : 'Fora do vínculo'}</p>
      {hoveredState?.detail ? <small>{hoveredState.detail}</small> : null}
    </div>}
  >
    <i
      aria-hidden="true"
      style={{ background: statusStripe(statuses) }}
      onMouseEnter={updateHoveredDate}
      onMouseMove={updateHoveredDate}
    />
  </PortalTip>;
}

export function AvailabilityBoard({ date, endDate, jobRoleId, view, onViewChange }: {
  date: string;
  endDate: string;
  jobRoleId?: string;
  view: 'kanban' | 'calendar';
  onViewChange: (view: 'kanban' | 'calendar') => void;
}) {
  const span = (parseDateOnly(endDate).getTime() - parseDateOnly(date).getTime()) / 86_400_000;
  const validPeriod = span >= 0 && span <= 370;
  const query = useQuery({
    queryKey: ['efetivo-planning-availability', date, endDate, jobRoleId || 'all'],
    queryFn: () => getPlanningAvailability(date, endDate, jobRoleId),
    enabled: validPeriod
  });
  const data = query.data;
  const [viewportWidth, setViewportWidth] = useState(() => typeof window === 'undefined' ? 1280 : window.innerWidth);
  useEffect(() => {
    const updateWidth = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);
  const calendar = useMemo(() => buildCalendarBuckets(data?.days.map(day => day.date) || [], viewportWidth), [data, viewportWidth]);
  const columns = useMemo(() => {
    const grouped: Record<PeriodAvailabilityStatus, Person[]> = {
      AVAILABLE: [],
      AWAITING_MOBILIZATION: [],
      MOBILIZED: [],
      ON_VACATION: [],
      OTHER_UNAVAILABLE: []
    };
    for (const person of data?.people || []) grouped[personStatus(person, data?.days.length || 0)].push(person);
    return grouped;
  }, [data]);

  if (!validPeriod) return <section className="page-card placeholder-copy" role="alert">A data final deve ser igual ou posterior à data de posição e o período pode ter até 371 dias.</section>;
  if (query.isError) return <section className="page-card placeholder-copy" role="alert">Não foi possível carregar a disponibilidade.</section>;
  if (query.isLoading || !data) return <section className="page-card placeholder-copy">Carregando disponibilidade do período…</section>;

  const daysWithDeficit = data.days.filter(day => day.deficit > 0).length;
  const peakDeficit = Math.max(0, ...data.days.map(day => day.deficit));
  const deficitRoles = data.roles.filter(role => role.peakDeficit > 0);
  const dayDeficit = new Map(data.days.map(day => [day.date, day.deficit]));
  const riskByDay = new Map<string, number>();
  for (const risk of data.plannedRisks) riskByDay.set(risk.date, (riskByDay.get(risk.date) || 0) + risk.deficit);

  return (
    <div className="efetivo-board efetivo-period-board" data-efetivo-availability>
      <section className="page-card efetivo-kanban-intro efetivo-availability-intro">
        <div><span className="efetivo-eyebrow">Planejamento oficial · {displayDateOnly(date)} a {displayDateOnly(endDate)}</span><h2>Disponibilidade do efetivo</h2><p>Situação diária da equipe, vagas das missões e riscos nas mobilizações planejadas.</p></div>
        <div className="efetivo-availability-actions"><div className="efetivo-view-switch" role="group" aria-label="Visualização da disponibilidade"><button type="button" className={view === 'kanban' ? 'active' : ''} aria-pressed={view === 'kanban'} onClick={() => onViewChange('kanban')}>Kanban</button><button type="button" className={view === 'calendar' ? 'active' : ''} aria-pressed={view === 'calendar'} onClick={() => onViewChange('calendar')}>Calendário</button></div><span className="efetivo-readonly-badge">Somente leitura</span></div>
      </section>

      <section className="efetivo-period-kpis" aria-label="Resumo do período" data-efetivo-availability-summary>
        <article><span>Colaboradores</span><strong>{data.people.length}</strong><small>no período selecionado</small></article>
        <article><span>Dias com déficit</span><strong>{daysWithDeficit}</strong><small>de {data.days.length} dias</small></article>
        <article className={peakDeficit ? 'is-warning' : ''}><span>Pico de vagas abertas</span><strong>{peakDeficit}</strong><small>em um mesmo dia</small></article>
      </section>

      <section className="page-card efetivo-period-deficits" aria-label="Déficits por função">
        <div className="efetivo-section-heading"><div><h2>Vagas nas missões confirmadas</h2><p>Demanda menos colaboradores alocados em cada dia. O pico representa vagas simultâneas, não a soma do período.</p></div></div>
        {deficitRoles.length ? <div className="efetivo-period-role-grid">{deficitRoles.map(role => <article key={role.jobRoleId} className="has-deficit" style={{ '--role-color': role.calendarColor } as CSSProperties}><span className="efetivo-period-role-name">{role.jobRoleName}</span><strong>{role.peakDeficit} {role.peakDeficit === 1 ? 'vaga' : 'vagas'}</strong><small>{role.deficitDays} {role.deficitDays === 1 ? 'dia' : 'dias'} com déficit</small></article>)}</div> : <p className="efetivo-period-clear">Sem vagas abertas nas missões confirmadas neste período.</p>}
      </section>

      <section className="page-card efetivo-period-deficits" aria-label="Riscos nas mobilizações planejadas">
        <div className="efetivo-section-heading"><div><h2>Riscos nas mobilizações planejadas</h2><p>Necessidades do planejamento ainda não incluídas nas missões confirmadas, comparadas com a equipe livre na data prevista.</p></div></div>
        {data.plannedRisks.length ? <div className="efetivo-period-risk-grid">{data.plannedRisks.map(risk => <article key={`${risk.date}-${risk.jobRoleId}`}><span>{displayDateOnly(risk.date)} · {risk.jobRoleName}</span><strong>{risk.deficit} {risk.deficit === 1 ? 'pessoa em falta' : 'pessoas em falta'}</strong><small>{risk.required} ainda necessárias · {risk.free} livres após vagas confirmadas</small><p>{risk.projects.map(project => `${project.code} · ${project.name}`).join(' · ')}</p></article>)}</div> : <p className="efetivo-period-clear">Nenhum risco de equipe nas mobilizações planejadas deste período.</p>}
      </section>

      {view === 'kanban' ? <section className="efetivo-availability-kanban" aria-label="Disponibilidade dos colaboradores">
        {STATUSES.map(status => <div className="efetivo-kanban-column efetivo-availability-column" data-availability-status={status} key={status}>
          <header><div><strong><span className="efetivo-stage-dot" aria-hidden="true" />{STATUS_META[status].label}</strong><span>{columns[status].length}</span></div><small>{STATUS_META[status].description}</small></header>
          <div className="efetivo-kanban-list">{columns[status].length ? columns[status].map(person => {
            const counts = STATUSES.map(dayStatus => ({ status: dayStatus, count: person.days.filter(day => day.status === dayStatus).length })).filter(item => item.count);
            const outsideDays = data.days.length - person.days.length;
            const details = [...new Set(person.days.map(day => day.detail).filter(Boolean))];
            return <article className="efetivo-availability-card" data-collaborator-id={person.id} key={person.id}>
              <div className="efetivo-availability-person"><i aria-hidden="true">{initials(person.name)}</i><span><strong>{person.name}</strong><small>{person.role}</small></span></div>
              <div className="efetivo-period-person-counts">{counts.map(item => <span data-availability-status={item.status} key={item.status}>{item.count} {item.count === 1 ? 'dia' : 'dias'} · {STATUS_META[item.status].short}</span>)}{outsideDays ? <span data-availability-status="OUTSIDE_EMPLOYMENT">{outsideDays} {outsideDays === 1 ? 'dia' : 'dias'} · Fora do vínculo</span> : null}</div>
              {details.length ? <div className="efetivo-availability-context"><small title={details.join(' · ')}>{details.slice(0, 2).join(' · ')}{details.length > 2 ? ` +${details.length - 2}` : ''}</small></div> : null}
            </article>;
          }) : <p className="efetivo-kanban-empty">Nenhum colaborador nesta situação</p>}</div>
        </div>)}
      </section> : <section className="page-card efetivo-period-calendar" aria-label="Calendário de disponibilidade">
        <div className="efetivo-section-heading"><div><h2>Calendário da equipe</h2><p>{calendar.scale === 'day' ? 'Visão diária' : calendar.scale === 'week' ? 'Visão semanal' : 'Visão mensal'} para caber na tela. Cada faixa de cor representa um dia; passe sobre ela para ver os detalhes.</p></div></div>
        <div className="efetivo-period-legend">{STATUSES.map(status => <span data-availability-status={status} key={status}><i />{STATUS_META[status].short}</span>)}<span data-availability-status="OUTSIDE_EMPLOYMENT"><i />Fora do vínculo</span></div>
        <div className="efetivo-period-surface"><div className="efetivo-period-matrix" data-calendar-scale={calendar.scale} style={{ '--period-days': calendar.buckets.length } as CSSProperties}>
          <div className="efetivo-period-name efetivo-period-heading">Colaborador</div>
          {calendar.buckets.map(bucket => <div className="efetivo-period-day-heading" title={bucketPeriod(bucket)} key={bucket.key}>{bucketLabel(bucket, calendar.scale)}</div>)}
          <div className="efetivo-period-name efetivo-period-demand-label">Vagas abertas</div>
          {calendar.buckets.map(bucket => {
            const peak = Math.max(...bucket.dates.map(date => dayDeficit.get(date) || 0));
            return <div className={`efetivo-period-demand-day ${peak ? 'has-deficit' : ''}`} title={`${bucketPeriod(bucket)} · pico de ${peak} vaga(s) em aberto em um dia`} key={bucket.key}>{peak || '·'}</div>;
          })}
          {deficitRoles.map(role => <div className="efetivo-period-row" key={role.jobRoleId}>
            <div className="efetivo-period-name efetivo-period-role-label" title={role.jobRoleName}>{role.jobRoleName}</div>
            {calendar.buckets.map(bucket => {
              const daily = role.daily.filter(day => bucket.dates.includes(day.date));
              const peak = Math.max(0, ...daily.map(day => day.deficit));
              return <div className={`efetivo-period-demand-day efetivo-period-role-day ${peak ? 'has-deficit' : ''}`} title={`${role.jobRoleName} · ${bucketPeriod(bucket)} · pico de ${peak} vaga(s) em aberto em um dia`} key={bucket.key}>{peak || '·'}</div>;
            })}
          </div>)}
          <div className="efetivo-period-name efetivo-period-demand-label">Risco planejado</div>
          {calendar.buckets.map(bucket => {
            const peak = Math.max(...bucket.dates.map(date => riskByDay.get(date) || 0));
            return <div className={`efetivo-period-demand-day ${peak ? 'has-risk' : ''}`} title={`${bucketPeriod(bucket)} · pico de ${peak} pessoa(s) em falta nas mobilizações planejadas em um dia`} key={bucket.key}>{peak || '·'}</div>;
          })}
          {data.people.map(person => {
            const byDate = new Map(person.days.map(day => [day.date, day]));
            return <div className="efetivo-period-row" key={person.id} data-collaborator-id={person.id}>
              <div className="efetivo-period-name"><strong>{person.name}</strong><small>{person.role}</small></div>
              {calendar.buckets.map(bucket => <AvailabilityCalendarCell personName={person.name} bucket={bucket} byDate={byDate} key={bucket.key} />)}
            </div>;
          })}
        </div></div>
        {!data.people.length ? <p className="placeholder-copy">Nenhum colaborador no período selecionado.</p> : null}
      </section>}
    </div>
  );
}
