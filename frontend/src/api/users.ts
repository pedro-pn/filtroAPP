import { adminApiPath, apiClient } from './client';
import type { AccountType, AuthUser, ModuleRole, ReportEmissionPermission } from '../types/auth';
import type { InternalUserSummary } from '../types/domain';

export interface UserPayload {
  username: string;
  name: string;
  email?: string | null;
  password?: string;
  role: AuthUser['role'];
  accountType?: AccountType;
  moduleRoles?: ModuleRole[];
  reportEmissionPermissions?: ReportEmissionPermission[];
  isActive?: boolean;
  collaboratorId?: string | null;
}

export interface UserDeletionImpact {
  assinaturas: {
    toDelete: number;
    toPreserve: number;
    finalizing: number;
  };
}

export type PasswordSetupResult =
  | {
      url: null;
      expiresAt: string;
      delivery: 'email';
    }
  | {
      url: string;
      expiresAt: string;
      delivery: 'manual';
    };

export type CreatedUser = InternalUserSummary & {
  passwordSetup: PasswordSetupResult;
};

export async function listUsers(group?: 'internal' | 'client') {
  const response = await apiClient.get<InternalUserSummary[]>(adminApiPath('/accounts'), {
    params: group ? { group } : undefined
  });
  return response.data;
}

export async function createUser(payload: UserPayload) {
  const response = await apiClient.post<CreatedUser>(adminApiPath('/accounts'), payload);
  return response.data;
}

export async function updateUser(id: string, payload: Partial<UserPayload>) {
  const response = await apiClient.put<InternalUserSummary>(adminApiPath(`/accounts/${id}`), payload);
  return response.data;
}

export async function removeUser(id: string) {
  await apiClient.delete(adminApiPath(`/accounts/${id}`));
}

export async function getUserDeletionImpact(id: string) {
  const response = await apiClient.get<UserDeletionImpact>(adminApiPath(`/accounts/${id}/impacto`));
  return response.data;
}

export async function resendClientAccess(id: string) {
  const response = await apiClient.post<{ ok: true }>(adminApiPath(`/accounts/${id}/resend-client-access`));
  return response.data;
}
