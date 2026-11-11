// Synthetic wire rows only. Native PostgreSQL parity is checked separately.
export function plannedHourRows(projects, roles = new Map()) {
  const hours = (project, key) => (project[key] ?? []).map(row => ({ ...row, projectId: project.id,
    hours: String(row.hours), createdAt: new Date(row.createdAt).toISOString().slice(0,-1),
    updatedAt: new Date(row.updatedAt).toISOString().slice(0,-1), jobRole: roles.has(row.jobRoleId) ? { name: roles.get(row.jobRoleId) } : null }));
  return [{ normal: projects.flatMap(project => hours(project, 'plannedNormalHours')),
    overtime: projects.flatMap(project => hours(project, 'plannedOvertime')),
    budgets: projects.flatMap(project => (project.budgets ?? []).map(row => ({ ...row, projectId: project.id }))),
    additions: projects.flatMap(project => (project.additionalProposals ?? []).map(row => ({ ...row, projectId: project.id }))) }];
}
