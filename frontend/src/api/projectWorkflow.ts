import { apiClient, type ApiClientError } from './client';

export type ProjectWorkflowStage = 'HANDOVER' | 'INITIAL_ANALYSIS' | 'WAITING_PLANNING' | 'MOBILIZATION_PLANNING' | 'PREPARATION' | 'READY_TO_MOBILIZE';
export type ProjectWorkflowChecklistStatus = 'PENDING' | 'DONE' | 'NOT_APPLICABLE';
export type ProjectWorkflowIssueStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
export type ProjectWorkflowCriticality = 'HIGH' | 'MEDIUM' | 'LOW';
export type ProjectWorkflowCommercialFactStatus = 'PENDING' | 'CONFIRMED' | 'NOT_APPLICABLE';
export type ProjectWorkflowCommercialFactSource = 'MANUAL' | 'CRM';
export type ProjectWorkflowChecklistSection = 'HANDOVER' | 'INITIAL_ANALYSIS' | 'ADVANCE_DOCUMENTATION' | 'D30_TEAM' | 'D30_EQUIPMENT' | 'D30_MATERIALS' | 'D30_LOGISTICS' | 'D15_TEAM' | 'D15_CLIENT' | 'D15_EQUIPMENT' | 'D15_MATERIALS' | 'D15_PRE_JOB' | 'D15_TRAVEL' | 'D15_QSMS';

export interface ProjectWorkflowPermissions {
  canInitialize: boolean;
  canEdit: boolean;
  canAccept: boolean;
  canChangeLeader: boolean;
  canEditCommercial: boolean;
  canAuthorizeMobilization: boolean;
}

export interface ProjectWorkflowProject {
  id: string;
  code: string;
  name: string;
  clientName: string;
  location: string;
}

export interface ProjectWorkflowMilestones {
  daysUntilMobilization: number | null;
  items: Array<{ key: string; label: string; days: number; date: string; due: boolean }>;
  dueMilestones: string[];
  nextMilestone: { key: string; label: string; days: number; date: string; due: boolean } | null;
  d30Date: string | null;
  d30Due: boolean;
}

export interface ProjectWorkflowChecklist {
  id?: string;
  key: string;
  stage: ProjectWorkflowStage | null;
  section: ProjectWorkflowChecklistSection;
  areaRoles: string[];
  label: string;
  status: ProjectWorkflowChecklistStatus;
  note: string | null;
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
  canEdit: boolean;
}

export interface ProjectWorkflowDocumentationReadiness {
  status: 'OK' | 'IN_PROGRESS' | 'CRITICAL';
  completed: number;
  total: number;
  blockers: Array<{ key: string; label: string; reason: string }>;
}

export interface ProjectWorkflowPlanningReadiness {
  completed: number;
  total: number;
  percentage: number;
  sections: Array<{ key: ProjectWorkflowChecklistSection; completed: number; total: number; percentage: number }>;
}

export type ProjectWorkflowPreparationReadiness = ProjectWorkflowPlanningReadiness;

export interface ProjectWorkflowMobilizationGateBlocker {
  key: string;
  label: string;
  reason: string;
  front: string;
}

export interface ProjectWorkflowMobilizationGateFront {
  key: string;
  label: string;
  status: 'READY' | 'BLOCKED';
  completed: number;
  total: number;
  blockers: Array<Omit<ProjectWorkflowMobilizationGateBlocker, 'front'>>;
}

export interface ProjectWorkflowMobilizationGate {
  ready: boolean;
  fronts: ProjectWorkflowMobilizationGateFront[];
  preJob: ProjectWorkflowMobilizationGateFront;
  blockers: ProjectWorkflowMobilizationGateBlocker[];
  deadlineStatus: 'READY' | 'RISK' | 'ATTENTION' | 'PENDING';
}

export interface ProjectWorkflowMobilizationAuthorization {
  status: 'NOT_AUTHORIZED' | 'AUTHORIZED' | 'SUSPENDED';
  authorized: boolean;
  authorizedAt: string | null;
  authorizedVersion: number | null;
  currentVersion: number;
}

export interface ProjectWorkflowCriticalAnswer {
  id?: string;
  key: string;
  label: string;
  area: string;
  issueDescription: string;
  answer: boolean | null;
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
}

export interface ProjectWorkflowIssue {
  id: string;
  sourceQuestion: string | null;
  description: string;
  area: string;
  ownerName: string | null;
  requiredLeadTimeDays: number | null;
  dueDate: string | null;
  criticality: ProjectWorkflowCriticality;
  status: ProjectWorkflowIssueStatus;
  overdue: boolean;
  updatedAt: string;
}

export interface ProjectWorkflowEvent {
  id: string;
  action: string;
  data: Record<string, unknown> | null;
  createdAt: string;
  actor: { id: string; name: string } | null;
}

export interface ProjectWorkflowCommercialFact {
  id: string | null;
  key: string;
  label: string;
  allowNotApplicable: boolean;
  evidence: 'reference' | 'note';
  handoverChecklistKey?: string;
  status: ProjectWorkflowCommercialFactStatus;
  source: ProjectWorkflowCommercialFactSource;
  reference: string | null;
  note: string | null;
  occurredOn: string | null;
  externalId: string | null;
  externalUrl: string | null;
  sourceVersion: string | null;
  sourceUpdatedAt: string | null;
  lastSyncedAt: string | null;
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
  readOnly: boolean;
}

