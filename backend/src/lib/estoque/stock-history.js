import { Prisma } from '@prisma/client';

export const ROMANEIO_EDIT_REVERSAL_NOTE_PREFIX = 'Estorno automático por edição do romaneio ';
export const ROMANEIO_EDIT_MOVEMENT_NOTE_PREFIX = 'Correção automática por edição do romaneio ';

function editReversal(row) {
  return Boolean(row?.romaneioId && row.reason === 'ESTORNO' && row.notes?.startsWith(ROMANEIO_EDIT_REVERSAL_NOTE_PREFIX));
}

export async function getStockHistoryMetadata(client, itemIds, { includeReversed = true } = {}) {
  if (!itemIds.length) return new Map();
  // Use Prisma so the same project access scope applies to balances and history.
  // Only product IDs constrain this query: pagination and display filters must
  // never reset a product's running balance.
  const history = await client.stockMovement.findMany({
    where: { itemId: { in: itemIds } },
    select: {
      id: true, itemId: true, type: true, reason: true, quantity: true,
      date: true, createdAt: true, romaneioId: true, notes: true, reversalOfId: true,
      reversedBy: { select: { id: true, reason: true, notes: true, romaneioId: true } }
    },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
  });

  // Older replacements used the same note as initial romaneio movements.
  // A linked product movement created after its first automatic edit reversal
  // belongs to an edit, too. This identifies existing history without rewriting it.
  const firstEditAt = new Map();
  for (const row of history) {
    if (!editReversal(row)) continue;
    const key = `${row.romaneioId}:${row.itemId}`;
    const stamp = new Date(row.createdAt).getTime();
    firstEditAt.set(key, Math.min(firstEditAt.get(key) ?? Infinity, stamp));
  }

  const balances = new Map();
  const metadata = new Map();
  for (const row of history) {
    const active = row.reason !== 'ESTORNO' && !row.reversalOfId && !row.reversedBy;
    if (!includeReversed && !active) continue;
    const previous = balances.get(row.itemId) || new Prisma.Decimal(0);
    const balance = row.type === 'ENTRADA' ? previous.plus(row.quantity) : previous.minus(row.quantity);
    balances.set(row.itemId, balance);
    const firstEdit = firstEditAt.get(`${row.romaneioId}:${row.itemId}`);
    const replacement = row.romaneioId && row.reason !== 'ESTORNO' && !row.reversalOfId
      && (row.notes?.startsWith(ROMANEIO_EDIT_MOVEMENT_NOTE_PREFIX)
        || (firstEdit !== undefined && new Date(row.createdAt).getTime() >= firstEdit));
    metadata.set(row.id, {
      balanceAfter: balance.toFixed(3),
      romaneioEdit: editReversal(row) || Boolean(replacement),
      reversedByRomaneioEdit: editReversal(row.reversedBy)
    });
  }
  return metadata;
}
