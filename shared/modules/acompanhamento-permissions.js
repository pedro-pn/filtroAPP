export const PROJECT_TAXES_AND_BILLING = 'VIEW_PROJECT_TAXES_AND_BILLING';

export function canReceiveAcompanhamentoExtraPermissions(user) {
  return user?.accountType === 'INTERNAL'
    && user.moduleRoles?.includes('acompanhamento:manager') === true;
}

export function canViewProjectFinancials(user) {
  return user?.accountType === 'ADMIN'
    || (canReceiveAcompanhamentoExtraPermissions(user)
      && user.acompanhamentoExtraPermissions?.includes(PROJECT_TAXES_AND_BILLING) === true);
}

export function normalizeAcompanhamentoExtraPermissions(value, user) {
  const permissions = value ?? [];
  if (!Array.isArray(permissions) || permissions.some(permission => permission !== PROJECT_TAXES_AND_BILLING)) {
    throw new Error('Permissão adicional de Acompanhamento inválida.');
  }
  return canReceiveAcompanhamentoExtraPermissions(user) ? [...new Set(permissions)] : [];
}
