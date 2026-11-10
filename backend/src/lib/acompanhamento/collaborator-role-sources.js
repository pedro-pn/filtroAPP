// Reuse the role catalog already loaded by the cost resolver. Keep history
// order/effective dates, and preserve supplied relations for older adapters
// that do not project the foreign key. Inputs are never mutated.
export function withCollaboratorRoleNames(collaborator, rolesById) {
  if (!collaborator) return collaborator;
  const currentId = collaborator.jobRoleId ?? collaborator.jobRole?.id;
  return {
    ...collaborator,
    jobRole: (currentId == null ? null : rolesById.get(currentId)) ?? collaborator.jobRole ?? null,
    jobRoleHistory: (collaborator.jobRoleHistory || []).map(entry => {
      const roleId = entry.jobRoleId ?? entry.jobRole?.id;
      return { ...entry, jobRole: (roleId == null ? null : rolesById.get(roleId)) ?? entry.jobRole ?? null };
    })
  };
}
