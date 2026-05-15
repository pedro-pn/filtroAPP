import { useAuth } from './AuthContext';

export function useHubChip(): boolean {
  const { user } = useAuth();
  if (!user) return false;
  // ADMIN sempre precisa do hub (acesso a /admin/accounts)
  if (user.accountType === 'ADMIN') return true;
  // Usuário com múltiplos módulos precisa navegar entre eles
  if (user.moduleRoles.length > 1) return true;
  return false;
}
