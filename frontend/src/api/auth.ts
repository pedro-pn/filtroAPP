import { apiClient } from './client';
import type { AuthUser, LoginPayload, TwoFactorChallenge, TwoFactorStatus } from '../types/auth';

export interface LoginResponse {
  token: string;
  expiresAt: string;
  user: AuthUser;
  trustedDeviceToken?: string;
}

export type LoginResult = LoginResponse | (TwoFactorChallenge & { twoFactorRequired: true });

export function isTwoFactorChallenge(result: LoginResult): result is TwoFactorChallenge & { twoFactorRequired: true } {
  return (result as { twoFactorRequired?: boolean }).twoFactorRequired === true;
}

interface MeResponse {
  user: AuthUser;
}

export async function login(payload: LoginPayload) {
  const response = await apiClient.post<LoginResult>('/auth/login', payload);
  return response.data;
}

export async function verifyTwoFactor(payload: { challengeToken: string; code: string; rememberDevice?: boolean }) {
  const response = await apiClient.post<LoginResponse>('/auth/2fa/verify', payload);
  return response.data;
}

export async function resendTwoFactor(challengeToken: string) {
  const response = await apiClient.post<{ ok: true; emailHint: string }>('/auth/2fa/resend', { challengeToken });
  return response.data;
}

export async function getTwoFactorStatus() {
  const response = await apiClient.get<TwoFactorStatus>('/auth/2fa');
  return response.data;
}

export async function startTwoFactorEnable() {
  const response = await apiClient.post<{ challengeToken: string; emailHint: string; expiresAt: string }>('/auth/2fa/enable');
  return response.data;
}

export async function confirmTwoFactorEnable(challengeToken: string, code: string) {
  const response = await apiClient.post<TwoFactorStatus>('/auth/2fa/enable/confirm', { challengeToken, code });
  return response.data;
}

export async function disableTwoFactor(currentPassword: string) {
  const response = await apiClient.post<TwoFactorStatus>('/auth/2fa/disable', { currentPassword });
  return response.data;
}

export async function revokeTrustedDevice(deviceId: string) {
  const response = await apiClient.delete<TwoFactorStatus>(`/auth/2fa/devices/${encodeURIComponent(deviceId)}`);
  return response.data;
}

export async function revokeAllTrustedDevices() {
  const response = await apiClient.delete<TwoFactorStatus>('/auth/2fa/devices');
  return response.data;
}

export async function logout() {
  await apiClient.post('/auth/logout');
}

export async function me() {
  const response = await apiClient.get<MeResponse>('/auth/me');
  return response.data.user;
}

export async function acceptClientPrivacyConsent(payload: { privacyNoticeAccepted: true; privacyNoticeVersion: string }) {
  const response = await apiClient.post<MeResponse>('/auth/client-privacy-consent', payload);
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

export async function resendPasswordSetup(token: string) {
  const response = await apiClient.post<{ ok: true; message: string }>('/auth/resend-password-setup', { token });
  return response.data;
}

export async function getResetPasswordStatus(token: string) {
  const response = await apiClient.get<{
    valid: boolean;
    expired: boolean;
    used: boolean;
    username: string | null;
    name: string | null;
    canRequestNewLink: boolean;
  }>('/auth/reset-password-status', {
    params: { token }
  });
  return response.data;
}
