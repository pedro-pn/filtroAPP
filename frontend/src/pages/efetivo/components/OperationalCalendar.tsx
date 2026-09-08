import { useQuery } from '@tanstack/react-query';

import { getPlanningCalendar } from '../../../api/efetivoPlanning';
import { Button } from '../../../components/ui/Button';
import { calendarInterval, displayDateOnly, monthCalendarGrid, moveCalendarPosition, todayDateOnly } from '../../../utils/calendarGrid';
import { CalendarDayDetail } from './CalendarDayDetail';

type CalendarView = 'day' | 'week' | 'month';

const WEEKDAY_LABELS = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'];

export function OperationalCalendar({
  date,
  view,
  jobRoleId,
  selectedDay,
  onDateChange,
  onViewChange,
  onDaySelect
}: {
  date: string;
  view: CalendarView;
  jobRoleId?: string;
  selectedDay: string;
  onDateChange: (value: string) => void;
  onViewChange: (value: CalendarView) => void;
  onDaySelect: (value: string) => void;
}) {
  const interval = calendarInterval(date, view);
  const query = useQuery({
    queryKey: ['efetivo-planning-calendar', interval.startDate, interval.endDate, jobRoleId || 'all'],
    queryFn: () => getPlanningCalendar(interval.startDate, interval.endDate, jobRoleId)
  });
  const events = query.data?.events || [];
  const conflicts = query.data?.conflicts || [];
  const days = view === 'month'
    ? monthCalendarGrid(date)
    : Array.from({ length: view === 'week' ? 7 : 1 }, () => view === 'day' ? date : calendarInterval(date, 'week').startDate).map((value, index) => {
      const parsed = new Date(`${value}T00:00:00.000Z`); parsed.setUTCDate(parsed.getUTCDate() + index); return parsed.toISOString().slice(0, 10);
    });
  return (
    <div className="efetivo-calendar-layout" data-efetivo-calendar>
      <section className="page-card efetivo-calendar-main">
        <div className="efetivo-calendar-toolbar">
          <div className="efetivo-action-row"><Button variant="secondary" onClick={() => onDateChange(moveCalendarPosition(date, view, -1))}>←</Button><Button variant="secondary" onClick={() => onDateChange(todayDateOnly())}>Hoje</Button><Button variant="secondary" onClick={() => onDateChange(moveCalendarPosition(date, view, 1))}>→</Button></div>
          <strong>{displayDateOnly(date, { month: 'long', year: 'numeric' })}</strong>
          <div className="efetivo-segmented" role="group" aria-label="Visualização do calendário">{(['day', 'week', 'month'] as const).map(option => <button type="button" className={view === option ? 'active' : ''} onClick={() => onViewChange(option)} key={option}>{option === 'day' ? 'Dia' : option === 'week' ? 'Semana' : 'Mês'}</button>)}</div>
        </div>
        <div className="efetivo-calendar-legend"><span><i className="type-mission" />Missões</span><span><i className="type-ferias" />Férias</span><span><i className="type-folga" />Folgas</span><span><i className="type-afastamento" />Afastamentos</span></div>
        {query.isLoading ? <p className="placeholder-copy">Carregando agenda…</p> : query.isError ? <p className="placeholder-copy">Não foi possível carregar o calendário.</p> : (
          <>
          {view === 'month' ? <div className="efetivo-calendar-weekdays" aria-hidden="true">{WEEKDAY_LABELS.map(label => <span key={label}>{label}</span>)}</div> : null}
          <div className={`efetivo-calendar-grid view-${view}`}>
            {days.map(day => {
              const dayEvents = events.filter(event => event.startDate <= day && event.endDate >= day);
              const dayConflicts = conflicts.filter(conflict => conflict.startDate <= day && conflict.endDate >= day).length;
              return <button type="button" className={`${day === selectedDay ? 'selected' : ''} ${day.slice(0, 7) !== date.slice(0, 7) ? 'outside' : ''} ${dayConflicts ? 'has-conflict' : ''}`} key={day} onClick={() => onDaySelect(day)}><time dateTime={day}>{displayDateOnly(day, { weekday: view === 'month' ? undefined : 'short', day: '2-digit' })}{dayConflicts ? <b className="efetivo-day-conflict-flag" title={`${dayConflicts} conflito(s) nesta data`}>!</b> : null}</time><span className="efetivo-calendar-events">{dayEvents.slice(0, 3).map(event => <small className={`type-${event.type.toLocaleLowerCase('pt-BR')}`} key={`${event.type}-${event.id}`}>{event.title}</small>)}{dayEvents.length > 3 ? <small>+{dayEvents.length - 3} eventos</small> : null}</span></button>;
            })}
          </div>
          </>
        )}
      </section>
      <CalendarDayDetail date={selectedDay} events={events} conflicts={conflicts} />
    </div>
  );
}
