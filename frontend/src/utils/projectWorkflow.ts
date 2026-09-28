import {
  PROJECT_WORKFLOW_STAGE_LABELS,
  PROJECT_WORKFLOW_STAGES,
  projectWorkflowStageTransitions,
  projectWorkflowVisibleStages
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
  return stage === 'MOBILIZATION_PLANNING' || stage === 'PREPARATION' || stage === 'MOBILIZATION';
}

export function canManageProjectTeamCycles(stage: ProjectKanbanStage) {
  return stage === 'EXECUTION';
}

export function canViewProjectTeamCycles(stage: ProjectKanbanStage) {
  return WORKFLOW_STAGES.indexOf(stage) >= WORKFLOW_STAGES.indexOf('MOBILIZATION');
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

export function projectWorkflowNextStagePreview(item: ProjectWorkflowSummary, stage: ProjectKanbanStage) {
  const workflow = item.workflow;
  const visibleStages = projectWorkflowVisibleStages(workflow?.executedAtHeadquarters === true);
  const currentIndex = visibleStages.indexOf(stage);
  if (currentIndex < 0) return null;
  const forwardStages = stage === 'HANDOVER'
    ? ['INITIAL_ANALYSIS' as ProjectKanbanStage]
    : projectWorkflowStageOptions(stage, workflow?.executedAtHeadquarters === true)
      .filter(candidate => visibleStages.indexOf(candidate) > currentIndex);
  if (forwardStages.length !== 1) return null;

  const nextStage = forwardStages[0];
  const mission = item.operationalMission;
  let date: string | null | undefined = null;
  switch (nextStage) {
    case 'MOBILIZATION_PLANNING':
      date = workflow?.milestones.d30Date;
      break;
    case 'PREPARATION':
      date = workflow?.milestones.preparationDate;
      break;
    case 'MOBILIZATION':
      date = workflow?.plannedMobilizationDate || mission?.mobilizationDate;
      break;
    case 'EXECUTION':
      date = workflow?.executedAtHeadquarters
        ? workflow.plannedExecutionStartDate || mission?.executionStartDate
        : mission?.executionStartDate || workflow?.plannedExecutionStartDate;
      break;
    case 'DEMOBILIZATION':
      date = mission?.executionEndDate;
      break;
    case 'POST_JOB':
      date = workflow?.executedAtHeadquarters ? mission?.executionEndDate : null;
      break;
  }
  const referenceDate = workflow?.executedAtHeadquarters
    ? workflow.plannedExecutionStartDate
    : workflow?.plannedMobilizationDate;
  const referenceDays = workflow?.milestones.daysUntilMobilization;
  const dateOffset = date && referenceDate
    ? Math.round((Date.parse(`${date.slice(0, 10)}T00:00:00Z`) - Date.parse(`${referenceDate.slice(0, 10)}T00:00:00Z`)) / 86_400_000)
    : null;

  return {
    stage: nextStage,
    date: date || null,
    daysUntil: referenceDays != null && dateOffset != null ? referenceDays + dateOffset : null
  };
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
