import type { ProjectWorkflowProject } from '../api/projectWorkflow';

export function projectExecutionStartSuggestion(project: ProjectWorkflowProject, plannedStartDate: string | null, today: string) {
  const date = (project.startDate || project.operationalMission?.executionStartDate || plannedStartDate || '').slice(0, 10);
  const futureDate = date > today ? date : null;
  return { suggestedStartDate: futureDate ? '' : date, futureDate };
}
