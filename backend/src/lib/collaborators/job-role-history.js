function dateKey(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function roleFromEntry(entry) {
  if (!entry) return null;
  return {
    jobRoleId: entry.jobRoleId || entry.jobRole?.id || null,
    roleName: entry.jobRole?.name || entry.roleName || null,
    effectiveDate: dateKey(entry.effectiveDate)
  };
}

export const collaboratorJobRoleHistoryInclude = Object.freeze({
  jobRole: { select: { id: true, name: true, isActive: true, isOperational: true } }
});

export function collaboratorRoleAtDate(collaborator, targetDate) {
  const targetKey = dateKey(targetDate);
  const history = [...(collaborator?.jobRoleHistory || [])]
    .filter(entry => dateKey(entry.effectiveDate) <= targetKey)
    .sort((left, right) => dateKey(right.effectiveDate).localeCompare(dateKey(left.effectiveDate)));
  if (history.length) return roleFromEntry(history[0]);
  if ((collaborator?.jobRoleHistory || []).length) return null;
  return roleFromEntry({
    jobRoleId: collaborator?.jobRoleId,
    jobRole: collaborator?.jobRole,
    effectiveDate: targetKey
  });
}

export function collaboratorRoleSegments(collaborator, startDate, endDate) {
  const startKey = dateKey(startDate);
  const endKey = dateKey(endDate);
  if (!startKey || !endKey || startKey > endKey) return [];

  const starts = new Set([startKey]);
  for (const entry of collaborator?.jobRoleHistory || []) {
    const key = dateKey(entry.effectiveDate);
    if (key > startKey && key <= endKey) starts.add(key);
  }

  const ordered = [...starts].sort();
  return ordered.flatMap((segmentStart, index) => {
    const role = collaboratorRoleAtDate(collaborator, segmentStart);
    if (!role?.jobRoleId || !role.roleName) return [];
    const nextStart = ordered[index + 1];
    const segmentEnd = nextStart
      ? new Date(`${nextStart}T00:00:00.000Z`).getTime() - 86_400_000
      : null;
    return [{
      ...role,
      startKey: segmentStart,
      endKey: segmentEnd == null ? endKey : new Date(segmentEnd).toISOString().slice(0, 10)
    }];
  });
}

export function validateCollaboratorRoleEffectiveDate(collaborator, effectiveDate, today = new Date()) {
  const effectiveKey = dateKey(effectiveDate);
  const todayKey = dateKey(today);
  const admissionKey = dateKey(collaborator?.admissionDate);
  if (!effectiveKey) throw Object.assign(new Error('Informe a data de vigência do cargo.'), { status: 400, statusCode: 400 });
  if (effectiveKey > todayKey) {
    throw Object.assign(new Error('A vigência do cargo não pode estar no futuro.'), { status: 400, statusCode: 400 });
  }
  if (admissionKey && effectiveKey < admissionKey) {
    throw Object.assign(new Error('A vigência do cargo não pode ser anterior à admissão.'), { status: 400, statusCode: 400 });
  }
  return new Date(`${effectiveKey}T00:00:00.000Z`);
}

export async function synchronizeCurrentCollaboratorJobRole(database, collaboratorId, today = new Date()) {
  const effective = await database.collaboratorJobRoleHistory.findFirst({
    where: { collaboratorId, effectiveDate: { lte: new Date(`${dateKey(today)}T00:00:00.000Z`) } },
    orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }]
  });
  if (!effective) {
    throw Object.assign(new Error('O colaborador precisa ter ao menos um cargo vigente.'), { status: 400, statusCode: 400 });
  }
  const collaborator = await database.collaborator.findUniqueOrThrow({ where: { id: collaboratorId } });
  if (collaborator.jobRoleId === effective.jobRoleId) {
    return { collaborator, changed: false, previousJobRoleId: collaborator.jobRoleId };
  }
  const updated = await database.collaborator.update({
    where: { id: collaboratorId },
    data: { jobRoleId: effective.jobRoleId }
  });
  return { collaborator: updated, changed: true, previousJobRoleId: collaborator.jobRoleId };
}
