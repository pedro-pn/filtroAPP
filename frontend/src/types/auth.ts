export type UserRole = 'COLLABORATOR' | 'MANAGER' | 'COORDINATOR' | 'CLIENT';

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  email: string | null;
  role: UserRole;
  isActive: boolean;
  clientCnpj?: string | null;
  collaboratorId?: string | null;
}

export interface LoginPayload {
  username: string;
  password: string;
  rememberMe?: boolean;
}
