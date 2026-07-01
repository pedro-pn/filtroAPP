import type { AccountType, ModuleRole } from '../../types/auth';
import { rolesCompatibleWithAccountType } from '../../modules/registry';

export function rolesForAccountType(accountType: AccountType, currentRoles: ModuleRole[]): ModuleRole[] {
  if (accountType === 'CLIENT') return ['rdo:client'];
  const compatibleRoles = new Set(rolesCompatibleWithAccountType(accountType));
  const roles = currentRoles.filter(role => compatibleRoles.has(role));
  return Array.from(new Set<ModuleRole>(roles));
}
