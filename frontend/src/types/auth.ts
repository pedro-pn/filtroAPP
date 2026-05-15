export type UserRole = 'COLLABORATOR' | 'MANAGER' | 'COORDINATOR' | 'CLIENT';
export type AccountType = 'ADMIN' | 'INTERNAL' | 'CLIENT';
export type AppModule = 'RDO' | 'ROMANEIO' | 'EPI';
export type ModuleRoleCode =
  | 'RDO_MANAGER'
  | 'RDO_COORDINATOR'
  | 'RDO_COLLABORATOR'
  | 'RDO_CLIENT'
  | 'ROMANEIO_MANAGER'
  | 'ROMANEIO_OPERATOR'
  | 'EPI_TECHNICIAN'
  | 'EPI_COLLABORATOR';

export interface UserModuleRole {
  module: AppModule;
  role: ModuleRoleCode;
}

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  email: string | null;
  role: UserRole;
  accountType: AccountType;
  moduleRoles: UserModuleRole[];
  isActive: boolean;
  collaboratorId?: string | null;
}

export interface LoginPayload {
  username: string;
  password: string;
  rememberMe?: boolean;
}
