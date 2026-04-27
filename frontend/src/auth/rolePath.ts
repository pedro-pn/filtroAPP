import type { UserRole } from '../types/auth';

export function roleHomePath(role: UserRole | undefined) {
  if (role === 'MANAGER') return '/gestor';
  if (role === 'COORDINATOR') return '/coordenador';
  if (role === 'CLIENT') return '/cliente';
  return '/home';
}
