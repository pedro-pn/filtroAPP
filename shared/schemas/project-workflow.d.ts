export const PROJECT_WORKFLOW_STAGES: readonly ['HANDOVER', 'INITIAL_ANALYSIS', 'WAITING_PLANNING', 'MOBILIZATION_PLANNING'];
export const PROJECT_WORKFLOW_STAGE_LABELS: Readonly<Record<(typeof PROJECT_WORKFLOW_STAGES)[number], string>>;
export const PROJECT_WORKFLOW_CHECKLISTS: ReadonlyArray<{ key: string; stage: (typeof PROJECT_WORKFLOW_STAGES)[number]; label: string }>;
export const PROJECT_WORKFLOW_CRITICAL_QUESTIONS: ReadonlyArray<{ key: string; label: string; area: string; issueDescription: string }>;
export const PROJECT_WORKFLOW_CHECKLIST_STATUSES: readonly ['PENDING', 'DONE', 'NOT_APPLICABLE'];
export const PROJECT_WORKFLOW_ISSUE_STATUSES: readonly ['OPEN', 'IN_PROGRESS', 'RESOLVED'];
export const PROJECT_WORKFLOW_CRITICALITIES: readonly ['HIGH', 'MEDIUM', 'LOW'];
export function makeProjectWorkflowSchemas(z: typeof import('zod').z): {
  start: import('zod').ZodType<{ leaderUserId: string; plannedMobilizationDate: string }>;
  patch: import('zod').ZodType<Record<string, unknown>>;
  list: import('zod').ZodType<{ search?: string; page: number }>;
};
export function projectWorkflowMilestones(plannedMobilizationDate: string | null, today: string): {
  daysUntilMobilization: number | null;
  d30Date: string | null;
  d30Due: boolean;
};
