import { createRequire } from 'node:module';
import { projectDistributionSettings } from '../../../../shared/modules/project-distribution.js';

const require = createRequire(import.meta.url);

export { projectDistributionDefaults, projectDistributionSettings } from '../../../../shared/modules/project-distribution.js';

export function projectChannelWhere(channel) {
  // Pure planning helpers also load this module in frontend-only test installs.
  // Resolve Prisma's database-null sentinel when constructing an ORM query.
  const { Prisma } = require('@prisma/client');
  return { deletedAt: null, AND: [{ OR: [
    { distributionSettings: { path: [channel], equals: true } },
    { managerOnly: false, distributionSettings: { equals: Prisma.DbNull } }
  ] }] };
}

export function projectAllowsChannel(project, channel) {
  return Boolean(project && !project.deletedAt && projectDistributionSettings(project)[channel]);
}

export function assertProjectChannel(project, channel) {
  if (projectAllowsChannel(project, channel)) return;
  throw Object.assign(new Error('Projeto não encontrado.'), { statusCode: 404, code: 'NOT_FOUND' });
}
