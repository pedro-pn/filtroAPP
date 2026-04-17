import prisma from '../src/lib/prisma.js';
import { normalizeSignatureValue } from '../src/lib/signature-image.js';

async function main() {
  const collaborators = await prisma.collaborator.findMany({
    where: {
      signatureImage: {
        not: null
      }
    },
    select: {
      id: true,
      code: true,
      name: true,
      signatureImage: true
    }
  });

  let updated = 0;
  for (const collaborator of collaborators) {
    const current = String(collaborator.signatureImage || '');
    if (!current || current.startsWith('data:')) continue;
    const normalized = await normalizeSignatureValue(current);
    if (!normalized) continue;
    await prisma.collaborator.update({
      where: { id: collaborator.id },
      data: { signatureImage: normalized }
    });
    updated += 1;
    console.log(`Assinatura migrada: ${collaborator.code} - ${collaborator.name}`);
  }

  console.log(`Migração concluída. ${updated} assinatura(s) convertida(s) para base64.`);
}

main()
  .catch(error => {
    console.error('Falha ao migrar assinaturas para base64.', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
