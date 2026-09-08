import { apiClient, rdoApiPath } from './client';
import type { Collaborator } from '../types/domain';

export interface CollaboratorPayload {
  code?: string;
  name: string;
  jobRoleId: string;
  jobRoleEffectiveDate?: string;
  email?: string | null;
  signatureImage?: string | null;
  signatureNoticeAccepted?: true;
  signatureNoticeVersion?: string;
  terminationDate?: string | null;
  isActive?: boolean;
}

export interface CollaboratorJobRoleHistoryPayload {
  jobRoleId: string;
  effectiveDate: string;
  note?: string | null;
}

export async function listCollaborators() {
  const response = await apiClient.get<Collaborator[]>(rdoApiPath('/collaborators'));
  return response.data;
}

export async function createCollaborator(payload: CollaboratorPayload) {
  const response = await apiClient.post<Collaborator>(rdoApiPath('/collaborators'), payload);
  return response.data;
}

export async function updateCollaborator(id: string, payload: Partial<CollaboratorPayload>) {
  const response = await apiClient.put<Collaborator>(rdoApiPath(`/collaborators/${id}`), payload);
  return response.data;
}

export async function removeCollaborator(id: string) {
  await apiClient.delete(rdoApiPath(`/collaborators/${id}`));
}

export async function updateCollaboratorJobRoleHistory(id: string, historyId: string, payload: CollaboratorJobRoleHistoryPayload) {
  const response = await apiClient.put<Collaborator>(rdoApiPath(`/collaborators/${id}/job-role-history/${historyId}`), payload);
  return response.data;
}

export async function removeCollaboratorJobRoleHistory(id: string, historyId: string) {
  const response = await apiClient.delete<Collaborator>(rdoApiPath(`/collaborators/${id}/job-role-history/${historyId}`));
  return response.data;
}
