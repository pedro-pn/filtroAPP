import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { makeEstoqueSchemas } from '../../../../shared/schemas/estoque.js';
import { getBatchBalances, getItemBalances, getProjectBatchBalances } from './stock-balance.js';

const estoqueSchemas = makeEstoqueSchemas(z);
const ROMANEIO_RETURN_LOT_NUMBER = 'ROMANEIO';

function appError(message, statusCode = 400, extra = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  Object.assign(error, extra);
  return error;
}

function parseDate(value, fieldName) {
  const text = String(value || '').trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? new Date(`${text}T00:00:00.000Z`)
    : new Date(text);
  if (Number.isNaN(date.getTime())) {
    throw appError(`Data inválida em ${fieldName}.`);
  }
  return date;
}

function optionalDate(value, fieldName) {
  const text = String(value || '').trim();
  return text ? parseDate(text, fieldName) : null;
}

function sameDateOnly(a, b) {
  if (!a || !b) return true;
  return new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10);
}

function decimal(value) {
  return new Prisma.Decimal(value);
}

function minDecimal(a, b) {
  return a.lte(b) ? a : b;
}

function stockItemLabel(item) {
  const code = String(item?.code || '').trim();
  const name = String(item?.name || '').trim();
  if (code && name) return `${code} - ${name}`;
  return code || name || 'item de estoque';
}

function isExpired(expiryDate, now = new Date()) {
  if (!expiryDate) return false;
  const expiry = new Date(expiryDate);
  if (Number.isNaN(expiry.getTime())) return false;
  const today = new Date(now.toISOString().slice(0, 10));
  return expiry < today;
}

function movementInclude() {
  return {
    item: true,
    batch: true,
    project: { select: { id: true, code: true, name: true } },
    createdBy: { select: { id: true, name: true } },
    reversedBy: { select: { id: true } }
  };
}

async function itemOrThrow(tx, itemId) {
  const item = await tx.stockItem.findUnique({ where: { id: itemId } });
  if (!item) throw appError('Item de estoque não encontrado.');
  if (!item.isActive) throw appError('Item inativo não aceita movimentações.');
  return item;
}

async function resolvePurchaseBatch(tx, item, data) {
  const lotNumber = item.type === 'FILTRO' ? String(data.lotNumber || '').trim() : String(data.lotNumber || '').trim();
  const expiryDate = optionalDate(data.expiryDate, 'validade');
  if (item.type === 'PRODUTO_QUIMICO') {
    if (!lotNumber) throw appError('Informe o lote do produto químico.');
    if (!expiryDate) throw appError('Informe a validade do produto químico.');
  }

  const existing = await tx.stockBatch.findUnique({
    where: { itemId_lotNumber: { itemId: item.id, lotNumber } }
  });
  if (existing) {
    if (expiryDate && existing.expiryDate && !sameDateOnly(expiryDate, existing.expiryDate)) {
      throw appError('Validade divergente para lote já cadastrado.');
    }
    return existing;
  }

  return tx.stockBatch.create({
    data: {
      itemId: item.id,
      lotNumber,
      expiryDate,
      nfNumber: data.nfNumber,
      supplier: data.supplier
    }
  });
}

async function resolveExistingBatch(tx, item, batchId) {
  const batch = await tx.stockBatch.findUnique({ where: { id: batchId } });
  if (!batch || batch.itemId !== item.id) throw appError('Lote de estoque não encontrado.');
  return batch;
}

function sortBatchesByFefo(a, b) {
  const aExpiry = a.expiryDate ? new Date(a.expiryDate).getTime() : Number.POSITIVE_INFINITY;
  const bExpiry = b.expiryDate ? new Date(b.expiryDate).getTime() : Number.POSITIVE_INFINITY;
  if (aExpiry !== bExpiry) return aExpiry - bExpiry;
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

async function lockBatch(tx, batchId) {
  if (typeof tx.$queryRaw !== 'function') return;
  await tx.$queryRaw`SELECT id FROM "StockBatch" WHERE id = ${batchId} FOR UPDATE`;
}

async function projectOrThrow(tx, projectId) {
  const project = await tx.project.findFirst({
    where: { id: projectId, deletedAt: null, isActive: true },
    select: { id: true }
  });
  if (!project) throw appError('Projeto de destino inválido ou inativo.');
  return project;
}

async function romaneioProjectOrThrow(tx, projectId) {
  const project = await tx.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true }
  });
  if (!project) throw appError('Projeto do romaneio inválido.');
  return project;
}

async function assertBatchBalance(tx, item, batch, quantity) {
  await lockBatch(tx, batch.id);
  const batchBalances = await getBatchBalances(tx, item.id);
  const available = batchBalances.get(batch.id) || decimal(0);
  if (available.minus(quantity).lt(0)) {
    throw appError(
      `Saldo insuficiente no lote para ${stockItemLabel(item)} (solicitado: ${quantity.toFixed(3)} ${item.unitLabel}, disponível: ${available.toFixed(3)} ${item.unitLabel}).`,
      409
    );
  }
  return available;
}

