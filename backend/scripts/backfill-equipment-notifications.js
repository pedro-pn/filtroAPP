import prisma from '../src/lib/prisma.js';
import { managerCoordinatorNotificationEmails } from '../src/lib/notification-preferences.js';

const dryRun = process.argv.includes('--dry-run');
const help = process.argv.includes('--help') || process.argv.includes('-h');

if (help) {
  console.log(`Uso: npm run backfill:equipment-notifications -- [opcoes]

Semeia os destinatários das notificações de calibração do módulo Equipamentos
com os gestores/coordenadores atuais (mesma audiência da lógica fixa anterior).
É idempotente: e-mails já cadastrados são pulados.

Opcoes:
  --dry-run   Mostra o que seria criado sem alterar o banco
  --help, -h  Mostra esta ajuda
`);
  process.exit(0);
}

async function main() {
  console.log(`[backfill-equipment-notifications] inicio${dryRun ? ' (dry-run)' : ''}`);
  const emails = await managerCoordinatorNotificationEmails({ client: prisma });
  let created = 0;
  let skipped = 0;

  for (const email of emails) {
    const existing = await prisma.equipmentNotificationRecipient.findUnique({ where: { email } });
    if (existing) { skipped += 1; continue; }
    if (!dryRun) {
      await prisma.equipmentNotificationRecipient.create({ data: { email, isActive: true } });
    }
    created += 1;
  }

  console.log(JSON.stringify({ dryRun, candidates: emails.length, created, skipped }, null, 2));
}

main()
  .catch(error => {
    console.error('[backfill-equipment-notifications] erro', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
