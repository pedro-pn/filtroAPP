import { apiClient } from './client';
import type { WorkforceVisibilityRules } from '../../../shared/modules/workforce-visibility.js';

export type WorkforceClassification = 'OPERATIONAL' | 'NON_OPERATIONAL' | 'PENDING';
export const classificationLabels: Record<WorkforceClassification, string> = {
  OPERATIONAL: 'Operacional', NON_OPERATIONAL: 'Não operacional', PENDING: 'Aguardando classificação'
};
export interface WorkforcePerson {
  id: string; code: string; name: string; registrationNumber: string | null;
  isActive: boolean; rhStatus: string | null; workforceSector: string | null;
  sourceIsOperational: boolean | null; workforceClassificationOverride: WorkforceClassification | null;
  classification: WorkforceClassification; classificationSource: 'COLLABORATOR' | 'JOB_ROLE';
  classificationDiverges: boolean; classificationVersion: number; allocationReviewEnabled: boolean;
  jobRole: { id: string; name: string; workforceClassification: WorkforceClassification | null; isOperational: boolean };
}
export interface WorkforceRole {
  id: string; name: string; isActive: boolean; isOperational: boolean;
  workforceClassification: WorkforceClassification | null; sourceIsOperational: boolean | null;
  classificationManagedLocally: boolean; classificationVersion: number;
  _count: { collaborators: number };
}
export interface ClassificationEvent {
  id: string; entityType: string; entityId: string; actorUserId: string | null; actorName: string;
  reason: string; before: Record<string, unknown>; after: Record<string, unknown>; createdAt: string;
}
const base = '/admin/workforce-classification';
export async function getWorkforce(params: Record<string, string | number | undefined>) {
  return (await apiClient.get<{ items: WorkforcePerson[]; total: number; page: number; limit: number }>(`${base}/collaborators`, { params })).data;
}
export async function getWorkforceRoles() { return (await apiClient.get<WorkforceRole[]>(`${base}/job-roles`)).data; }
export async function classifyWorkforce(payload: {
  items: Array<{ id: string; version: number }>; classification?: WorkforceClassification | null; sector?: string | null;
  allocationReviewEnabled?: boolean; reason: string;
}) { return (await apiClient.patch<{ updated: number; affectedMissionIds: string[] }>(`${base}/collaborators`, payload)).data; }
export async function classifyWorkforceRole(id: string, payload: { classification: WorkforceClassification; version: number; reason: string }) {
  return (await apiClient.patch<{ affectedMissionIds: string[] }>(`${base}/job-roles/${id}`, payload)).data;
}
export async function getClassificationHistory(entityType: string, entityId: string) {
  return (await apiClient.get<ClassificationEvent[]>(`${base}/history`, { params: { entityType, entityId } })).data;
}

export interface WorkforceVisibilityConfiguration {
  version: number;
  rules: WorkforceVisibilityRules;
  refreshIntervalSeconds: number;
  updatedAt: string | null;
  updatedByUserId: string | null;
}
export async function getWorkforceVisibility() {
  return (await apiClient.get<WorkforceVisibilityConfiguration>(`${base}/visibility`)).data;
}
export async function saveWorkforceVisibility(payload: { version: number; rules: WorkforceVisibilityRules; reason: string }) {
  return (await apiClient.put<WorkforceVisibilityConfiguration & { affectedMissionIds: string[] }>(`${base}/visibility`, payload)).data;
}
