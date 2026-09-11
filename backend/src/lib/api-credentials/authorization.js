import ipaddr from 'ipaddr.js';

export class ApiPolicyExpansionError extends Error {
  constructor(conflicts) {
    super('A ampliação de privilégios exige rotação da credencial.');
    this.name = 'ApiPolicyExpansionError';
    this.code = 'ROTATION_REQUIRED';
    this.statusCode = 409;
    this.conflicts = conflicts;
  }
}

function isSubset(nextValues, currentValues) {
  const current = new Set(currentValues || []);
  return (nextValues || []).every(value => current.has(value));
}

function cidrContainedBy(candidate, container) {
  try {
    const [candidateNetwork, candidatePrefix] = ipaddr.parseCIDR(candidate);
    const [containerNetwork, containerPrefix] = ipaddr.parseCIDR(container);
    return candidateNetwork.kind() === containerNetwork.kind()
      && candidatePrefix >= containerPrefix
      && candidateNetwork.match(containerNetwork, containerPrefix);
  } catch {
    return false;
  }
}

export function policyExpansionConflicts(current, patch) {
  const conflicts = [];
  const currentScopes = current.scopeCodes || current.scopes?.filter(item => !item.revokedAt).map(item => item.scopeCode) || [];
  if (patch.scopeCodes && !isSubset(patch.scopeCodes, currentScopes)) conflicts.push('scopeCodes');

  if (patch.projectAccess) {
    const currentMode = current.projectAccess?.mode || current.projectAccessMode;
    const currentProjects = current.projectAccess?.projectIds || current.projects?.filter(item => !item.revokedAt).map(item => item.projectId) || [];
    if (currentMode === 'SELECTED' && patch.projectAccess.mode === 'ALL') conflicts.push('projectAccess.mode');
    if (currentMode === 'SELECTED' && patch.projectAccess.mode === 'SELECTED' && !isSubset(patch.projectAccess.projectIds, currentProjects)) {
      conflicts.push('projectAccess.projectIds');
    }
  }

  if (patch.allowedIpCidrs) {
    const currentCidrs = current.allowedIpCidrs || [];
    if (currentCidrs.length > 0 && (
      patch.allowedIpCidrs.length === 0
      || !patch.allowedIpCidrs.every(candidate => currentCidrs.some(container => cidrContainedBy(candidate, container)))
    )) conflicts.push('allowedIpCidrs');
  }

  if (patch.expiresAt) {
    const currentExpiresAt = current.expiresAt ? new Date(current.expiresAt) : null;
    if (currentExpiresAt && new Date(patch.expiresAt) > currentExpiresAt) conflicts.push('expiresAt');
  }
  if (patch.limits) {
    for (const name of ['requestsPerMinute', 'requestsPerDay', 'rowsPerDay', 'maxPageSize']) {
      const currentValue = current.limits?.[name] ?? current[name];
      if (patch.limits[name] > currentValue) conflicts.push(`limits.${name}`);
    }
  }
  return conflicts;
}

export function assertPolicyReduction(current, patch) {
  const conflicts = policyExpansionConflicts(current, patch);
  if (conflicts.length) throw new ApiPolicyExpansionError(conflicts);
  return true;
}
