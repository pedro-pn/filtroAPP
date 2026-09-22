import {
  PROJECT_WORKFLOW_STAGE_LABELS,
  PROJECT_WORKFLOW_STAGES,
  projectWorkflowStageTransitions
} from '../../../shared/schemas/project-workflow.js';
import type { ProjectWorkflowStage, ProjectWorkflowSummary } from '../api/projectWorkflow';

export const WORKFLOW_STAGES: readonly ProjectWorkflowStage[] = PROJECT_WORKFLOW_STAGES;
export const WORKFLOW_STAGE_LABELS = PROJECT_WORKFLOW_STAGE_LABELS as Record<ProjectWorkflowStage, string>;
export type ProjectKanbanStage = ProjectWorkflowStage;
export const PROJECT_KANBAN_STAGES: readonly ProjectKanbanStage[] = [...WORKFLOW_STAGES];
export const PROJECT_KANBAN_STAGE_LABELS: Record<ProjectKanbanStage, string> = {
  ...WORKFLOW_STAGE_LABELS,
  FINAL_MEASUREMENT: 'Documentação / medição',
  FINISHED: 'Encerrado'
};
export type ProjectKanbanColumns = Record<ProjectKanbanStage, ProjectWorkflowSummary[]>;

export function canDefineInitialProjectTeam(stage: ProjectKanbanStage) {
  // Sem "Pronto para mobilizar": a definição da equipe inicial continua disponível até a Mobilização.
  return stage === 'PREPARATION' || stage === 'MOBILIZATION';
}

export function canManageProjectTeamCycles(stage: ProjectKanbanStage) {
  return stage === 'EXECUTION';
}

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
  if (item.workflow?.stage === 'FINISHED') {
    return item.workflow.closedAt
      ? `Encerrado em ${new Date(item.workflow.closedAt).toLocaleDateString('pt-BR')}`
      : 'Projeto encerrado';
  }
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
  // Na Sede a contagem é do início da execução previsto, não da mobilização em campo.
  if (item.workflow?.executedAtHeadquarters) {
    if (!milestones || milestones.daysUntilMobilization == null) return 'Início da execução ainda não informado';
    if (milestones.daysUntilMobilization < 0) return `Início da execução atrasado há ${Math.abs(milestones.daysUntilMobilization)} dia(s)`;
    if (milestones.daysUntilMobilization === 0) return 'Início da execução previsto para hoje';
    return `Faltam ${milestones.daysUntilMobilization} dia(s) para iniciar a execução`;
  }
  if (!milestones || milestones.daysUntilMobilization == null) return 'Mobilização ainda não informada';
  if (milestones.daysUntilMobilization < 0) return `Mobilização atrasada há ${Math.abs(milestones.daysUntilMobilization)} dia(s)`;
  if (milestones.daysUntilMobilization === 0) return 'Mobilização prevista para hoje';
  return `Faltam ${milestones.daysUntilMobilization} dia(s)`;
}

export function projectWorkflowStageOptions(stage: ProjectWorkflowStage, headquarters = false) {
  return projectWorkflowStageTransitions(stage, headquarters) as ProjectWorkflowStage[];
}
