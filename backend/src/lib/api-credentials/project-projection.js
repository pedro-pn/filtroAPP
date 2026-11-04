import env from '../../config/env.js';

// O domínio corporativo foi confirmado para o contrato Omni. Não usar username,
// contatos de cliente ou e-mail do colaborador como fallback de identidade Entra.
export function corporateEmail(value) {
  const email = typeof value === 'string' ? value.trim() : '';
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@filtrovali\.com\.br$/i.test(email) ? email : null;
}

export function projectOperationalProject(row) {
  const cnpj = String(row.clientCnpj || '').replace(/\D/g, '');
  const mapping = row.prismaMapping;
  return { ...row, clientCnpj: /^\d{14}$/.test(cnpj) ? cnpj : null,
    executedAtHeadquarters: row.workflow?.executedAtHeadquarters ?? null,
    prisma: mapping ? { missionId: mapping.prismaMissionId, number: mapping.number ?? null, numberScope: mapping.numberScope ?? null } : null };
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

// O vínculo público é sempre o de produção, mesmo em uma instalação de homologação.
export async function enrichProjectPrismaMappings(client, rows, context = {}) {
  if (!rows.length) return rows;
  const mappings = await client.crmProjectMapping.findMany({
    where: { sourceSystem: 'prismaCRM', tenantId: (context.envConfig || env).crmPlanningTenantId || 'filtrovali',
      environment: 'production', projectId: { in: rows.map(row => row.id) } },
    select: { projectId: true, prismaMissionId: true, number: true, numberScope: true }
  });
  const byProject = new Map(mappings.map(mapping => [mapping.projectId, mapping]));
  return rows.map(row => ({ ...row, prismaMapping: byProject.get(row.id) ?? null }));
}
