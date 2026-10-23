import prisma from '../src/lib/prisma.js';
import { prepareStoredCommercialReceipt } from '../src/lib/projects/commercialapp-receipt-backfill.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const ids = args.filter(value => value.startsWith('--project-id=')).map(value => value.slice('--project-id='.length));
if (!ids.length || ids.some(id => !id) || args.some(value => value !== '--apply' && !value.startsWith('--project-id='))) {
  console.error('Uso: node scripts/backfill-commercialapp-receipts.js --project-id=ID [--project-id=ID] [--apply]');
  process.exitCode = 1;
} else {
  try {
    for (const projectId of [...new Set(ids)]) {
      try { console.log(JSON.stringify({ projectId, ...await prepareStoredCommercialReceipt(projectId, { apply }) })); }
      catch (error) {
        const errorCode = /^COMERCIALAPP_[A-Z_0-9]+$/.test(error.code || '') ? error.code : 'COMERCIALAPP_RECEIPT_VERIFICATION_FAILED';
        console.log(JSON.stringify({ projectId, status: 'ERROR', errorCode }));
        process.exitCode = 1;
      }
    }
  } finally { await prisma.$disconnect(); }
}
