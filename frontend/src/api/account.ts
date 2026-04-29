import { apiClient } from './client';
import type { AuthUser } from '../types/auth';

export async function updateAccountEmail(email: string | null) {
  const response = await apiClient.put<{ user: AuthUser }>('/auth/account', { email });
  return response.data.user;
}

export async function changePassword(currentPassword: string, newPassword: string) {
  const response = await apiClient.post<{ ok: true }>('/auth/change-password', {
    currentPassword,
    newPassword
  });
  return response.data;
}
