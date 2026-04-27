import { apiClient } from './client';
import type { ReportDraft } from '../types/domain';

export interface DraftPayload {
  id?: string;
  projectId?: string | null;
  title?: string | null;
  reportDate?: string | null;
  payload: Record<string, unknown>;
}

export async function listDrafts() {
  const response = await apiClient.get<ReportDraft[]>('/drafts');
  return response.data;
}

export async function createDraft(payload: DraftPayload) {
  const response = await apiClient.post<ReportDraft>('/drafts', payload);
  return response.data;
}

export async function updateDraft(id: string, payload: Omit<DraftPayload, 'id'>) {
  const response = await apiClient.put<ReportDraft>(`/drafts/${id}`, payload);
  return response.data;
}

export async function removeDraft(id: string) {
  await apiClient.delete(`/drafts/${id}`);
}
