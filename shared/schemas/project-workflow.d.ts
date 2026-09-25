export const PROJECT_WORKFLOW_STAGES: readonly ['HANDOVER', 'INITIAL_ANALYSIS', 'WAITING_PLANNING', 'MOBILIZATION_PLANNING', 'PREPARATION', 'MOBILIZATION', 'EXECUTION', 'DEMOBILIZATION', 'POST_JOB', 'FINAL_MEASUREMENT', 'FINISHED'];
export const PROJECT_WORKFLOW_STAGE_LABELS: Readonly<Record<(typeof PROJECT_WORKFLOW_STAGES)[number], string>>;
export const PROJECT_WORKFLOW_LEGACY_SUMMARY_STAGES: readonly ['MOBILIZATION', 'EXECUTION', 'DEMOBILIZATION', 'POST_JOB', 'FINAL_MEASUREMENT', 'FINISHED'];
export const PROJECT_WORKFLOW_CHECKLIST_SECTIONS: readonly ['INITIAL_ANALYSIS', 'D30_TEAM', 'D30_EQUIPMENT', 'D30_MATERIALS', 'D30_LOGISTICS', 'D15_TEAM', 'D15_CLIENT', 'D15_EQUIPMENT', 'D15_MATERIALS', 'D15_PRE_JOB', 'D15_TRAVEL', 'D15_QSMS', 'DEMOBILIZATION_FIELD', 'DEMOBILIZATION_LOGISTICS', 'DEMOBILIZATION_ASSETS', 'POST_JOB_FEEDBACK', 'POST_JOB_LEARNING', 'CLOSEOUT_DOCUMENTATION', 'CLOSEOUT_MEASUREMENT', 'FINAL_CLOSEOUT'];
export const PROJECT_WORKFLOW_CHECKLIST_SECTION_LABELS: Readonly<Record<(typeof PROJECT_WORKFLOW_CHECKLIST_SECTIONS)[number], string>>;
export const PROJECT_WORKFLOW_CHECKLISTS: ReadonlyArray<{ key: string; stage: (typeof PROJECT_WORKFLOW_STAGES)[number] | null; section: (typeof PROJECT_WORKFLOW_CHECKLIST_SECTIONS)[number]; label: string; areaRoles: string[] }>;
export const PROJECT_WORKFLOW_PREPARATION_ITEM_CHECKS: Readonly<{
  EQUIPMENT: ReadonlyArray<{ key: 'TESTED' | 'ACCESSORIES_SEPARATED'; label: string; areaRoles: string[] }>;
  MATERIAL: ReadonlyArray<{ key: 'SEPARATED'; label: string; areaRoles: string[] }>;
}>;
export const PROJECT_WORKFLOW_CRITICAL_QUESTIONS: ReadonlyArray<{ key: string; label: string; area: string; issueDescription: string; createsIssue?: boolean }>;
export const PROJECT_WORKFLOW_DOCUMENTATION_TYPES: readonly ['DOCUMENT', 'EXAM', 'TRAINING', 'QUALITY', 'CERTIFICATION'];
export const PROJECT_WORKFLOW_DOCUMENTATION_STATUSES: readonly ['PENDING', 'REQUESTED', 'CONFIRMED'];
export const PROJECT_WORKFLOW_DOCUMENTATION_DEFINITIONS: ReadonlyArray<{
  type: (typeof PROJECT_WORKFLOW_DOCUMENTATION_TYPES)[number];
  label: string;
  description: string;
  singularLabel: string;
  nameLabel: string;
}>;
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
  start: import('zod').ZodType<{ leaderUserId: string; plannerUserId: string; plannedMobilizationDate?: string }>;
  startLegacySummary: import('zod').ZodType<{
    stage: (typeof PROJECT_WORKFLOW_LEGACY_SUMMARY_STAGES)[number];
    leaderUserId: string;
    plannerUserId: string;
    startDate: string;
    endDate?: string | null;
    demobilizationDate?: string | null;
    equipmentSelections: Array<{ categoryId: string; equipmentIds: string[] }>;
  }>;
  postJob: import('zod').ZodType<Record<string, unknown>>;
  patch: import('zod').ZodType<Record<string, unknown>>;
  list: import('zod').ZodType<{ search?: string; page: number }>;
};
export function projectWorkflowMilestones(plannedMobilizationDate: string | null, today: string, preparationLeadTimeDays?: number): {
  daysUntilMobilization: number | null;
  items: Array<{ key: string; label: string; days: number; date: string; due: boolean }>;
  dueMilestones: string[];
  nextMilestone: { key: string; label: string; days: number; date: string; due: boolean } | null;
  d30Date: string | null;
  d30Due: boolean;
  preparationLeadTimeDays: number;
  preparationDate: string | null;
  preparationDue: boolean;
};

