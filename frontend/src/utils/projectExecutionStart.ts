import type { ProjectWorkflowProject } from '../api/projectWorkflow';

export function projectReportOperatorOptions(project: ProjectWorkflowProject) {
  const byId = new Map((project.operationalMission?.allocations || [])
    .filter(allocation => allocation.collaborator?.isActive && allocation.collaborator.canOperateReports)
    .map(allocation => [allocation.collaboratorId, { id: allocation.collaboratorId, name: allocation.collaborator!.name }]));
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

export function projectExecutionStartSuggestion(project: ProjectWorkflowProject, plannedStartDate: string | null, today: string) {
  const date = (project.startDate || project.operationalMission?.executionStartDate || plannedStartDate || '').slice(0, 10);
  const futureDate = date > today ? date : null;
  return { suggestedStartDate: futureDate ? '' : date, futureDate };
}
