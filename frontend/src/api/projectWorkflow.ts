import { apiClient, type ApiClientError } from './client';

export type ProjectWorkflowStage = 'HANDOVER' | 'INITIAL_ANALYSIS' | 'WAITING_PLANNING' | 'MOBILIZATION_PLANNING';
export type ProjectWorkflowChecklistStatus = 'PENDING' | 'DONE' | 'NOT_APPLICABLE';
export type ProjectWorkflowIssueStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
export type ProjectWorkflowCriticality = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ProjectWorkflowPermissions {
  canInitialize: boolean;
  canEdit: boolean;
  canAccept: boolean;
  canChangeLeader: boolean;
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
  d30Date: string | null;
  d30Due: boolean;
}

export interface ProjectWorkflowChecklist {
  id?: string;
  key: string;
  stage: ProjectWorkflowStage;
  label: string;
  status: ProjectWorkflowChecklistStatus;
  note: string | null;
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
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
  issues: ProjectWorkflowIssue[];
  events: ProjectWorkflowEvent[];
  milestones: ProjectWorkflowMilestones;
  permissions: ProjectWorkflowPermissions;
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
  | { action: 'stage'; version: number; stage: ProjectWorkflowStage };

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
