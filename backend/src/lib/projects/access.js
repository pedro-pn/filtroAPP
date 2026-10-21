import prisma from '../prisma.js';
import { clientProjectAccessWhereWithSigners } from '../client-project-access.js';

export async function projectListWhereForAuth(auth, activeParam, prismaClient = prisma, options = {}) {
  const where = { deletedAt: null };
  if (options.includeRegistrationPending === false) {
    where.registrationPending = false;
  }
  if (auth.user.role === 'MANAGER') {
    if (activeParam === 'true') where.isActive = true;
    if (activeParam === 'false') where.isActive = false;
  } else if (auth.user.role === 'COORDINATOR') {
    where.managerOnly = false;
    if (activeParam === 'true') where.isActive = true;
    if (activeParam === 'false') where.isActive = false;
  } else if (auth.user.role === 'CLIENT') {
    Object.assign(where, await clientProjectAccessWhereWithSigners(prismaClient, auth));
    if (activeParam === 'true') where.isActive = true;
    if (activeParam === 'false') where.isActive = false;
  } else {
    const collaboratorId = auth.user.collaboratorId;
    where.isActive = true;
    where.managerOnly = false;
    where.OR = [
      {
        visibleToCollaborators: true,
        operatorId: collaboratorId || '__NO_MATCH__'
      },
      {
        authorizedUsers: {
          some: { userId: auth.user.id }
        }
      }
    ];
  }
  return where;
}
