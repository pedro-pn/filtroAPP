/*
 * Sincroniza dados do Omie para o banco do app (projetos, categorias e compras/contas a pagar).
 *
 * Uso (com credenciais no ambiente):
 *   OMIE_APP_KEY=... OMIE_APP_SECRET=... npm run omie:sync
 *   ... node scripts/omie-sync.js projetos | categorias | compras
 */

import { omieConfigured } from '../src/lib/omie-client.js';
import { syncOmieAll, syncOmieCategories, syncOmiePurchases, syncOmieProjects } from '../src/lib/omie-sync.js';
import prisma from '../src/lib/prisma.js';

async function main() {
  if (!omieConfigured()) {
    console.error('Defina OMIE_APP_KEY e OMIE_APP_SECRET no ambiente.');
    process.exit(1);
  }
  const only = process.argv[2];
  const sinceDays = process.argv[3] ? Number(process.argv[3]) : null; // ex.: omie:sync compras 30
  if (only === 'projetos') console.log('projetos:', await syncOmieProjects());
  else if (only === 'categorias') console.log('categorias:', await syncOmieCategories());
  else if (only === 'compras') console.log('compras:', await syncOmiePurchases({ sinceDays }));
  else console.log('tudo:', JSON.stringify(await syncOmieAll(), null, 2));
}

main()
  .catch(error => { console.error('Falha na sincronização Omie:', error.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