export const PROJECT_WORKFLOW_HEADQUARTERS_SKIPPED_STAGES: readonly ['MOBILIZATION', 'DEMOBILIZATION'];
export const PROJECT_WORKFLOW_HEADQUARTERS_EDITABLE_STAGES: readonly ['HANDOVER', 'INITIAL_ANALYSIS', 'WAITING_PLANNING', 'MOBILIZATION_PLANNING'];
export const PROJECT_WORKFLOW_HEADQUARTERS_HIDDEN_TEAM_CHECKS: readonly ['EXAMS_RELEASED', 'TRAININGS_RELEASED'];
export const PROJECT_WORKFLOW_HEADQUARTERS_HIDDEN_DOCUMENTATION_TYPES: readonly ['EXAM'];
export const PROJECT_WORKFLOW_HEADQUARTERS_HIDDEN_CRITICAL_QUESTIONS: readonly ['CLIENT_REQUIREMENTS', 'CLIENT_REGISTRATION'];
export const PROJECT_WORKFLOW_HEADQUARTERS_HIDDEN_CLIENT_RELEASES: readonly string[];
export const PROJECT_WORKFLOW_HEADQUARTERS_OPTIONAL_SECTIONS: readonly string[];
export const PROJECT_WORKFLOW_TRANSPORT_MODES: readonly ['OWN', 'RENTAL', 'THIRD_PARTY'];
export const PROJECT_WORKFLOW_TRANSPORT_MODE_LABELS: Readonly<Record<(typeof PROJECT_WORKFLOW_TRANSPORT_MODES)[number], string>>;
export const PROJECT_WORKFLOW_TEAM_TRANSPORT_MODES: readonly ['OWN', 'RENTAL', 'THIRD_PARTY', 'BUS', 'PLANE'];
export const PROJECT_WORKFLOW_TEAM_TRANSPORT_MODE_LABELS: Readonly<Record<(typeof PROJECT_WORKFLOW_TEAM_TRANSPORT_MODES)[number], string>>;
export const PROJECT_WORKFLOW_TRANSPORT_VEHICLE_TYPES: Readonly<{ OWN: readonly string[]; THIRD_PARTY: readonly string[] }>;
export const PROJECT_WORKFLOW_TRANSPORT_VEHICLE_TYPE_LABELS: Readonly<Record<string, string>>;
export function isHeadquartersWorkflow(workflow: { executedAtHeadquarters?: boolean | null } | null | undefined): boolean;
export function projectWorkflowVisibleStages(headquarters: boolean): readonly (typeof PROJECT_WORKFLOW_STAGES)[number][];
export function projectWorkflowReferenceDate<T extends string | Date>(workflow: { executedAtHeadquarters?: boolean | null; plannedExecutionStartDate?: T | null; plannedMobilizationDate?: T | null } | null | undefined): T | null;
export function projectWorkflowStageTransitions(stage: (typeof PROJECT_WORKFLOW_STAGES)[number], headquarters?: boolean): (typeof PROJECT_WORKFLOW_STAGES)[number][];
