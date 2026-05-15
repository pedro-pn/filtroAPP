import { apiClient } from './client';
import type { AccountType, AppModule, ModuleRoleCode } from '../types/auth';
import type { InternalUserSummary } from '../types/domain';

export interface ModuleRoleInput {
  module: AppModule;
  role: ModuleRoleCode;
}

export interface CreateAccountPayload {
  username: string;
  name: string;
  email?: string | null;
  password: string;
  accountType: AccountType;
  moduleRoles?: ModuleRoleInput[];
}

export interface UpdateAccountPayload {
  name?: string;
  email?: string | null;
  password?: string;
  isActive?: boolean;
  accountType?: AccountType;
  moduleRoles?: ModuleRoleInput[];
  __confirmClientToAdmin?: boolean;
}

export async function listAccounts(filters?: { type?: AccountType; module?: AppModule }) {
  const response = await apiClient.get<InternalUserSummary[]>('/admin/accounts', {
    params: filters
  });
  return response.data;
}

export async function createAccount(payload: CreateAccountPayload) {
  const response = await apiClient.post<InternalUserSummary>('/admin/accounts', payload);
  return response.data;
}

export async function updateAccount(id: string, payload: UpdateAccountPayload) {
  const response = await apiClient.put<InternalUserSummary>(`/admin/accounts/${id}`, payload);
  return response.data;
}

export async function toggleAccountStatus(id: string) {
  const response = await apiClient.patch<InternalUserSummary>(`/admin/accounts/${id}/toggle`);
  return response.data;
}

export async function resendClientAccess(id: string) {
  const response = await apiClient.post<{ ok: true }>(`/admin/accounts/${id}/resend-access`);
  return response.data;
}
