function dateKey(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value?.slice(0, 10);
}

/** A planned default cycle follows the schedule until actual mobilization is confirmed. */
export function hasEditableDefaultMissionCycle(mission) {
  if (mission.project?.workflow?.actualMobilizationDate || mission.cycles?.length !== 1) return false;
  const [cycle] = mission.cycles;
  if (cycle.isDefault === false) return false;
  // Legacy Standby cycles can contain the forecast end and an outdated start.
  // Keep a manually recorded end that differs from that forecast.
  if (mission.stage === 'STANDBY' && (!cycle.demobilizationDate
    || dateKey(cycle.demobilizationDate) === dateKey(mission.returnDate || mission.executionEndDate))) return true;
  return !cycle.demobilizationDate && dateKey(cycle.mobilizationDate) === dateKey(mission.mobilizationDate);
}
