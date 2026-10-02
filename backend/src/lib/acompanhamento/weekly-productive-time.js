import { dateOnlyKey } from '../../../../shared/modules/mission-weekly-progress.js';
import { isPointWorkbookDerivedRdoRoster } from './avanco.js';
import { normalizeRdoServiceType } from './service-types.js';

const DAY = 1440;
const ids = value => [...new Set((Array.isArray(value) ? value : []).filter(id => typeof id === 'string' && id.trim()))];
function clock(value) {
  const match = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);
  return match && +match[1] < 24 && +match[2] < 60 ? +match[1] * 60 + +match[2] : null;
}
function duration(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'sem intervalo' || text === '0') return 0;
  const match = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/) ?? text.match(/^(\d{1,2})h(\d{1,2})$/);
  if (match && +match[2] < 60) return +match[1] * 60 + +match[2];
  const hours = text.match(/^(\d{1,2})\s*h(?:ora|oras)?$/);
  if (hours) return +hours[1] * 60;
  const minutes = text.match(/^(\d{1,3})\s*min$/);
  return minutes ? +minutes[1] : null;
}
function interval(startValue, endValue) {
  const start = clock(startValue), end = clock(endValue);
  return start == null || end == null || start === end ? null : { start, end: end < start ? end + DAY : end };
}
function unionLength(entries) {
  let end = -Infinity, total = 0;
  for (const entry of [...entries].sort((a, b) => a.start - b.start)) {
    total += Math.max(0, entry.end - Math.max(end, entry.start));
    end = Math.max(end, entry.end);
  }
  return total;
}

