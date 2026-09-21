import type { ProjectWorkflow } from '../api/projectWorkflow';

type ScheduleSource = 'PLANNED' | 'COMMERCIAL' | null;

export interface ProjectExecutionSchedule {
  mobilizationDate: string;
  executionStartDate: string;
  executionEndDate: string;
  mobilizationSource: ScheduleSource;
  executionStartSource: ScheduleSource;
  executionEndSource: ScheduleSource;
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

type ScheduleWorkflow = Pick<ProjectWorkflow,
  'plannedMobilizationDate' | 'commercialExpectedMobilizationDate' | 'commercialExpectedStartDate'
  | 'commercialExpectedDurationDays' | 'plannedExecutionStartDate' | 'plannedExecutionEndDate'>;

/**
 * Datas de mobilização e execução da obra definidas antes da equipe (Handover e análise inicial).
 * O valor operacional prevalece; sem ele, vale a previsão comercial recebida do CRM.
 */
export function projectExecutionSchedule(workflow: ScheduleWorkflow): ProjectExecutionSchedule {
  const pick = (planned: string | null | undefined, commercial: string | null | undefined): [string, ScheduleSource] => (
    planned ? [planned.slice(0, 10), 'PLANNED'] : commercial ? [commercial.slice(0, 10), 'COMMERCIAL'] : ['', null]
  );
  const [mobilizationDate, mobilizationSource] = pick(workflow.plannedMobilizationDate, workflow.commercialExpectedMobilizationDate);
  const [executionStartDate, executionStartSource] = pick(workflow.plannedExecutionStartDate, workflow.commercialExpectedStartDate);
  const commercialEnd = executionStartDate && workflow.commercialExpectedDurationDays && workflow.commercialExpectedDurationDays > 0
    ? addDays(executionStartDate, workflow.commercialExpectedDurationDays - 1)
    : null;
  const [executionEndDate, executionEndSource] = pick(workflow.plannedExecutionEndDate, commercialEnd);
  return { mobilizationDate, executionStartDate, executionEndDate, mobilizationSource, executionStartSource, executionEndSource };
}
