// The project projection contains the current, non-cancelled official mission
// and its active allocations. Coordinators already have project access;
// collaborators also require explicit project authorization.
export function canEditMissionReports(user, project) {
  return Boolean(user?.id && user.collaboratorId
    && user.isActive !== false
    && ['INTERNAL', 'ADMIN'].includes(user.accountType)
    && project?.isActive && !project.deletedAt && !project.managerOnly
    && (user.role === 'COORDINATOR' || project.authorizedUsers?.some(link => link.userId === user.id))
    && project.efetivoMissionPlans?.some(mission => mission.allocations
      .some(allocation => allocation.collaboratorId === user.collaboratorId)));
}
