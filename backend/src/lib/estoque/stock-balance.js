import { Prisma } from '@prisma/client';

function zero() {
  return new Prisma.Decimal(0);
}

function addSignedBalance(balances, key, type, quantity, positiveType = 'ENTRADA') {
  if (!key || quantity === null || quantity === undefined) return;
  const current = balances.get(key) || zero();
  const amount = new Prisma.Decimal(quantity);
  balances.set(key, type === positiveType ? current.plus(amount) : current.minus(amount));
}

function itemWhere(itemIds) {
  return Array.isArray(itemIds) && itemIds.length ? { itemId: { in: itemIds } } : {};
}

export async function getItemBalances(prismaOrTx, itemIds) {
  const rows = await prismaOrTx.stockMovement.groupBy({
    by: ['itemId', 'type'],
    where: itemWhere(itemIds),
    _sum: { quantity: true }
  });

  const balances = new Map();
  for (const row of rows) {
    addSignedBalance(balances, row.itemId, row.type, row._sum.quantity);
  }
  return balances;
}

export async function getBatchBalances(prismaOrTx, itemId) {
  const rows = await prismaOrTx.stockMovement.groupBy({
    by: ['batchId', 'type'],
    where: { itemId },
    _sum: { quantity: true }
  });

  const balances = new Map();
  for (const row of rows) {
    addSignedBalance(balances, row.batchId, row.type, row._sum.quantity);
  }
  return balances;
}

export async function getProjectBatchBalances(prismaOrTx, itemId, projectId) {
  if (!projectId) return new Map();

  const rows = await prismaOrTx.stockMovement.groupBy({
    by: ['batchId', 'type'],
    where: { itemId, projectId },
    _sum: { quantity: true }
  });

  const balances = new Map();
  for (const row of rows) {
    addSignedBalance(balances, row.batchId, row.type, row._sum.quantity, 'SAIDA');
  }
  return balances;
}

export function decimalBalanceString(value, fractionDigits = 3) {
  const decimal = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value || 0);
  return decimal.toFixed(fractionDigits);
}
