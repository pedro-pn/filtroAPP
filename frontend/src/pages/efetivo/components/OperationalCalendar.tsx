import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { getPlanningCalendar } from '../../../api/efetivoPlanning';
import { Alert, Button, Card, IconButton, Skeleton } from '../../../components/ui/ds';
import { Modal } from '../../../components/ui/Modal';
import { calendarInterval, displayDateOnly, monthCalendarGrid, moveCalendarPosition, todayDateOnly } from '../../../utils/calendarGrid';
import { CalendarDayDetail } from './CalendarDayDetail';
import { calendarBusyPeopleOnDay, calendarEventPeopleOnDay } from './calendarDayEvents';
import '../EfetivoDialogs.css';

type CalendarView = 'day' | 'week' | 'month';

const WEEKDAY_LABELS = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'];

export function OperationalCalendar({
  date,
  view,
  jobRoleId,
  selectedDay,
  dayOpen,
  onDayClose,
  onDateChange,
  onViewChange,
  onDaySelect
}: {
  date: string;
  view: CalendarView;
  jobRoleId?: string;
  selectedDay: string;
  dayOpen: boolean;
  onDayClose: () => void;
  onDateChange: (value: string) => void;
  onViewChange: (value: CalendarView) => void;
  onDaySelect: (value: string) => void;
}) {
  const interval = calendarInterval(date, view);
  const days = view === 'month'
    ? monthCalendarGrid(date)
    : Array.from({ length: view === 'week' ? 7 : 1 }, () => view === 'day' ? date : interval.startDate).map((value, index) => {
      const parsed = new Date(`${value}T00:00:00.000Z`); parsed.setUTCDate(parsed.getUTCDate() + index); return parsed.toISOString().slice(0, 10);
    });
  // Include adjacent-month cells and a directly linked day in the loaded range.
  const startDate = dayOpen && selectedDay < days[0] ? selectedDay : days[0];
  const endDate = dayOpen && selectedDay > days[days.length - 1] ? selectedDay : days[days.length - 1];
  const query = useQuery({
    queryKey: ['efetivo-planning-calendar', startDate, endDate, jobRoleId || 'all'],
    queryFn: () => getPlanningCalendar(startDate, endDate, jobRoleId)
  });
  const events = query.data?.events || [];
  const conflicts = query.data?.conflicts || [];
  return (
    <div className="efetivo-calendar-layout efetivo-calendar-layout--expanded" data-efetivo-calendar>
      <Card className="efetivo-calendar-main" padding="md">
        <div className="efetivo-calendar-toolbar">
          <div className="efetivo-action-row"><IconButton size="sm" variant="secondary" icon={ChevronLeft} label="Período anterior" onClick={() => onDateChange(moveCalendarPosition(date, view, -1))} /><Button size="sm" variant="secondary" onClick={() => onDateChange(todayDateOnly())}>Hoje</Button><IconButton size="sm" variant="secondary" icon={ChevronRight} label="Próximo período" onClick={() => onDateChange(moveCalendarPosition(date, view, 1))} /></div>
          <strong>{displayDateOnly(date, { month: 'long', year: 'numeric' })}</strong>
          <div className="efetivo-segmented" role="group" aria-label="Visualização do calendário">{(['day', 'week', 'month'] as const).map(option => <button type="button" className={view === option ? 'active' : ''} aria-pressed={view === option} onClick={() => onViewChange(option)} key={option}>{option === 'day' ? 'Dia' : option === 'week' ? 'Semana' : 'Mês'}</button>)}</div>
        </div>
        <div className="efetivo-calendar-legend"><span><i className="type-mission" />Missões</span><span><i className="type-ferias" />Férias</span><span><i className="type-folga" />Folgas</span><span><i className="type-afastamento" />Afastamentos</span><span><i className="type-fadiga_offshore" />Fadiga - offshore</span></div>
        {query.isLoading ? <Skeleton variant="block" height={420} label="Carregando agenda" /> : query.isError ? <Alert tone="danger" title="Não foi possível carregar o calendário" action={{ label: 'Tentar novamente', onClick: () => query.refetch() }}>Verifique a conexão e tente novamente.</Alert> : (
          <>
          {view === 'month' ? <div className="efetivo-calendar-weekdays" aria-hidden="true">{WEEKDAY_LABELS.map(label => <span key={label}>{label}</span>)}</div> : null}
          <div className={`efetivo-calendar-grid view-${view}`}>
            {days.map((day, dayIndex) => {
              const dayEvents = events.filter(event => event.startDate <= day && event.endDate >= day);
              const visibleEvents = view === 'day' ? dayEvents : dayEvents.slice(0, 3);
              const hiddenEventCount = dayEvents.length - visibleEvents.length;
              const matchingConflicts = conflicts.filter(conflict => conflict.startDate <= day && conflict.endDate >= day);
              const dayConflicts = matchingConflicts.length;
              const busyPeople = calendarBusyPeopleOnDay(dayEvents, day);
              const visibleBusyPeople = view === 'month' ? busyPeople.slice(0, 2) : view === 'week' ? busyPeople.slice(0, 4) : busyPeople;
              const hiddenBusyPeople = busyPeople.length - visibleBusyPeople.length;
              return (
                <button
                  type="button"
                  className={`${day === selectedDay ? 'selected' : ''} ${day.slice(0, 7) !== date.slice(0, 7) ? 'outside' : ''} ${dayConflicts ? 'has-conflict' : ''} ${dayIndex % 7 >= 5 ? 'tooltip-align-end' : ''}`}
                  aria-pressed={day === selectedDay}
                  aria-haspopup="dialog"
                  aria-label={`Ver eventos de ${displayDateOnly(day)}${dayConflicts ? `, ${dayConflicts} conflitos` : ''}${dayEvents.length ? `, ${dayEvents.length} eventos` : ', sem eventos'}, ${busyPeople.length} colaborador${busyPeople.length === 1 ? '' : 'es'} ocupado${busyPeople.length === 1 ? '' : 's'}`}
                  key={day}
                  onClick={() => onDaySelect(day)}
                >
                  <time dateTime={day}>
                    {displayDateOnly(day, { weekday: 'short', day: '2-digit' })}
                    {dayConflicts ? <b className="efetivo-day-conflict-flag" title={`${dayConflicts} conflito(s) nesta data`}>!</b> : null}
                  </time>
                  {busyPeople.length ? <span className="efetivo-calendar-busy">
                    <span className="efetivo-calendar-busy__heading">Colaboradores ocupados <strong>{busyPeople.length}</strong></span>
                    <span className="efetivo-calendar-busy__people">
                      {visibleBusyPeople.map(person => <span className="efetivo-calendar-busy__person" key={person.id}>{person.name}</span>)}
                      {hiddenBusyPeople ? <span className="efetivo-calendar-busy__more">+{hiddenBusyPeople}</span> : null}
                    </span>
                  </span> : null}
                  <span className="efetivo-calendar-events">
                    {visibleEvents.map(event => {
                      const dayPeople = calendarEventPeopleOnDay(event, day);
                      return <small className={`type-${event.type.toLocaleLowerCase('pt-BR')}`} key={`${event.type}-${event.id}`}><span className="efetivo-calendar-event-title">{event.title}</span>{event.type === 'MISSION' ? <span className="efetivo-calendar-event-people">{dayPeople.length ? dayPeople.map(person => person.name).join(' · ') : 'Sem colaboradores alocados'}</span> : null}</small>;
                    })}
                    {hiddenEventCount > 0 ? <small>+{hiddenEventCount} eventos</small> : null}
                  </span>
                  <span className="efetivo-calendar-tooltip" role="tooltip">
                    <span className="efetivo-calendar-tooltip__heading">{displayDateOnly(day, { weekday: 'long', day: '2-digit', month: 'long' })}</span>
                    <span className="efetivo-calendar-tooltip__busy">
                      <strong>Colaboradores ocupados ({busyPeople.length})</strong>
                      {busyPeople.length ? busyPeople.map(person => <span key={person.id}><b>{person.name}</b><small>{person.missions.join(' · ')}</small></span>) : <span>Nenhum colaborador alocado.</span>}
                    </span>
                    {dayEvents.length ? dayEvents.map(event => {
                      const dayPeople = calendarEventPeopleOnDay(event, day);
                      return <span className="efetivo-calendar-tooltip__event" key={`${event.type}-${event.id}`}>
                        <strong>{event.title}</strong>
                        <span>{displayDateOnly(event.startDate)} a {displayDateOnly(event.endDate)}</span>
                        {event.type === 'MISSION' ? <span>{dayPeople.length ? dayPeople.map(person => person.name).join(' · ') : 'Sem colaboradores alocados'}{event.demand != null ? ` · ${dayPeople.length}/${event.demand} alocados` : ''}{event.demand != null && event.demand > dayPeople.length ? ` · ${event.demand - dayPeople.length} vagas` : ''}</span> : <span>{event.type === 'FERIAS' ? 'Férias' : event.type === 'FOLGA' ? 'Folga' : event.type === 'FADIGA_OFFSHORE' ? 'Fadiga - offshore' : 'Afastamento'}</span>}
                      </span>;
                    }) : <span>Nenhum evento neste dia.</span>}
                    {matchingConflicts.length ? <span className="efetivo-calendar-tooltip__conflicts"><strong>{matchingConflicts.length} conflito{matchingConflicts.length === 1 ? '' : 's'}</strong>{matchingConflicts.map((conflict, index) => <span key={`${conflict.code}-${conflict.collaboratorId}-${index}`}>{conflict.collaboratorName} · {conflict.code === 'DOUBLE_BOOKING' ? 'Duas missões' : 'Sobreposição com ausência'}</span>)}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
          </>
        )}
      </Card>
      <Modal
        open={dayOpen}
        onClose={onDayClose}
        appearance="design-system"
        title={displayDateOnly(selectedDay, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
        size="lg"
        fullscreenOnMobile={false}
        panelClassName="efetivo-dialog"
        closeOnBackdrop
        footer={<Button variant="secondary" size="sm" onClick={onDayClose}>Fechar</Button>}
      >
        {query.isLoading
          ? <Skeleton variant="card" label="Carregando eventos do dia" />
          : query.isError
            ? <Alert tone="danger" title="Não foi possível carregar os eventos" action={{ label: 'Tentar novamente', onClick: () => query.refetch() }} />
            : <CalendarDayDetail date={selectedDay} events={events} conflicts={conflicts} />}
      </Modal>
    </div>
  );
}
