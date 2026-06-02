import prisma from '../src/lib/prisma.js';
import {
  extractReportUploadAttachments,
  syncReportUploadAttachments
} from '../src/lib/report-upload-attachments.js';

const dryRun = process.argv.includes('--dry-run');
const help = process.argv.includes('--help') || process.argv.includes('-h');
const batchArg = process.argv.find(arg => arg.startsWith('--batch='));
const batchSize = Math.max(1, Number(batchArg?.split('=')[1] || 100));

if (help) {
  console.log(`Uso: npm run backfill:report-attachments -- [opcoes]

Opcoes:
  --dry-run       Conta os anexos que seriam recriados sem alterar o banco
  --batch=N       Quantidade de relatórios por lote (padrão: 100)
  --help, -h      Mostra esta ajuda
`);
  process.exit(0);
}

async function fetchBatch(cursorId) {
  return prisma.report.findMany({
    ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    take: batchSize,
    orderBy: { id: 'asc' },
    select: {
      id: true,
      sequenceNumber: true,
      reportType: true,
      project: {
        select: {
          code: true,
          name: true
        }
      },
      specialConditions: true,
      services: {
        select: {
          id: true,
          extraData: true
        }
      }
    }
  });
}

async function main() {
  let cursorId = null;
  let processed = 0;
  let reportsWithUploads = 0;
  let created = 0;
  let deleted = 0;

  console.log(`[backfill-report-attachments] inicio${dryRun ? ' (dry-run)' : ''}`);

  while (true) {
    const reports = await fetchBatch(cursorId);
    if (!reports.length) break;

    for (const report of reports) {
      processed += 1;
      const attachments = extractReportUploadAttachments(report, { requireProjectScope: true });
      if (attachments.length) reportsWithUploads += 1;

      if (dryRun) {
        created += attachments.length;
      } else {
        const result = await syncReportUploadAttachments(prisma, report, { trustLegacyProjectScoped: true });
        created += result.created;
        deleted += result.deleted;
      }
    }

    cursorId = reports[reports.length - 1].id;
    console.log(`[backfill-report-attachments] processados=${processed} comUploads=${reportsWithUploads} criados${dryRun ? 'Previstos' : ''}=${created} removidos=${deleted}`);
  }

  console.log(JSON.stringify({
    dryRun,
    processed,
    reportsWithUploads,
    created,
    deleted
  }, null, 2));
}

main()
  .catch(error => {
    console.error('[backfill-report-attachments] erro', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
