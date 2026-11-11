import { Prisma } from '@prisma/client';
import { formatDateOnly } from '../../../../shared/modules/date-only.js';

import {
  createAutomaticRomaneioStockMovementsInTransaction,
  reverseMovementInTransaction
} from '../estoque/stock-movements.js';
import { ROMANEIO_EDIT_MOVEMENT_NOTE_PREFIX, ROMANEIO_EDIT_REVERSAL_NOTE_PREFIX } from '../estoque/stock-history.js';

function stockMovementData(romaneio, authUser) {
  return (romaneio.items || [])
    .filter(item => item.catalogItem?.sourceType === 'STOCK')
    .map(item => ({
      romaneioType: romaneio.type,
      itemId: item.catalogItem.sourceId,
      quantity: item.quantity,
      date: romaneio.romaneioDate,
      projectId: romaneio.projectId,
      requestedBy: String(authUser.name || authUser.email || authUser.username || 'Conta autenticada').trim(),
      notes: `Movimentação automática do romaneio ${romaneio.type === 'OUTBOUND' ? 'saída' : 'entrada'} ${romaneio.id}.`,
      excludeFromProjectCost: romaneio.type === 'INBOUND' && item.isExtra,
      createdById: authUser.id,
      romaneioId: romaneio.id
    }));
}

async function createMovements(tx, data) {
  const movements = [];
  for (const row of data) {
    movements.push(...await createAutomaticRomaneioStockMovementsInTransaction(tx, row));
  }
  return movements;
}

export async function createRomaneioStockMovements(tx, romaneio, authUser) {
  return createMovements(tx, stockMovementData(romaneio, authUser));
}

function movementTotals(rows) {
  const totals = new Map();
  for (const row of rows) {
    const key = JSON.stringify([
      row.itemId,
      row.type,
      row.reason,
      row.projectId,
      formatDateOnly(row.date),
      Boolean(row.excludeFromProjectCost)
    ]);
    totals.set(key, (totals.get(key) || new Prisma.Decimal(0)).plus(row.quantity));
  }
  return totals;
}

function sameMovements(current, desired) {
  const currentTotals = movementTotals(current);
  const desiredTotals = movementTotals(desired);
  return currentTotals.size === desiredTotals.size
    && [...desiredTotals].every(([key, quantity]) => currentTotals.get(key)?.eq(quantity));
}

// The caller must hold the Romaneio row lock until this transaction commits.
export async function syncRomaneioStockMovements(tx, romaneio, authUser) {
  const desired = stockMovementData(romaneio, authUser).map(row => ({
    ...row,
    type: row.romaneioType === 'OUTBOUND' ? 'SAIDA' : 'ENTRADA',
    reason: row.romaneioType === 'OUTBOUND' ? 'USO_EM_PROJETO' : 'DEVOLUCAO_OBRA'
  }));
  const existing = await tx.stockMovement.findMany({
    where: { romaneioId: romaneio.id, reason: { not: 'ESTORNO' } },
    include: { reversedBy: { select: { id: true } } },
    orderBy: { createdAt: 'asc' }
  });
  const active = existing.filter(movement => !movement.reversedBy);
  const itemIds = new Set([...active, ...desired].map(row => row.itemId));
  const changedItemIds = new Set([...itemIds].filter(itemId => !sameMovements(
    active.filter(row => row.itemId === itemId),
    desired.filter(row => row.itemId === itemId)
  )));

  // Keep unchanged items and their original batch allocations, dates and authors.
  for (const movement of active) {
    if (!changedItemIds.has(movement.itemId)) continue;
    await reverseMovementInTransaction(tx, {
      movementId: movement.id,
      notes: `${ROMANEIO_EDIT_REVERSAL_NOTE_PREFIX}${romaneio.id}.`,
      createdById: authUser.id
    });
  }
  return createMovements(tx, desired.filter(row => changedItemIds.has(row.itemId)).map(row => ({
    ...row, notes: `${ROMANEIO_EDIT_MOVEMENT_NOTE_PREFIX}${romaneio.id}.`
  })));
}
