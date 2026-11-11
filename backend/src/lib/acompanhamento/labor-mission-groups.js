// Keep the active parent selection and order. Prisma would also select the
// member table when there are no groups; read children only for actual parents.
export async function loadLaborMissionGroups(database) {
  const groups = await database.acompanhamentoMissionGroup.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, laborAllocationMode: true, primaryLaborProjectId: true }
  });
  if (!groups.length) return [];
  const members = await database.acompanhamentoMissionGroupMember.findMany({
    where: { groupId: { in: groups.map(group => group.id) } },
    select: { groupId: true, projectId: true }
  });
  const byGroup = new Map();
  for (const { groupId, projectId } of members) {
    if (!byGroup.has(groupId)) byGroup.set(groupId, []);
    byGroup.get(groupId).push({ projectId });
  }
  return groups.map(group => ({ ...group, members: byGroup.get(group.id) || [] }));
}
