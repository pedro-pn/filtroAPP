import { apiClient } from './client';
import type { AuthUser, LoginPayload } from '../types/auth';

interface LoginResponse {
  token: string;
  expiresAt: string;
  user: AuthUser;
}

interface MeResponse {
  user: AuthUser;
}

export async function login(payload: LoginPayload) {
  const response = await apiClient.post<LoginResponse>('/auth/login', payload);
  return response.data;
}

export async function logout() {
  await apiClient.post('/auth/logout');
}

export async function me() {
  const response = await apiClient.get<MeResponse>('/auth/me');
  return response.data.user;
}

export async function forgotPassword(identifier: string) {
  const response = await apiClient.post<{ ok: true; message: string }>('/auth/forgot-password', { identifier });
  return response.data;
}

export async function resetPassword(token: string, password: string) {
  const response = await apiClient.post<{ ok: true }>('/auth/reset-password', { token, password });
  return response.data;
}

export async function getResetPasswordStatus(token: string) {
  const response = await apiClient.get<{ valid: boolean; expired: boolean; used: boolean }>('/auth/reset-password-status', {
    params: { token }
  });
  return response.data;
}
