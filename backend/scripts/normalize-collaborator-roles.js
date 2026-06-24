import prisma from '../src/lib/prisma.js';

const apply = process.argv.includes('--apply');
const help = process.argv.includes('--help') || process.argv.includes('-h');

if (help) {
  console.log(`Uso: npm run normalize:collaborator-roles -- [--apply]

Normaliza o campo "role" (cargo) dos colaboradores para os nomes da lista JobRole.
Casa por correspondência exata, sem acento e sem diferenciar maiúsculas/espaços.
Sem --apply, apenas mostra o que faria (dry-run).
`);
  process.exit(0);
}

// Normaliza para comparação: minúsculas, sem acento, espaços colapsados.
function normalizeKey(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  const roles = await prisma.jobRole.findMany({ select: { name: true } });
  const canonicalByKey = new Map(roles.map(r => [normalizeKey(r.name), r.name]));

  const collaborators = await prisma.collaborator.findMany({ select: { id: true, code: true, name: true, role: true } });

  let alreadyCanonical = 0;
  const toUpdate = [];
  const unmatched = [];

  for (const c of collaborators) {
    const canonical = canonicalByKey.get(normalizeKey(c.role));
    if (!canonical) {
      unmatched.push(c);
      continue;
    }
    if (canonical === c.role) {
      alreadyCanonical += 1;
      continue;
    }
    toUpdate.push({ ...c, canonical });
  }

  console.log(`Colaboradores: ${collaborators.length}`);
  console.log(`Já canônicos: ${alreadyCanonical}`);
  console.log(`A normalizar: ${toUpdate.length}`);
  console.log(`Sem correspondência na lista: ${unmatched.length}`);

  if (toUpdate.length) {
    console.log('\n— Normalizações —');
    for (const c of toUpdate) console.log(`  ${c.code || c.id}: "${c.role}" -> "${c.canonical}"`);
  }
  if (unmatched.length) {
    console.log('\n— Sem correspondência (revisar manualmente ou adicionar à lista de cargos) —');
    for (const c of unmatched) console.log(`  ${c.code || c.id} (${c.name}): "${c.role}"`);
  }

  if (!apply) {
    console.log('\nDry-run. Rode com --apply para gravar as normalizações.');
    return;
  }

  for (const c of toUpdate) {
    await prisma.collaborator.update({ where: { id: c.id }, data: { role: c.canonical } });
  }
  console.log(`\n${toUpdate.length} colaborador(es) atualizado(s).`);
}

main()
  .catch(error => { console.error(error); process.exit(1); })
  .finally(() => prisma.$disconnect());
