export const REVIEW_REPORTS = 'REVIEW_REPORTS';
export const CREATE_SERVICE_ONLY_REPORTS = 'CREATE_SERVICE_ONLY_REPORTS';

// Apenas contas internas com o papel de coordenador do RDO podem receber a
// permissão: são as que já enxergam a fila de pendentes de todos os projetos.
export function canReceiveRdoExtraPermissions(user) {
  return user?.accountType === 'INTERNAL'
    && user.moduleRoles?.includes('rdo:coordinator') === true;
}

// Revisar = abrir a tela de edição do gestor, salvar, aprovar e devolver, além
// das ações auxiliares da revisão (DOCX, numeração, descartar edição, auditoria).
// Não inclui excluir relatórios nem criar relatórios somente de serviço.
export function canReviewRdoReports(user) {
  if (user?.role === 'MANAGER') return true;
  return canReceiveRdoExtraPermissions(user)
    && user.rdoExtraPermissions?.includes(REVIEW_REPORTS) === true;
}

export function canCreateServiceOnlyRdoReports(user) {
  if (user?.role === 'MANAGER') return true;
  return canReceiveRdoExtraPermissions(user)
    && user.rdoExtraPermissions?.includes(CREATE_SERVICE_ONLY_REPORTS) === true;
}

export function normalizeRdoExtraPermissions(value, user) {
  const permissions = value ?? [];
  if (!Array.isArray(permissions) || permissions.some(permission => ![REVIEW_REPORTS, CREATE_SERVICE_ONLY_REPORTS].includes(permission))) {
    throw new Error('Permissão adicional de RDO inválida.');
  }
  return canReceiveRdoExtraPermissions(user) ? [...new Set(permissions)] : [];
}
