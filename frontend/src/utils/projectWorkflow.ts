import {
  PROJECT_WORKFLOW_STAGE_LABELS,
  PROJECT_WORKFLOW_STAGES
} from '../../../shared/schemas/project-workflow.js';
import type { ProjectWorkflowStage, ProjectWorkflowSummary } from '../api/projectWorkflow';

export const WORKFLOW_STAGES: readonly ProjectWorkflowStage[] = PROJECT_WORKFLOW_STAGES;
export const WORKFLOW_STAGE_LABELS = PROJECT_WORKFLOW_STAGE_LABELS as Record<ProjectWorkflowStage, string>;

export function projectWorkflowsToColumns(items: ProjectWorkflowSummary[]) {
  return Object.fromEntries(WORKFLOW_STAGES.map(stage => [
    stage,
    items.filter(item => (item.workflow?.stage || 'HANDOVER') === stage)
  ])) as Record<ProjectWorkflowStage, ProjectWorkflowSummary[]>;
}

export function projectWorkflowMilestoneText(item: ProjectWorkflowSummary) {
  const milestones = item.workflow?.milestones;
  if (!milestones || milestones.daysUntilMobilization == null) return 'Mobilização ainda não informada';
  if (milestones.daysUntilMobilization < 0) return `Mobilização atrasada há ${Math.abs(milestones.daysUntilMobilization)} dia(s)`;
  if (milestones.daysUntilMobilization === 0) return 'Mobilização prevista para hoje';
  return `Faltam ${milestones.daysUntilMobilization} dia(s)`;
}

export function projectWorkflowStageOptions(stage: ProjectWorkflowStage) {
  if (stage === 'INITIAL_ANALYSIS') return ['WAITING_PLANNING', 'MOBILIZATION_PLANNING'] as ProjectWorkflowStage[];
  if (stage === 'WAITING_PLANNING') return ['INITIAL_ANALYSIS', 'MOBILIZATION_PLANNING'] as ProjectWorkflowStage[];
  if (stage === 'MOBILIZATION_PLANNING') return ['INITIAL_ANALYSIS', 'WAITING_PLANNING'] as ProjectWorkflowStage[];
  return [];
}
