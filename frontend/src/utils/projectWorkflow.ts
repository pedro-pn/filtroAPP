import {
  PROJECT_WORKFLOW_STAGE_LABELS,
  PROJECT_WORKFLOW_STAGES
} from '../../../shared/schemas/project-workflow.js';
import type { ProjectWorkflowStage, ProjectWorkflowSummary } from '../api/projectWorkflow';

export const WORKFLOW_STAGES: readonly ProjectWorkflowStage[] = PROJECT_WORKFLOW_STAGES;
export const WORKFLOW_STAGE_LABELS = PROJECT_WORKFLOW_STAGE_LABELS as Record<ProjectWorkflowStage, string>;
export type ProjectKanbanStage = ProjectWorkflowStage | 'FINISHED';
export const PROJECT_KANBAN_STAGES: readonly ProjectKanbanStage[] = [...WORKFLOW_STAGES, 'FINISHED'];
export const PROJECT_KANBAN_STAGE_LABELS: Record<ProjectKanbanStage, string> = {
  ...WORKFLOW_STAGE_LABELS,
  FINAL_MEASUREMENT: 'Documentação / medição',
  FINISHED: 'Encerrado'
};
export type ProjectKanbanColumns = Record<ProjectKanbanStage, ProjectWorkflowSummary[]>;

export function projectKanbanStage(item: ProjectWorkflowSummary): ProjectKanbanStage {
  if (item.workflow) return item.workflow.stage;
  const legacyStage = item.operationalMission?.stage;
  if (legacyStage === 'MOBILIZATION' || legacyStage === 'EXECUTION' || legacyStage === 'FINAL_MEASUREMENT' || legacyStage === 'FINISHED') return legacyStage;
  return 'HANDOVER';
}

export function projectWorkflowsToColumns(items: ProjectWorkflowSummary[]): ProjectKanbanColumns {
  return Object.fromEntries(PROJECT_KANBAN_STAGES.map(stage => [
    stage,
    items.filter(item => projectKanbanStage(item) === stage)
  ])) as ProjectKanbanColumns;
}

export function cloneProjectKanbanColumns(columns: ProjectKanbanColumns): ProjectKanbanColumns {
  return Object.fromEntries(PROJECT_KANBAN_STAGES.map(stage => [stage, [...columns[stage]]])) as ProjectKanbanColumns;
}

export function projectStageInColumns(columns: ProjectKanbanColumns, projectId: string): ProjectKanbanStage | null {
  return PROJECT_KANBAN_STAGES.find(stage => columns[stage].some(item => item.id === projectId)) || null;
}

export function moveProjectInColumns(columns: ProjectKanbanColumns, projectId: string, targetStage: ProjectKanbanStage): ProjectKanbanColumns {
  const sourceStage = projectStageInColumns(columns, projectId);
  if (!sourceStage || sourceStage === targetStage) return columns;
  const project = columns[sourceStage].find(item => item.id === projectId);
  if (!project) return columns;
  return {
    ...columns,
    [sourceStage]: columns[sourceStage].filter(item => item.id !== projectId),
    [targetStage]: [...columns[targetStage], project]
  };
}

export function projectWorkflowMilestoneText(item: ProjectWorkflowSummary) {
  if (item.workflow?.stage === 'FINAL_MEASUREMENT') {
    return item.workflow.measurement.approvedAt
      ? `Medição aprovada em ${new Date(`${item.workflow.measurement.approvedAt}T00:00:00`).toLocaleDateString('pt-BR')}`
      : 'Documentação e medição em andamento';
  }
  if (item.workflow?.stage === 'POST_JOB') {
    return item.workflow.postJob.meetingDate
      ? `Pós-job realizado em ${new Date(`${item.workflow.postJob.meetingDate}T00:00:00`).toLocaleDateString('pt-BR')}`
      : 'Fechamento técnico em andamento';
  }
  if (item.workflow?.stage === 'DEMOBILIZATION') {
    if (item.workflow.demobilizationDate) return `Desmobilizada em ${new Date(`${item.workflow.demobilizationDate}T00:00:00`).toLocaleDateString('pt-BR')}`;
    if (item.workflow.fieldCompletionDate) return `Campo concluído em ${new Date(`${item.workflow.fieldCompletionDate}T00:00:00`).toLocaleDateString('pt-BR')}`;
    return 'Desmobilização em andamento';
  }
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
  if (stage === 'EXECUTION') return ['MOBILIZATION', 'DEMOBILIZATION'] as ProjectWorkflowStage[];
  if (stage === 'DEMOBILIZATION') return ['EXECUTION', 'POST_JOB'] as ProjectWorkflowStage[];
  if (stage === 'POST_JOB') return ['DEMOBILIZATION', 'FINAL_MEASUREMENT'] as ProjectWorkflowStage[];
  if (stage === 'FINAL_MEASUREMENT') return ['POST_JOB'] as ProjectWorkflowStage[];
  return [];
}
