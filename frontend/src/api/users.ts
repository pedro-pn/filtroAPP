import { apiClient } from './client';
import type { AuthUser } from '../types/auth';
import type { InternalUserSummary } from '../types/domain';

export interface UserPayload {
  username: string;
  name: string;
  email?: string | null;
  password?: string;
  role: AuthUser['role'];
  isActive?: boolean;
  collaboratorId?: string | null;
}

export async function listUsers(group?: 'internal' | 'client') {
  const response = await apiClient.get<InternalUserSummary[]>('/users', {
    params: group ? { group } : undefined
  });
  return response.data;
}

export async function createUser(payload: UserPayload) {
  const response = await apiClient.post<InternalUserSummary>('/users', payload);
  return response.data;
}

export async function updateUser(id: string, payload: Partial<UserPayload>) {
  const response = await apiClient.put<InternalUserSummary>(`/users/${id}`, payload);
  return response.data;
}

export async function removeUser(id: string) {
  await apiClient.delete(`/users/${id}`);
}

export async function resendClientAccess(id: string) {
  const response = await apiClient.post<{ ok: true }>(`/users/${id}/resend-client-access`);
  return response.data;
}
