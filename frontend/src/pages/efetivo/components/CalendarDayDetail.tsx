import type { CalendarEvent, PlanningConflict } from '../../../api/efetivoPlanning';
import { displayDateOnly } from '../../../utils/calendarGrid';

const typeLabel: Record<CalendarEvent['type'], string> = { MISSION: 'Missão', FERIAS: 'Férias', FOLGA: 'Folga', AFASTAMENTO: 'Afastamento' };

const conflictLabel: Record<string, string> = {
  DOUBLE_BOOKING: 'Duas missões confirmadas no mesmo período',
  ABSENCE_FERIAS: 'Férias sobrepostas à missão',
  ABSENCE_FOLGA: 'Folga sobreposta à missão',
  ABSENCE_AFASTAMENTO: 'Afastamento sobreposto à missão'
};

export function CalendarDayDetail({ date, events, conflicts }: { date: string; events: CalendarEvent[]; conflicts: PlanningConflict[] }) {
  const matching = events.filter(event => event.startDate <= date && event.endDate >= date);
  const dayConflicts = conflicts.filter(conflict => conflict.startDate <= date && conflict.endDate >= date);
  return (
    <aside className="page-card efetivo-day-detail" data-efetivo-calendar-day>
      <div className="efetivo-section-heading"><div><h2>{displayDateOnly(date, { weekday: 'long', day: '2-digit', month: 'long' })}</h2><p>Eventos, pessoas e vagas desta data.</p></div></div>
      {dayConflicts.length ? (
        <div className="efetivo-day-conflicts" role="status">
          <strong>{dayConflicts.length} {dayConflicts.length === 1 ? 'conflito nesta data' : 'conflitos nesta data'}</strong>
          {dayConflicts.map(conflict => (
            <a href={conflict.entityPath || undefined} key={`${conflict.code}-${conflict.collaboratorId}-${conflict.sourceId}`}>
              <strong>{conflict.collaboratorName}</strong>
              <span>{conflictLabel[conflict.code] || 'Conflito de programação'} · {displayDateOnly(conflict.startDate)} a {displayDateOnly(conflict.endDate)}</span>
            </a>
          ))}
        </div>
      ) : null}
      {matching.length ? <div className="efetivo-day-list">{matching.map(event => (
        <a key={`${event.type}-${event.id}`} href={event.entityPath}>
          <strong><span className={`efetivo-event-dot type-${event.type.toLocaleLowerCase('pt-BR')}`} />{event.title}</strong>
          <span>{typeLabel[event.type]} · {displayDateOnly(event.startDate)} a {displayDateOnly(event.endDate)}{event.demand != null ? ` · ${event.allocated}/${event.demand} alocados` : ''}</span>
          {event.people?.length ? <small className="efetivo-day-people">{event.people.map(person => person.name).join(' · ')}</small> : event.type === 'MISSION' ? <small className="efetivo-day-people">Nenhuma pessoa alocada ainda.</small> : null}
          {event.demand != null && event.demand > (event.allocated || 0) ? <small className="efetivo-day-open">{event.demand - (event.allocated || 0)} vagas em aberto</small> : null}
        </a>
      ))}</div> : <p className="placeholder-copy">Nenhum evento neste dia.</p>}
    </aside>
  );
}
