// União limitada de três consultas Prisma; evita carregar todos os projetos e
// permite cortar uma página entre papéis do mesmo projeto sem perder linhas.
const roles = ['FIELD_OPERATOR', 'LEADER', 'PLANNER'];

export async function loadProjectResponsibleRows(client, { resource, query, visibility, snapshotAt, position }) {
  const since = query.updatedSince ? new Date(query.updatedSince) : null;
  const batches = await Promise.all(roles.map(async role => {
    const assigned = role === 'FIELD_OPERATOR' ? { operatorId: { not: null } }
      : role === 'LEADER' ? { workflow: { isNot: null } }
        : { workflow: { is: { plannerUserId: { not: null } } } };
    const rows = await client.project.findMany({
      select: resource.select,
      where: { AND: [visibility, assigned,
        { updatedAt: { lte: snapshotAt } },
        { OR: [{ workflow: null }, { workflow: { is: { updatedAt: { lte: snapshotAt } } } }] },
        ...(since ? [{ OR: [{ updatedAt: { gte: since } }, { workflow: { is: { updatedAt: { gte: since } } } }] }] : []),
        ...(position ? [{ id: { [role > position.role ? 'gte' : 'gt']: position.projectId } }] : [])
      ] },
      orderBy: [{ id: 'asc' }], take: query.limit + 1
    });
    return rows.map(row => ({ ...row, projectId: row.id, role, responsibleRole: role }));
  }));
  return batches.flat().sort((a, b) => a.projectId < b.projectId ? -1 : a.projectId > b.projectId ? 1 : roles.indexOf(a.role) - roles.indexOf(b.role))
    .slice(0, query.limit + 1);
}