// Usa somente equipe explicitamente vinculada ao serviço e à jornada do RDO.
// Não transforma o efetivo do cronograma, uma contagem ou um roster de ponto em produção.
export function buildWeeklyProductiveHistory(reports = [], nightCollaborators = []) {
  const people = new Map(nightCollaborators.map(person => [person.id, person]));
  const buckets = new Map(), byPerson = new Map();
  const bucketFor = (date, serviceType) => {
    const key = `${date}:${serviceType}`;
    if (!buckets.has(key)) buckets.set(key, { date, serviceType, quantities: { M: 0, L: 0, UN: 0 },
      productivePersonMinutes: 0, productivityIssues: new Set() });
    return buckets.get(key);
  };
  for (const report of reports) {
    const date = dateOnlyKey(report.reportDate);
    if (!date || report.deletedAt || report.reportType !== 'RDO') continue;
    const special = report.specialConditions ?? {}, night = special.noturnoDetails ?? {};
    const dayCrew = new Map((report.collaborators ?? []).map(link => [link.collaboratorId, link]));
    const nightCrew = ids(night.collaboratorIds);
    const standby = special.standby ? duration(special.standbyDetails?.total) : 0;
    const day = interval(report.arrivalTime, report.departureTime);
    const nightTurn = (special.noturno || night.enabled) ? interval(night.inicio, night.termino) : null;
    const shifts = [
      { interval: day, crew: [...dayCrew.keys()], pause: duration(report.lunchBreak), standby },
      { interval: nightTurn, crew: nightCrew, pause: duration(night.intervalo ?? night.jantaIntervalo ?? 'sem intervalo'), standby: day ? 0 : standby }
    ];
    if (day && nightTurn && nightTurn.start < day.end) {
      nightTurn.start += DAY;
      nightTurn.end += DAY;
    }
    const entriesByShiftPerson = new Map();
    for (const service of report.services ?? []) {
      const serviceType = normalizeRdoServiceType(service.serviceType);
      if (!serviceType) continue; // Deslocamento e outros períodos fora dos serviços não entram.
      const bucket = bucketFor(date, serviceType), extra = service.extraData ?? {};
      const field = extra['Colaboradores do serviço'] ?? extra['Colaboradores do servico'] ?? extra['Colaboradores do serviÃ§o'];
      const crew = ids(extra.serviceCollaboratorIds ?? field?.ids);
      const times = interval(service.startTime ?? extra['Hora de início'], service.endTime ?? extra['Hora de término/pausa']);
      if (isPointWorkbookDerivedRdoRoster(report)) { bucket.productivityIssues.add('UNCONFIRMED_TEAM'); continue; }
      if (!crew.length) { bucket.productivityIssues.add('MISSING_TEAM'); continue; }
      if (!times) { bucket.productivityIssues.add('MISSING_TIME'); continue; }
      for (const personId of crew) {
        const link = dayCrew.get(personId);
        const person = link?.collaborator ?? people.get(personId);
        const role = link?.jobRoleSnapshot ?? person?.jobRole;
        if (role?.isOperational === false) continue;
        if (!role || role.isOperational !== true) { bucket.productivityIssues.add('MISSING_ROLE'); continue; }
        const assignedShifts = shifts.filter(shift => shift.crew.includes(personId));
        if (!assignedShifts.length) { bucket.productivityIssues.add('UNCONFIRMED_TEAM'); continue; }
        let matched = false;
        for (const [shiftIndex, shift] of shifts.entries()) {
          if (!shift.crew.includes(personId)) continue;
          if (!shift.interval || shift.pause == null || shift.standby == null) { bucket.productivityIssues.add('MISSING_TIME'); continue; }
          for (const offset of [0, DAY]) {
            const start = Math.max(times.start + offset, shift.interval.start);
            const end = Math.min(times.end + offset, shift.interval.end);
            if (end <= start) continue;
            matched = true;
            const key = `${shiftIndex}:${personId}`;
            if (!entriesByShiftPerson.has(key)) entriesByShiftPerson.set(key, { personId, shift, entries: [] });
            entriesByShiftPerson.get(key).entries.push({ start, end, serviceType });
          }
        }
        if (!matched) bucket.productivityIssues.add('MISSING_TIME');
      }
    }
    const dayStart = new Date(`${date}T00:00:00Z`).getTime() / 60000;
    for (const { personId, shift, entries } of entriesByShiftPerson.values()) {
      // Pausas sem horário exato limitam as horas disponíveis. Havendo excesso sobre
      // esse limite, o desconto é proporcional entre serviços, sem descontar duas
      // vezes uma pausa já representada pelo intervalo entre os serviços.
      const available = Math.max(0, shift.interval.end - shift.interval.start - shift.pause - shift.standby);
      const factor = Math.min(1, available / unionLength(entries));
      if (!byPerson.has(personId)) byPerson.set(personId, []);
      byPerson.get(personId).push(...entries.map(entry => ({ ...entry, start: entry.start + dayStart, end: entry.end + dayStart, factor })));
    }
  }
  for (const entries of byPerson.values()) {
    const events = entries.flatMap((entry, id) => [{ time: entry.start, id, entry }, { time: entry.end, id, entry: null }])
      .sort((a, b) => a.time - b.time);
    const activeEntries = new Map();
    for (let index = 0; index < events.length;) {
      const start = events[index].time;
      while (index < events.length && events[index].time === start) {
        const event = events[index++];
        if (event.entry) activeEntries.set(event.id, event.entry);
        else activeEntries.delete(event.id);
      }
      if (index === events.length) break;
      const end = events[index].time;
      const active = [...activeEntries.values()];
      if (!active.length) continue;
      const types = [...new Set(active.map(entry => entry.serviceType))];
      // Divide somente na virada da data. RDOs repetidos do mesmo serviço contam
      // uma vez; tipos diferentes simultâneos pedem correção, não um rateio inventado.
      for (let cursor = start; cursor < end;) {
        const stop = Math.min(end, (Math.floor(cursor / DAY) + 1) * DAY);
        const date = new Date(cursor * 60000).toISOString().slice(0, 10);
        for (const type of types) {
          const bucket = bucketFor(date, type);
          if (types.length > 1) bucket.productivityIssues.add('OVERLAPPING_SERVICES');
          else bucket.productivePersonMinutes += (stop - cursor) * Math.max(...active.map(entry => entry.factor));
        }
        cursor = stop;
      }
    }
  }
  return [...buckets.values()].map(bucket => ({ ...bucket, productivityIssues: [...bucket.productivityIssues].sort() }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.serviceType.localeCompare(b.serviceType));
}

export async function loadWeeklyProductiveHistory(projectIds, client) {
  const reports = await client.report.findMany({
    where: { projectId: { in: projectIds }, reportType: 'RDO', deletedAt: null },
    select: { reportType: true, reportDate: true, arrivalTime: true, departureTime: true, lunchBreak: true, specialConditions: true,
      collaborators: { select: { collaboratorId: true, jobRoleSnapshot: { select: { isOperational: true } },
        collaborator: { select: { jobRole: { select: { isOperational: true } } } } } },
      services: { select: { serviceType: true, startTime: true, endTime: true, extraData: true } } }
  });
  const nightIds = ids(reports.flatMap(report => ids(report.specialConditions?.noturnoDetails?.collaboratorIds)));
  const nightPeople = nightIds.length ? await client.collaborator.findMany({
    where: { id: { in: nightIds } }, select: { id: true, jobRole: { select: { isOperational: true } } }
  }) : [];
  return buildWeeklyProductiveHistory(reports, nightPeople);
}