export interface ProjectWorkflowCommercialReadiness {
  status: 'RELEASED' | 'NOT_RELEASED';
  resolvedCount: number;
  totalCount: number;
  blockers?: Array<{ key: string; label: string; reasons: string[] }>;
  blockedOperations: Array<'PURCHASE' | 'HIRING' | 'MOBILIZATION'>;
}

export interface ProjectWorkflowTransitionOption {
  stage: ProjectWorkflowStage;
  allowed: boolean;
  issues: string[];
}

export interface ProjectWorkflow {
  projectId: string;
  stage: ProjectWorkflowStage;
  leaderUserId: string;
  leader: { id: string; name: string; isActive: boolean };
  acceptedAt: string | null;
  plannedMobilizationDate: string;
  version: number;
  checklists: ProjectWorkflowChecklist[];
  criticalAnswers: ProjectWorkflowCriticalAnswer[];
  commercialFacts: ProjectWorkflowCommercialFact[];
  commercialReadiness: ProjectWorkflowCommercialReadiness;
  documentationReadiness: ProjectWorkflowDocumentationReadiness;
  planningReadiness: ProjectWorkflowPlanningReadiness;
  preparationReadiness: ProjectWorkflowPreparationReadiness;
  mobilizationGate: ProjectWorkflowMobilizationGate;
  mobilizationAuthorization: ProjectWorkflowMobilizationAuthorization;
  issues: ProjectWorkflowIssue[];
  events: ProjectWorkflowEvent[];
  milestones: ProjectWorkflowMilestones;
  permissions: ProjectWorkflowPermissions;
  handoverGate: { ready: boolean; issues: string[] };
  transitionOptions: ProjectWorkflowTransitionOption[];
}

export interface ProjectWorkflowSummary extends ProjectWorkflowProject {
  workflow: null | {
    projectId: string;
    stage: ProjectWorkflowStage;
    leader: { id: string; name: string; isActive: boolean };
    acceptedAt: string | null;
    plannedMobilizationDate: string;
    version: number;
    milestones: ProjectWorkflowMilestones;
    issueCount: number;
    overdueIssueCount: number;
    commercialReadiness: ProjectWorkflowCommercialReadiness;
    documentationReadiness: ProjectWorkflowDocumentationReadiness;
    planningReadiness: ProjectWorkflowPlanningReadiness;
    preparationReadiness: ProjectWorkflowPreparationReadiness;
    mobilizationGate: ProjectWorkflowMobilizationGate;
    mobilizationAuthorization: ProjectWorkflowMobilizationAuthorization;
  };
  permissions: ProjectWorkflowPermissions;
}

export interface ProjectWorkflowDetail {
  project: ProjectWorkflowProject;
  workflow: ProjectWorkflow | null;
  permissions: ProjectWorkflowPermissions;
}

export type ProjectWorkflowPatch =
  | { action: 'settings'; version: number; leaderUserId?: string; plannedMobilizationDate?: string }
  | { action: 'checklist'; version: number; key: string; status: ProjectWorkflowChecklistStatus; note?: string | null }
  | { action: 'critical'; version: number; key: string; answer: boolean }
  | { action: 'issue'; version: number; issueId: string; description: string; area: string; ownerName: string | null; requiredLeadTimeDays: number | null; dueDate: string | null; criticality: ProjectWorkflowCriticality; status: ProjectWorkflowIssueStatus }
  | { action: 'accept'; version: number }
  | { action: 'stage'; version: number; stage: ProjectWorkflowStage }
  | { action: 'authorize_mobilization'; version: number }
  | { action: 'commercial_fact'; version: number; key: string; status: ProjectWorkflowCommercialFactStatus; reference?: string | null; note?: string | null; occurredOn?: string | null };

const base = '/efetivo/project-workflow';

export async function listProjectWorkflows(search = '', page = 1) {
  return (await apiClient.get<{ items: ProjectWorkflowSummary[]; total: number; page: number; pageSize: number }>(base, {
    params: { ...(search ? { search } : {}), page }
  })).data;
}

export async function listProjectWorkflowLeaders() {
  return (await apiClient.get<Array<{ id: string; name: string }>>(`${base}/leaders`)).data;
}

export async function getProjectWorkflow(projectId: string) {
  return (await apiClient.get<ProjectWorkflowDetail>(`${base}/${encodeURIComponent(projectId)}`)).data;
}

export async function startProjectWorkflow(projectId: string, input: { leaderUserId: string; plannedMobilizationDate: string }) {
  return (await apiClient.post<ProjectWorkflowDetail>(`${base}/${encodeURIComponent(projectId)}`, input)).data;
}

export async function updateProjectWorkflow(projectId: string, input: ProjectWorkflowPatch) {
  return (await apiClient.patch<ProjectWorkflowDetail>(`${base}/${encodeURIComponent(projectId)}`, input)).data;
}

export function projectWorkflowErrorIssues(error: unknown) {
  const issues = (error as ApiClientError)?.issues as unknown[] | undefined;
  return (issues || []).map(issue => typeof issue === 'string' ? issue : String((issue as { message?: unknown })?.message || '')).filter(Boolean);
}