async function assertProjectBatchBalance(tx, item, batch, projectId, quantity) {
  await lockBatch(tx, batch.id);
  const projectBalances = await getProjectBatchBalances(tx, item.id, projectId);
  const available = projectBalances.get(batch.id) || decimal(0);
  if (available.minus(quantity).lt(0)) {
    throw appError(
      `Saldo insuficiente na obra para ${stockItemLabel(item)} (devolução: ${quantity.toFixed(3)} ${item.unitLabel}, disponível: ${available.toFixed(3)} ${item.unitLabel}).`,
      409
    );
  }
  return available;
}

async function createMovementRow(tx, {
  item,
  batch,
  type,
  reason,
  quantity,
  date,
  projectId = null,
  nfNumber = null,
  supplier = null,
  unitCost = null,
  requestedBy = null,
  notes = null,
  excludeFromProjectCost = false,
  reversalOfId = null,
  createdById,
  romaneioId = null
}) {
  return tx.stockMovement.create({
    data: {
      itemId: item.id,
      batchId: batch.id,
      romaneioId,
      type,
      reason,
      quantity: decimal(quantity),
      date,
      projectId,
      nfNumber,
      supplier,
      unitCost: unitCost === null || unitCost === undefined ? null : decimal(unitCost),
      requestedBy,
      notes,
      excludeFromProjectCost,
      reversalOfId,
      createdById
    },
    include: movementInclude()
  });
}

async function movementBalances(tx, itemId, batchId) {
  const [itemBalances, batchBalances] = await Promise.all([
    getItemBalances(tx, [itemId]),
    getBatchBalances(tx, itemId)
  ]);

  return {
    item: itemBalances.get(itemId) || decimal(0),
    batch: batchBalances.get(batchId) || decimal(0)
  };
}

export async function createMovementInTransaction(tx, { data, createdById, romaneioId = null }) {
  if (!createdById) throw appError('Usuário autenticado não identificado.', 401);

  const rawItemId = String(data?.itemId || '').trim();
  const item = await itemOrThrow(tx, rawItemId);
  const parsed = estoqueSchemas.movement({ itemType: item.type }).parse(data);

  const batch = parsed.reason === 'COMPRA'
    ? await resolvePurchaseBatch(tx, item, parsed)
    : await resolveExistingBatch(tx, item, parsed.batchId);
  if (['USO_EM_PROJETO', 'DEVOLUCAO_OBRA'].includes(parsed.reason)) {
    await projectOrThrow(tx, parsed.projectId);
  }
  if (parsed.reason === 'USO_EM_PROJETO') {
    await projectOrThrow(tx, parsed.projectId);
    if (isExpired(batch.expiryDate) && !parsed.confirmExpired) {
      throw appError('Lote vencido. Confirme para registrar a saída.', 422, { requiresConfirmation: true });
    }
  }
  if (parsed.reason === 'DEVOLUCAO_OBRA') {
    await assertProjectBatchBalance(tx, item, batch, parsed.projectId, decimal(parsed.quantity));
  }

  const type = parsed.reason === 'COMPRA' || parsed.reason === 'DEVOLUCAO_OBRA'
    ? 'ENTRADA'
    : parsed.type;
  if (type === 'SAIDA') {
    await assertBatchBalance(tx, item, batch, decimal(parsed.quantity));
  }

  const movement = await createMovementRow(tx, {
    item,
    batch,
    type,
    reason: parsed.reason,
    quantity: parsed.quantity,
    date: parseDate(parsed.date, 'data'),
    projectId: parsed.projectId,
    nfNumber: parsed.nfNumber,
    supplier: parsed.supplier,
    unitCost: parsed.unitCost,
    requestedBy: parsed.requestedBy,
    notes: parsed.notes,
    createdById,
    romaneioId
  });

  return {
    movement,
    balances: await movementBalances(tx, item.id, batch.id)
  };
}

export async function createMovement(client, { data, createdById, romaneioId = null }) {
  return client.$transaction(tx => createMovementInTransaction(tx, { data, createdById, romaneioId }));
}

export async function createReturnMovementsInTransaction(tx, { data, createdById }) {
  if (!createdById) throw appError('Usuário autenticado não identificado.', 401);
  const parsed = estoqueSchemas.returnMovements.parse(data);
  const results = [];

  for (const item of parsed.items) {
    results.push(await createMovementInTransaction(tx, {
      createdById,
      data: {
        reason: 'DEVOLUCAO_OBRA',
        type: 'ENTRADA',
        projectId: parsed.projectId,
        date: parsed.date,
        notes: parsed.notes,
        ...item
      }
    }));
  }

  return results;
}

export async function createReturnMovements(client, { data, createdById }) {
  return client.$transaction(tx => createReturnMovementsInTransaction(tx, { data, createdById }));
}

function automaticQuantityOrThrow(item, value) {
  const text = String(value ?? '').trim().replace(',', '.');
  const [, fraction = ''] = text.split('.');
  if (fraction.length > 3) throw appError('Use no máximo 3 casas decimais.');
  const quantity = decimal(value);
  if (!quantity.gt(0)) throw appError('Informe um valor maior que zero.');
  if (item.type === 'FILTRO' && !quantity.isInteger()) {
    throw appError('Filtros aceitam apenas quantidades inteiras.');
  }
  return quantity;
}

