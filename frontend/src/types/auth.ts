import type { PublicModuleRole } from '../modules/registry';

export type UserRole = 'COLLABORATOR' | 'MANAGER' | 'COORDINATOR' | 'CLIENT';
export type AccountType = 'ADMIN' | 'INTERNAL' | 'CLIENT';
export type ModuleRole = PublicModuleRole;
export type ReportEmissionPermission = 'SITE_RDO' | 'MAINTENANCE' | 'PRODUCTION';

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  email: string | null;
  role: UserRole;
  accountType: AccountType;
  moduleRoles: ModuleRole[];
  reportEmissionPermissions: ReportEmissionPermission[];
  isActive: boolean;
  clientCnpj?: string | null;
  privacyPolicyAcceptedAt?: string | null;
  privacyPolicyVersion?: string | null;
  notificationPreferences?: {
    reports: boolean;
    signatures: boolean;
    signatureReminders: boolean;
    surveyReminders: boolean;
    calibrationReminders: boolean;
  };
  privacyPolicyRequired?: boolean;
  requiredPrivacyPolicyVersion?: string;
  collaboratorId?: string | null;
}

export interface LoginPayload {
  username: string;
  password: string;
  rememberMe?: boolean;
}
