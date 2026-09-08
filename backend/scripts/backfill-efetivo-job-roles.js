// Compatibilidade para chamadas antigas. O fluxo canônico e idempotente vive no script abaixo.
import prisma from '../src/lib/prisma.js';
import { runCollaboratorJobRoleBackfill } from './backfill-collaborator-job-roles.mjs';

export { planCanonicalJobRoleBackfill as planJobRoleBackfill } from '../src/lib/collaborators/job-role-service.js';
export { runCollaboratorJobRoleBackfill as runJobRoleBackfill };

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const result = await runCollaboratorJobRoleBackfill({ database: prisma, apply: process.argv.includes('--apply') });
  console.log(JSON.stringify(result, null, 2));
  await prisma.$disconnect();
}