async function fefoBatchesForItem(tx, itemId) {
  const batches = await tx.stockBatch.findMany({ where: { itemId } });
  return [...batches].sort(sortBatchesByFefo);
}

async function allocateFefoBatches(tx, item, quantity) {
  const batches = await fefoBatchesForItem(tx, item.id);
  let remaining = quantity;
  let totalAvailable = decimal(0);
  const allocations = [];

  for (const batch of batches) {
    await lockBatch(tx, batch.id);
    const balances = await getBatchBalances(tx, item.id);
    const available = balances.get(batch.id) || decimal(0);
    if (!available.gt(0)) continue;
    totalAvailable = totalAvailable.plus(available);
    const allocated = minDecimal(available, remaining);
    allocations.push({ batch, quantity: allocated });
    remaining = remaining.minus(allocated);
    if (!remaining.gt(0)) break;
  }

  if (remaining.gt(0)) {
    throw appError(
      `Saldo insuficiente no estoque para ${stockItemLabel(item)} (solicitado: ${quantity.toFixed(3)} ${item.unitLabel}, disponível: ${totalAvailable.toFixed(3)} ${item.unitLabel}).`,
      409
    );
  }

  return allocations;
}

async function resolveRomaneioReturnBatch(tx, item) {
  const batches = await fefoBatchesForItem(tx, item.id);
  if (batches.length) return batches[0];

  const lotNumber = item.type === 'FILTRO' ? '' : ROMANEIO_RETURN_LOT_NUMBER;
  const existing = await tx.stockBatch.findUnique({
    where: { itemId_lotNumber: { itemId: item.id, lotNumber } }
  });
  if (existing) return existing;

  return tx.stockBatch.create({
    data: {
      itemId: item.id,
      lotNumber,
      expiryDate: null,
      nfNumber: null,
      supplier: null
    }
  });
}

export async function createAutomaticRomaneioStockMovementsInTransaction(tx, {
  romaneioType,
  itemId,
  quantity,
  date,
  projectId,
  requestedBy = null,
  notes = null,
  excludeFromProjectCost = false,
  createdById,
  romaneioId
}) {
  if (!createdById) throw appError('Usuário autenticado não identificado.', 401);
  const item = await itemOrThrow(tx, itemId);
  const parsedQuantity = automaticQuantityOrThrow(item, quantity);
  await romaneioProjectOrThrow(tx, projectId);
  const parsedDate = parseDate(date, 'data');

  if (romaneioType === 'OUTBOUND') {
    const movements = [];
    const allocations = await allocateFefoBatches(tx, item, parsedQuantity);
    for (const allocation of allocations) {
      movements.push(await createMovementRow(tx, {
        item,
        batch: allocation.batch,
        type: 'SAIDA',
        reason: 'USO_EM_PROJETO',
        quantity: allocation.quantity,
        date: parsedDate,
        projectId,
        requestedBy,
        notes,
        createdById,
        romaneioId
      }));
    }
    return movements;
  }

  if (romaneioType === 'INBOUND') {
    const batch = await resolveRomaneioReturnBatch(tx, item);
    return [await createMovementRow(tx, {
      item,
      batch,
      type: 'ENTRADA',
      reason: 'DEVOLUCAO_OBRA',
      quantity: parsedQuantity,
      date: parsedDate,
      projectId,
      requestedBy,
      notes,
      excludeFromProjectCost,
      createdById,
      romaneioId
    })];
  }

  throw appError('Tipo de romaneio inválido.');
}

export async function reverseMovementInTransaction(tx, { movementId, notes = null, createdById }) {
  if (!createdById) throw appError('Usuário autenticado não identificado.', 401);

  const original = await tx.stockMovement.findUnique({
    where: { id: movementId },
    include: {
      item: true,
      batch: true,
      reversedBy: { select: { id: true } }
    }
  });
  if (!original) throw appError('Movimentação não encontrada.', 404);
  if (original.reason === 'ESTORNO' || original.reversalOfId) {
    throw appError('Não é possível estornar um estorno.', 409);
  }
  if (original.reversedBy) {
    throw appError('Movimentação já estornada.', 409);
  }

  const type = original.type === 'ENTRADA' ? 'SAIDA' : 'ENTRADA';
  if (type === 'SAIDA') {
    await assertBatchBalance(tx, original.item, original.batch, decimal(original.quantity));
  }

  const movement = await createMovementRow(tx, {
    item: original.item,
    batch: original.batch,
    type,
    reason: 'ESTORNO',
    quantity: original.quantity,
    date: new Date(),
    projectId: original.projectId,
    notes,
    excludeFromProjectCost: original.excludeFromProjectCost,
    reversalOfId: original.id,
    createdById,
    romaneioId: original.romaneioId
  });

  return {
    movement,
    balances: await movementBalances(tx, original.itemId, original.batchId)
  };
}

export async function reverseMovement(client, { movementId, notes = null, createdById }) {
  return client.$transaction(tx => reverseMovementInTransaction(tx, { movementId, notes, createdById }));
}
