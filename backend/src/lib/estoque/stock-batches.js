import { Prisma } from '@prisma/client';

import { getBatchBalances, getProjectBatchBalances } from './stock-balance.js';

export async function getAvailableStockBatchRows(client, {
  itemId,
  reason,
  projectId
}) {
  const isProjectReturn = reason === 'DEVOLUCAO_OBRA';
  const [batches, balances] = await Promise.all([
    client.stockBatch.findMany({ where: { itemId } }),
    isProjectReturn
      ? getProjectBatchBalances(client, itemId, projectId)
      : getBatchBalances(client, itemId)
  ]);

  return batches
    .map(batch => ({
      batch,
      balance: balances.get(batch.id) || new Prisma.Decimal(0)
    }))
    .filter(row => row.balance.gt(0))
    .sort((a, b) => {
      const aTime = a.batch.expiryDate ? new Date(a.batch.expiryDate).getTime() : Number.POSITIVE_INFINITY;
      const bTime = b.batch.expiryDate ? new Date(b.batch.expiryDate).getTime() : Number.POSITIVE_INFINITY;
      if (aTime !== bTime) return aTime - bTime;
      return new Date(a.batch.createdAt).getTime() - new Date(b.batch.createdAt).getTime();
    });
}
