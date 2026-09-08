export function effectiveEpiRoleData(collaborator) {
  if (String(collaborator?.epiDocumentRoleSnapshot || '').trim()) {
    return {
      jobRoleId: collaborator?.epiDocumentJobRoleIdSnapshot || null,
      name: String(collaborator.epiDocumentRoleSnapshot).trim(),
      source: collaborator?.epiDocumentRoleSourceSnapshot || 'CANONICAL'
    };
  }
  const relationalOverride = collaborator?.epiProfile?.roleOverrideJobRole;
  if (relationalOverride?.id && String(relationalOverride.name || '').trim()) {
    return {
      jobRoleId: relationalOverride.id,
      name: String(relationalOverride.name).trim(),
      source: 'EPI_OVERRIDE'
    };
  }

  const canonical = collaborator?.jobRole;
  const canonicalName = String(canonical?.name || '').trim();
  return {
    jobRoleId: canonical?.id || collaborator?.jobRoleId || null,
    name: canonicalName,
    source: 'CANONICAL'
  };
}

export function effectiveEpiRole(collaborator) {
  return effectiveEpiRoleData(collaborator).name;
}

export function epiRoleSnapshotData(collaborator) {
  const effective = effectiveEpiRoleData(collaborator);
  return {
    jobRoleIdSnapshot: effective.jobRoleId,
    roleNameSnapshot: effective.name,
    roleSourceSnapshot: effective.source
  };
}

export function roleNameForEpiRequest(request) {
  return String(request?.roleNameSnapshot || effectiveEpiRole(request?.collaborator)).trim();
}
