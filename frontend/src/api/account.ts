import { apiClient } from './client';
import type { AuthUser } from '../types/auth';

export interface AccountEmailUpdateResponse {
  user: AuthUser;
  emailChangePending?: boolean;
  pendingEmail?: string;
  expiresAt?: string;
  message?: string;
}

export interface EmailChangeStatus {
  valid: boolean;
  expired: boolean;
  used: boolean;
  email: string | null;
}

export async function updateAccountEmail(email: string | null) {
  const response = await apiClient.put<AccountEmailUpdateResponse>('/auth/account', { email });
  return response.data;
}

export async function changePassword(currentPassword: string, newPassword: string) {
  const response = await apiClient.post<{ ok: true }>('/auth/change-password', {
    currentPassword,
    newPassword
  });
  return response.data;
}

export async function getEmailChangeStatus(token: string) {
  const response = await apiClient.get<EmailChangeStatus>('/auth/email-change-status', {
    params: { token }
  });
  return response.data;
}

export async function confirmEmailChange(token: string) {
  const response = await apiClient.post<{ ok: true; user: AuthUser }>('/auth/confirm-email-change', { token });
  return response.data;
}
