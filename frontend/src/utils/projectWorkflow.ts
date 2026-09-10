import {
  PROJECT_WORKFLOW_STAGE_LABELS,
  PROJECT_WORKFLOW_STAGES
} from '../../../shared/schemas/project-workflow.js';
import type { ProjectWorkflowStage, ProjectWorkflowSummary } from '../api/projectWorkflow';

export const WORKFLOW_STAGES: readonly ProjectWorkflowStage[] = PROJECT_WORKFLOW_STAGES;
export const WORKFLOW_STAGE_LABELS = PROJECT_WORKFLOW_STAGE_LABELS as Record<ProjectWorkflowStage, string>;
export type ProjectKanbanStage = ProjectWorkflowStage | 'FINAL_MEASUREMENT' | 'FINISHED';
export const PROJECT_KANBAN_STAGES: readonly ProjectKanbanStage[] = [...WORKFLOW_STAGES, 'FINAL_MEASUREMENT', 'FINISHED'];
export const PROJECT_KANBAN_STAGE_LABELS: Record<ProjectKanbanStage, string> = {
  ...WORKFLOW_STAGE_LABELS,
  FINAL_MEASUREMENT: 'Documentação / medição',
  FINISHED: 'Encerrado'
};

export function projectKanbanStage(item: ProjectWorkflowSummary): ProjectKanbanStage {
  if (item.workflow) return item.workflow.stage;
  const legacyStage = item.operationalMission?.stage;
  if (legacyStage === 'MOBILIZATION' || legacyStage === 'EXECUTION' || legacyStage === 'FINAL_MEASUREMENT' || legacyStage === 'FINISHED') return legacyStage;
  return 'HANDOVER';
}

export function projectWorkflowsToColumns(items: ProjectWorkflowSummary[]) {
  return Object.fromEntries(PROJECT_KANBAN_STAGES.map(stage => [
    stage,
    items.filter(item => projectKanbanStage(item) === stage)
  ])) as Record<ProjectKanbanStage, ProjectWorkflowSummary[]>;
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
  if (stage === 'MOBILIZATION_PLANNING') return ['INITIAL_ANALYSIS', 'WAITING_PLANNING', 'PREPARATION'] as ProjectWorkflowStage[];
  if (stage === 'PREPARATION') return ['MOBILIZATION_PLANNING', 'READY_TO_MOBILIZE'] as ProjectWorkflowStage[];
  if (stage === 'READY_TO_MOBILIZE') return ['PREPARATION', 'MOBILIZATION'] as ProjectWorkflowStage[];
  if (stage === 'MOBILIZATION') return ['READY_TO_MOBILIZE', 'EXECUTION'] as ProjectWorkflowStage[];
  if (stage === 'EXECUTION') return ['MOBILIZATION'] as ProjectWorkflowStage[];
  return [];
}
