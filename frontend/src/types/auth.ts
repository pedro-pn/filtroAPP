export type UserRole = 'COLLABORATOR' | 'MANAGER' | 'COORDINATOR' | 'CLIENT';
export type AccountType = 'ADMIN' | 'INTERNAL' | 'CLIENT';
export type ModuleRole =
  | 'rdo:manager'
  | 'rdo:coordinator'
  | 'rdo:collaborator'
  | 'rdo:client'
  | 'romaneio:manager'
  | 'romaneio:operator'
  | 'epi:technician'
  | 'epi:collaborator';

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  email: string | null;
  role: UserRole;
  accountType: AccountType;
  moduleRoles: ModuleRole[];
  isActive: boolean;
  clientCnpj?: string | null;
  collaboratorId?: string | null;
}

export interface LoginPayload {
  username: string;
  password: string;
  rememberMe?: boolean;
}
