import type { AccountType, ModuleRole } from '../../types/auth';

export function rolesForAccountType(accountType: AccountType, currentRoles: ModuleRole[]): ModuleRole[] {
  if (accountType === 'CLIENT') return ['rdo:client'];
  if (accountType === 'ADMIN') {
    const roles = currentRoles.filter(role => role !== 'rdo:client' && role !== 'rdo:coordinator' && role !== 'rdo:collaborator');
    return Array.from(new Set<ModuleRole>(roles));
  }
  const roles = currentRoles.filter(role => role !== 'rdo:client' && role !== 'rdo:manager');
  return Array.from(new Set<ModuleRole>(roles));
}
