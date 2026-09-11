import { getActiveMissionGroup } from './mission-groups.js';

async function getDb(db) {
  return db || (await import('../prisma.js')).default;
}

async function listRomaneios(db, projectIds) {
  if (!projectIds.length) return [];
  return db.romaneio.findMany({
    where: { projectId: { in: projectIds }, project: { deletedAt: null } },
    orderBy: [{ romaneioDate: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
    select: {
      id: true,
      type: true,
      romaneioDate: true,
      vehiclePlate: true,
      project: { select: { id: true, code: true, name: true } },
      // Historical rows include every origin, custom items and inactive catalog items.
      // Keep each romaneio separate: an inbound is not another outbound quantity.
      items: {
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          itemCode: true,
          itemName: true,
          categoryName: true,
          quantity: true,
          unitLabel: true,
          isCustom: true,
          isExtra: true
        }
      }
    }
  });
}

export async function getProjectRomaneios(projectId, { db = null } = {}) {
  db = await getDb(db);
  const project = await db.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true }
  });
  if (!project) return null;
  return { romaneios: await listRomaneios(db, [project.id]) };
}

export async function getMissionGroupRomaneios(groupId, { db = null } = {}) {
  db = await getDb(db);
  const group = await getActiveMissionGroup({ groupId, db });
  const projectIds = [...new Set(group.members
    .filter(member => member.project && !member.project.deletedAt)
    .map(member => member.projectId))];
  return { romaneios: await listRomaneios(db, projectIds) };
}
