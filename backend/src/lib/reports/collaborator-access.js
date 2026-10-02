export function collaboratorHasAuthorizedProjectLink(auth, project) {
  return Array.isArray(project?.authorizedUsers)
    && project.authorizedUsers.some(link => link.userId === auth.user?.id);
}

export function collaboratorCanAccessReportProject(auth, project) {
  if (!project || project.deletedAt || project.managerOnly) return false;
  const authorized = collaboratorHasAuthorizedProjectLink(auth, project);
  if (!project.visibleToCollaborators && !authorized) return false;
  if (project.isActive) return true;
  const collaboratorId = auth.rawUser?.collaboratorId || auth.user?.collaboratorId;
  return project.isActive === false && Boolean(
    authorized || (collaboratorId && project.operatorId === collaboratorId)
  );
}
