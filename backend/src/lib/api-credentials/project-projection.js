// O domínio corporativo foi confirmado para o contrato Omni. Não usar username,
// contatos de cliente ou e-mail do colaborador como fallback de identidade Entra.
export function corporateEmail(value) {
  const email = typeof value === 'string' ? value.trim() : '';
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@filtrovali\.com\.br$/i.test(email) ? email : null;
}

export function projectOperationalProject(row) {
  const cnpj = String(row.clientCnpj || '').replace(/\D/g, '');
  return { ...row, clientCnpj: /^\d{14}$/.test(cnpj) ? cnpj : null,
    executedAtHeadquarters: row.workflow?.executedAtHeadquarters ?? null };
}

export function projectResponsible(row) {
  const role = row.responsibleRole;
  const collaborator = role === 'FIELD_OPERATOR' ? row.operator : null;
  const user = collaborator ? collaborator.user : role === 'LEADER' ? row.workflow?.leader : role === 'PLANNER' ? row.workflow?.planner : null;
  const stamps = [row.updatedAt, row.workflow?.updatedAt].filter(Boolean).map(value => new Date(value).getTime()).filter(Number.isFinite);
  return {
    projectId: row.id, projectCode: row.code, role,
    userId: user?.id ?? null, collaboratorId: collaborator?.id ?? null,
    name: collaborator?.name ?? user?.name, email: corporateEmail(user?.email),
    updatedAt: stamps.length ? new Date(Math.max(...stamps)).toISOString() : null
  };
}
