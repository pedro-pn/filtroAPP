import type { CalendarEvent } from '../../../api/efetivoPlanning';

export function calendarEventPeopleOnDay(event: CalendarEvent, day: string) {
  return (event.people || []).filter(person => !person.periods?.length || person.periods.some(period => period.startDate <= day && period.endDate >= day));
}

export function calendarBusyPeopleOnDay(events: CalendarEvent[], day: string) {
  const people = new Map<string, { id: string; name: string; missions: string[] }>();
  for (const event of events) {
    if (event.type !== 'MISSION' || event.startDate > day || event.endDate < day) continue;
    for (const person of calendarEventPeopleOnDay(event, day)) {
      const current = people.get(person.id);
      if (current) {
        if (!current.missions.includes(event.title)) current.missions.push(event.title);
      } else {
        people.set(person.id, { id: person.id, name: person.name, missions: [event.title] });
      }
    }
  }
  return [...people.values()].sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
}
