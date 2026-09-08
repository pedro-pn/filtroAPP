import prisma from '../src/lib/prisma.js';

const help = process.argv.includes('--help') || process.argv.includes('-h');

if (help) {
  console.log(`Uso: npm run normalize:collaborator-roles

Audita se todos os colaboradores apontam para um cargo canônico.
O campo textual legado não existe mais; alterações devem usar jobRoleId.`);
  process.exit(0);
}

async function main() {
  const collaborators = await prisma.collaborator.findMany({
    select: {
      id: true,
      code: true,
      name: true,
      jobRoleId: true,
      jobRole: { select: { id: true, name: true, isActive: true } }
    }
  });
  const invalid = collaborators.filter(item => !item.jobRole || item.jobRole.id !== item.jobRoleId);
  console.log(`Colaboradores: ${collaborators.length}`);
  console.log(`Com cargo canônico: ${collaborators.length - invalid.length}`);
  console.log(`Sem vínculo válido: ${invalid.length}`);
  for (const item of invalid) console.log(`  ${item.code || item.id} (${item.name})`);
  if (invalid.length) process.exitCode = 1;
}

main()
  .catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
