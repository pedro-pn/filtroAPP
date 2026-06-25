import prisma from '../src/lib/prisma.js';
import { componentsFromRow } from '../src/lib/acompanhamento-access-import.js';

const apply = process.argv.includes('--apply');

async function main() {
  const proposals = await prisma.commercialProposal.findMany({ select: { id: true, codBd: true, components: true, rawRow: true } });
  let pending = 0;
  for (const p of proposals) {
    const hasComponents = p.components && Object.values(p.components).some(v => v !== null && v !== undefined);
    if (hasComponents) continue;
    pending += 1;
    if (apply) {
      await prisma.commercialProposal.update({
        where: { id: p.id },
        data: { components: componentsFromRow(p.rawRow || {}) }
      });
    }
  }
  console.log(`Propostas: ${proposals.length} · sem componentes: ${pending}`);
  console.log(apply ? `${pending} atualizada(s) a partir do rawRow.` : 'Dry-run. Rode com --apply para gravar.');
}

main()
  .catch(error => { console.error(error); process.exit(1); })
  .finally(() => prisma.$disconnect());
