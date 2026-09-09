export const PROJECT_WORKFLOW_STAGES: readonly ['HANDOVER', 'INITIAL_ANALYSIS', 'WAITING_PLANNING', 'MOBILIZATION_PLANNING', 'PREPARATION', 'READY_TO_MOBILIZE'];
export const PROJECT_WORKFLOW_STAGE_LABELS: Readonly<Record<(typeof PROJECT_WORKFLOW_STAGES)[number], string>>;
export const PROJECT_WORKFLOW_CHECKLIST_SECTIONS: readonly ['HANDOVER', 'INITIAL_ANALYSIS', 'ADVANCE_DOCUMENTATION', 'D30_TEAM', 'D30_EQUIPMENT', 'D30_MATERIALS', 'D30_LOGISTICS', 'D15_TEAM', 'D15_CLIENT', 'D15_EQUIPMENT', 'D15_MATERIALS', 'D15_PRE_JOB', 'D15_TRAVEL', 'D15_QSMS'];
export const PROJECT_WORKFLOW_CHECKLIST_SECTION_LABELS: Readonly<Record<(typeof PROJECT_WORKFLOW_CHECKLIST_SECTIONS)[number], string>>;
export const PROJECT_WORKFLOW_CHECKLISTS: ReadonlyArray<{ key: string; stage: (typeof PROJECT_WORKFLOW_STAGES)[number] | null; section: (typeof PROJECT_WORKFLOW_CHECKLIST_SECTIONS)[number]; label: string; areaRoles: string[] }>;
export const PROJECT_WORKFLOW_CRITICAL_QUESTIONS: ReadonlyArray<{ key: string; label: string; area: string; issueDescription: string }>;
export const PROJECT_WORKFLOW_CHECKLIST_STATUSES: readonly ['PENDING', 'DONE', 'NOT_APPLICABLE'];
export const PROJECT_WORKFLOW_ISSUE_STATUSES: readonly ['OPEN', 'IN_PROGRESS', 'RESOLVED'];
export const PROJECT_WORKFLOW_CRITICALITIES: readonly ['HIGH', 'MEDIUM', 'LOW'];
export const PROJECT_WORKFLOW_COMMERCIAL_FACT_STATUSES: readonly ['PENDING', 'CONFIRMED', 'NOT_APPLICABLE'];
export const PROJECT_WORKFLOW_COMMERCIAL_FACT_SOURCES: readonly ['MANUAL', 'CRM'];
export const PROJECT_WORKFLOW_COMMERCIAL_FACTS: ReadonlyArray<{
  key: string;
  label: string;
  allowNotApplicable: boolean;
  evidence: 'reference' | 'note';
  handoverChecklistKey?: string;
}>;
export function makeProjectWorkflowCommercialFactSchema(z: typeof import('zod').z): import('zod').ZodType<{
  action: 'commercial_fact';
  version: number;
  key: string;
  status: (typeof PROJECT_WORKFLOW_COMMERCIAL_FACT_STATUSES)[number];
  reference?: string | null;
  note?: string | null;
  occurredOn?: string | null;
}>;
export function makeProjectWorkflowSchemas(z: typeof import('zod').z): {
  start: import('zod').ZodType<{ leaderUserId: string; plannedMobilizationDate: string }>;
  patch: import('zod').ZodType<Record<string, unknown>>;
  list: import('zod').ZodType<{ search?: string; page: number }>;
};
export function projectWorkflowMilestones(plannedMobilizationDate: string | null, today: string): {
  daysUntilMobilization: number | null;
  items: Array<{ key: string; label: string; days: number; date: string; due: boolean }>;
  dueMilestones: string[];
  nextMilestone: { key: string; label: string; days: number; date: string; due: boolean } | null;
  d30Date: string | null;
  d30Due: boolean;
};
