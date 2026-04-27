import { apiClient } from './client';
import type { Collaborator } from '../types/domain';

export interface CollaboratorPayload {
  code?: string;
  name: string;
  role: string;
  email?: string | null;
  signatureImage?: string | null;
  isActive?: boolean;
}

export async function listCollaborators() {
  const response = await apiClient.get<Collaborator[]>('/collaborators');
  return response.data;
}

export async function createCollaborator(payload: CollaboratorPayload) {
  const response = await apiClient.post<Collaborator>('/collaborators', payload);
  return response.data;
}

export async function updateCollaborator(id: string, payload: Partial<CollaboratorPayload>) {
  const response = await apiClient.put<Collaborator>(`/collaborators/${id}`, payload);
  return response.data;
}

export async function removeCollaborator(id: string) {
  await apiClient.delete(`/collaborators/${id}`);
}
