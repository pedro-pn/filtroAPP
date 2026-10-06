import { fileURLToPath } from 'node:url';

import {
  previewMonthlyAllocationDelivery,
  processMonthlyAllocationReport,
  validateYearMonth
} from '../src/lib/allocation-monthly-report.js';
import prisma from '../src/lib/prisma.js';

export async function retryAllocationMonthlyReports(args, {
  client = prisma,
  now = new Date(),
  processReport = processMonthlyAllocationReport,
  log = console.log
} = {}) {
  const apply = args.includes('--apply');
  const yearMonths = [...new Set(args.filter(arg => arg !== '--apply'))];
  if (!yearMonths.length || yearMonths.some(month => !validateYearMonth(month))) {
    throw new Error('Uso: node scripts/retry-allocation-monthly-report.js YYYY-MM [YYYY-MM ...] [--apply]');
  }

  // Valide todos os meses antes de iniciar qualquer envio.
  const previews = [];
  for (const yearMonth of yearMonths) {
    previews.push({ yearMonth, ...await previewMonthlyAllocationDelivery({ yearMonth, now, client }) });
  }
  for (const preview of previews) {
    const result = apply ? await processReport({ yearMonth: preview.yearMonth, now, client }) : preview;
    log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', yearMonth: preview.yearMonth, ...result }));
    if (apply && (result.pending > 0 || (result.skipped && (result.reason !== 'already_processed' || preview.pending > 0)))) {
      throw new Error(`O mês ${preview.yearMonth} continua pendente. Confira o resultado antes de prosseguir.`);
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await retryAllocationMonthlyReports(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
