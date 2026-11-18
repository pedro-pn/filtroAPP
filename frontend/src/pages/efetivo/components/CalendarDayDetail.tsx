import type { CalendarEvent, PlanningConflict } from '../../../api/efetivoPlanning';
import { Link } from 'react-router';

import { Alert, EmptyState } from '../../../components/ui/ds';
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
    <div className="efetivo-day-detail" data-efetivo-calendar-day>
      <p className="efetivo-dialog-description">Eventos, pessoas e vagas desta data.</p>
      {dayConflicts.length ? (
        <Alert tone="danger" title={`${dayConflicts.length} ${dayConflicts.length === 1 ? 'conflito nesta data' : 'conflitos nesta data'}`}>
          <div className="efetivo-day-conflict-list">
            {dayConflicts.map(conflict => {
              const content = <><strong>{conflict.collaboratorName}</strong><span>{conflictLabel[conflict.code] || 'Conflito de programação'} · {displayDateOnly(conflict.startDate)} a {displayDateOnly(conflict.endDate)}</span></>;
              const key = `${conflict.code}-${conflict.collaboratorId}-${conflict.sourceId}`;
              return conflict.entityPath
                ? <Link to={conflict.entityPath} key={key}>{content}</Link>
                : <div key={key}>{content}</div>;
            })}
          </div>
        </Alert>
      ) : null}
      {matching.length ? <div className="efetivo-day-list">{matching.map(event => (
        <Link key={`${event.type}-${event.id}`} to={event.entityPath}>
          <strong><span className={`efetivo-event-dot type-${event.type.toLocaleLowerCase('pt-BR')}`} />{event.title}</strong>
          <span>{typeLabel[event.type]} · {displayDateOnly(event.startDate)} a {displayDateOnly(event.endDate)}{event.demand != null ? ` · ${event.allocated}/${event.demand} alocados` : ''}</span>
          {event.people?.length ? <small className="efetivo-day-people">{event.people.map(person => person.name).join(' · ')}</small> : event.type === 'MISSION' ? <small className="efetivo-day-people">Nenhuma pessoa alocada ainda.</small> : null}
          {event.demand != null && event.demand > (event.allocated || 0) ? <small className="efetivo-day-open">{event.demand - (event.allocated || 0)} vagas em aberto</small> : null}
        </Link>
      ))}</div> : <EmptyState title="Nenhum evento neste dia" description="Não há missões ou ausências programadas para esta data." icon={null} />}
    </div>
  );
}
