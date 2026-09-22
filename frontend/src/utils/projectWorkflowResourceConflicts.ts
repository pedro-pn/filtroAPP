import type { ProjectWorkflowIssue } from '../api/projectWorkflow';

const RESOURCE_CONFLICT_QUESTIONS = ['RESOURCE_TEAM_CONFLICT', 'RESOURCE_EQUIPMENT_CONFLICT'];

/** Pendências geradas pelo sistema quando a mudança de data deixa a equipe ou os equipamentos incompatíveis. */
export function isResourceConflictIssue(issue: ProjectWorkflowIssue) {
  return issue.sourceQuestion !== null && RESOURCE_CONFLICT_QUESTIONS.includes(issue.sourceQuestion);
}
