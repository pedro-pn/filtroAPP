function numberValue(value) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function integerValue(value) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function uniqueIds(values = []) {
  return Array.from(new Set(values.filter(id => typeof id === 'string' && id.trim())));
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function parseMinutes(value) {
  if (!value) return 0;
  if (typeof value === 'number') return numberValue(value);
  const str = String(value).trim();
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  const parts = str.split(':');
  if (parts.length >= 2) return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
  return 0;
}

function clampMinutes(value, max) {
  return Math.min(numberValue(value), Math.max(0, max));
}

function turnCount(minutes, primaryCount, fallbackCount = 0) {
  if (minutes <= 0) return 0;
  return primaryCount || fallbackCount || 1;
}

export function dayCollaboratorIdsFromReport(report) {
  if (Array.isArray(report?.collaborators)) {
    return uniqueIds(report.collaborators.map(link => link?.collaboratorId));
  }
  if (Array.isArray(report?.collaboratorIds)) return uniqueIds(report.collaboratorIds);
  return [];
}

export function nightCollaboratorIdsFromReport(report) {
  const special = plainObject(report?.specialConditions);
  const noturnoDetails = plainObject(special.noturnoDetails);
  return uniqueIds(noturnoDetails.collaboratorIds);
}

function overtimeByTurn(report, daytimeWorkedMinutes, nighttimeWorkedMinutes) {
  let daytimeOvertimeMinutes = clampMinutes(report?.daytimeOvertimeMinutes, daytimeWorkedMinutes);
  let nighttimeOvertimeMinutes = clampMinutes(report?.nighttimeOvertimeMinutes, nighttimeWorkedMinutes);
  const explicitTotal = daytimeOvertimeMinutes + nighttimeOvertimeMinutes;
  const totalOvertimeMinutes = numberValue(report?.totalOvertimeMinutes);

  if (explicitTotal <= 0 && totalOvertimeMinutes > 0) {
    daytimeOvertimeMinutes = Math.min(daytimeWorkedMinutes, totalOvertimeMinutes);
    nighttimeOvertimeMinutes = Math.min(nighttimeWorkedMinutes, Math.max(0, totalOvertimeMinutes - daytimeOvertimeMinutes));
  }

  return { daytimeOvertimeMinutes, nighttimeOvertimeMinutes };
}

export function reportAllCollaboratorIds(report, dayCollaboratorIds = dayCollaboratorIdsFromReport(report)) {
  return uniqueIds([...dayCollaboratorIds, ...nightCollaboratorIdsFromReport(report)]);
}

function addMinutes(map, collaboratorIds, minutes) {
  if (minutes <= 0) return;
  for (const collaboratorId of collaboratorIds) {
    map.set(collaboratorId, (map.get(collaboratorId) || 0) + minutes);
  }
}

export function nightCollaboratorSnapshotsFromReport(report) {
  const noturnoDetails = plainObject(plainObject(report?.specialConditions).noturnoDetails);
  const snapshots = Array.isArray(noturnoDetails.colaboradores) ? noturnoDetails.colaboradores : [];
  return snapshots
    .filter(item => item && typeof item === 'object' && !Array.isArray(item))
    .map(item => ({
      id: typeof item.id === 'string' ? item.id : '',
      name: typeof item.name === 'string' ? item.name : '',
      role: typeof item.role === 'string' ? item.role : ''
    }))
    .filter(item => item.id);
}

export function reportWorkedMinutesByCollaborator(report, dayCollaboratorIds = dayCollaboratorIdsFromReport(report)) {
  const out = new Map();
  const daytimeCollaboratorIds = uniqueIds(dayCollaboratorIds);
  const daytimeWorkedMinutes = numberValue(report?.daytimeWorkedMinutes);
  const nighttimeWorkedMinutes = numberValue(report?.nighttimeWorkedMinutes);
  const nightCollaboratorIds = nightCollaboratorIdsFromReport(report);

  addMinutes(out, daytimeCollaboratorIds, daytimeWorkedMinutes);
  addMinutes(out, nightCollaboratorIds.length ? nightCollaboratorIds : daytimeCollaboratorIds, nighttimeWorkedMinutes);
  return out;
}

export function reportPersonTimeMetrics(report, dayCollaboratorIds = dayCollaboratorIdsFromReport(report)) {
  const daytimeCollaboratorIds = uniqueIds(dayCollaboratorIds);
  const daytimeWorkedMinutes = numberValue(report?.daytimeWorkedMinutes);
  const nighttimeWorkedMinutes = numberValue(report?.nighttimeWorkedMinutes);
  const daytimeTeamCount = Math.max(daytimeCollaboratorIds.length, integerValue(report?.daytimeCount));
  const nightCollaboratorIds = nightCollaboratorIdsFromReport(report);
  const nighttimeTeamCount = nightCollaboratorIds.length || daytimeTeamCount;
  const daytimeCollaboratorCount = turnCount(daytimeWorkedMinutes, daytimeTeamCount);
  const nighttimeCollaboratorCount = turnCount(nighttimeWorkedMinutes, nighttimeTeamCount, daytimeTeamCount);
  const {
    daytimeOvertimeMinutes,
    nighttimeOvertimeMinutes
  } = overtimeByTurn(report, daytimeWorkedMinutes, nighttimeWorkedMinutes);

  const daytimeNormalMinutes = Math.max(0, daytimeWorkedMinutes - daytimeOvertimeMinutes);
  const nighttimeNormalMinutes = Math.max(0, nighttimeWorkedMinutes - nighttimeOvertimeMinutes);
  const special = plainObject(report?.specialConditions);
  const standbyDurationMinutes = special.standby === true
    ? parseMinutes(plainObject(special.standbyDetails).total)
    : 0;
  // Pausa por nossa conta (falha de equipamento, acidente...): controle interno, fora do RDO.
  const internalStandbyDurationMinutes = special.internalStandby === true
    ? parseMinutes(plainObject(special.internalStandbyDetails).total)
    : 0;
  const pausedTeamCount = daytimeCollaboratorCount || nighttimeCollaboratorCount || daytimeTeamCount || nighttimeTeamCount || 1;
  const standbyCollaboratorCount = standbyDurationMinutes > 0 ? pausedTeamCount : 0;
  const internalStandbyCollaboratorCount = internalStandbyDurationMinutes > 0 ? pausedTeamCount : 0;

  return {
    daytimeCollaboratorCount,
    nighttimeCollaboratorCount,
    standbyCollaboratorCount,
    normalWorkedMinutes: (daytimeNormalMinutes * daytimeCollaboratorCount) + (nighttimeNormalMinutes * nighttimeCollaboratorCount),
    overtimeWorkedMinutes: (daytimeOvertimeMinutes * daytimeCollaboratorCount) + (nighttimeOvertimeMinutes * nighttimeCollaboratorCount),
    standbyDurationMinutes,
    standbyPersonMinutes: standbyDurationMinutes * standbyCollaboratorCount,
    internalStandbyCollaboratorCount,
    internalStandbyDurationMinutes,
    internalStandbyPersonMinutes: internalStandbyDurationMinutes * internalStandbyCollaboratorCount
  };
}
