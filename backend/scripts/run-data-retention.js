import { previewDataRetention, runDataRetention } from '../src/lib/data-retention.js';
import prisma from '../src/lib/prisma.js';

const apply = process.argv.includes('--apply');
const deleteAbandonedDrafts = process.argv.includes('--delete-abandoned-drafts');
const abandonedDraftIds = process.argv
  .filter(arg => arg.startsWith('--delete-abandoned-draft-id='))
  .flatMap(arg => arg.slice('--delete-abandoned-draft-id='.length).split(','))
  .map(id => id.trim())
  .filter(Boolean);
const batchSizeArg = process.argv.find(arg => arg.startsWith('--batch-size='));
const maxBatchesArg = process.argv.find(arg => arg.startsWith('--max-batches-per-target='));
const batchSize = batchSizeArg ? Number(batchSizeArg.slice('--batch-size='.length)) : undefined;
const maxBatchesPerTarget = maxBatchesArg ? Number(maxBatchesArg.slice('--max-batches-per-target='.length)) : undefined;

try {
  if (!apply) {
    const preview = await previewDataRetention();
    console.log(JSON.stringify({
      mode: 'dry-run',
      message: 'Nenhum dado foi alterado. Execute com --apply para aplicar a rotina de retenção.',
      preview
    }, null, 2));
  } else {
    const summary = await runDataRetention({
      deleteAbandonedDrafts,
      abandonedDraftIds,
      ...(Number.isFinite(batchSize) && batchSize > 0 ? { batchSize } : {}),
      ...(Number.isFinite(maxBatchesPerTarget) && maxBatchesPerTarget > 0 ? { maxBatchesPerTarget } : {})
    });
    console.log(JSON.stringify({
      mode: 'apply',
      deleteAbandonedDrafts,
      abandonedDraftIds,
      batchSize: Number.isFinite(batchSize) ? batchSize : undefined,
      maxBatchesPerTarget: Number.isFinite(maxBatchesPerTarget) ? maxBatchesPerTarget : undefined,
      summary
    }, null, 2));
  }
} finally {
  await prisma.$disconnect();
}
