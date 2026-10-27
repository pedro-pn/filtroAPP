// Horas próprias do cadastro têm prioridade; a fase define os dias incluídos.
// Revisões antigas continuam usando a jornada da fase. Cenários por cargo não entram aqui.
export function commercialProjectWorkSchedule(snapshot) {
  const payload = snapshot?.costBreakdown;
  if (!payload || payload.scopeConfirmations?.noLabor) return {};
  const phases = Array.isArray(payload.laborContexts) ? payload.laborContexts.filter(phase => phase.enabled !== false) : [];
  const selected = payload.projectWorkScheduleContextId;
  const phase = selected ? phases.find(item => item.id === selected) : phases.length === 1 ? phases[0] : null;
  if (!phase) return {};
  const duration = hours => {
    if (typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0 || hours > 24) return null;
    const minutes = Math.round(hours * 60);
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  };
  const schedule = payload.projectWorkSchedule;
  const workdayHours = duration(schedule === undefined ? phase.hoursPerDay : schedule?.workdayHours);
  const includesSaturday = typeof phase.includeSaturday === 'boolean' ? phase.includeSaturday
    : typeof phase.saturdayCount === 'number' && phase.saturdayCount > 0;
  const includesSunday = typeof phase.includeSunday === 'boolean' ? phase.includeSunday
    : typeof phase.sundayCount === 'number' && phase.sundayCount > 0;
  const weekend = includesSunday ? phase.sundayHoursPerDay : phase.saturdayHoursPerDay;
  const weekendWorkdayHours = duration(schedule === undefined ? weekend : schedule?.weekendWorkdayHours);
  if (!workdayHours || (schedule !== undefined || includesSaturday || includesSunday) && !weekendWorkdayHours) return {};
  return { workdayHours, ...(weekendWorkdayHours ? { weekendWorkdayHours } : {}), includesSaturday, includesSunday };
}
