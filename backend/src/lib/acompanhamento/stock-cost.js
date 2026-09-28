import prisma from '../prisma.js';
import { divisionDateWhere } from './tracking-divisions.js';

const PROJECT_STOCK_REASONS = ['USO_EM_PROJETO', 'DEVOLUCAO_OBRA', 'ESTORNO'];

const STOCK_CATEGORY_LABELS = {
  FILTRO: 'Filtros (estoque)',
  PRODUTO_QUIMICO: 'Produtos químicos (estoque)'
};

function toNum(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const n = Number(value.toString());
  return Number.isFinite(n) ? n : null;
}

function roundMoney(value) {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return Math.abs(rounded) < 0.005 ? 0 : rounded;
}

function stockCategoryLabel(itemType) {
  return STOCK_CATEGORY_LABELS[itemType] || 'Estoque (químicos/filtros)';
}

export function buildBatchUnitCostMap(purchaseMovements = []) {
  const byBatch = new Map();
  for (const movement of purchaseMovements) {
    if (!movement?.batchId || movement.reversedBy) continue;
    const quantity = toNum(movement.quantity);
    const unitCost = toNum(movement.unitCost);
    if (!quantity || quantity <= 0 || unitCost === null) continue;

    const acc = byBatch.get(movement.batchId) || { quantity: 0, total: 0 };
    acc.quantity += quantity;
    acc.total += quantity * unitCost;
    byBatch.set(movement.batchId, acc);
  }

  const out = new Map();
  for (const [batchId, acc] of byBatch.entries()) {
    if (acc.quantity > 0) out.set(batchId, roundMoney(acc.total / acc.quantity));
  }
  return out;
}

export function aggregateStockConsumptionMovements(movements = [], unitCostByBatch = new Map()) {
  const rawByProject = new Map();

  for (const movement of movements) {
    if (!movement?.projectId || !PROJECT_STOCK_REASONS.includes(movement.reason)) continue;
    if (movement.excludeFromProjectCost) continue;
    const quantity = toNum(movement.quantity);
    if (!quantity || quantity <= 0) continue;
    const ownUnitCost = toNum(movement.unitCost);
    const batchUnitCost = toNum(unitCostByBatch.get(movement.batchId));
    const unitCost = ownUnitCost ?? batchUnitCost ?? 0;
    const sign = movement.type === 'SAIDA' ? 1 : movement.type === 'ENTRADA' ? -1 : 0;
    if (sign === 0) continue;

    const amount = sign * quantity * unitCost;
    const category = stockCategoryLabel(movement.item?.type);
    const project = rawByProject.get(movement.projectId) || { total: 0, categories: new Map() };
    project.total += amount;
    project.categories.set(category, (project.categories.get(category) || 0) + amount);
    rawByProject.set(movement.projectId, project);
  }

  const normalized = new Map();
  for (const [projectId, project] of rawByProject.entries()) {
    const categories = [...project.categories.entries()]
      .map(([categoria, total]) => ({ categoria, total: roundMoney(total) }))
      .filter(item => item.total > 0)
      .sort((a, b) => b.total - a.total || a.categoria.localeCompare(b.categoria, 'pt-BR'));
    const total = roundMoney(categories.reduce((sum, item) => sum + item.total, 0));
    normalized.set(projectId, { total, categories });
  }

  return normalized;
}

export async function getStockConsumptionCostByProject(projectIds = null, client = prisma, division = null) {
  if (Array.isArray(projectIds) && projectIds.length === 0) return new Map();

  const movements = await client.stockMovement.findMany({
    where: {
      projectId: Array.isArray(projectIds) ? { in: projectIds } : { not: null },
      ...divisionDateWhere('date', division),
      reason: { in: PROJECT_STOCK_REASONS }
    },
    select: {
      projectId: true,
      batchId: true,
      type: true,
      reason: true,
      quantity: true,
      unitCost: true,
      excludeFromProjectCost: true,
      item: { select: { type: true } }
    }
  });
  if (movements.length === 0) return new Map();

  const batchIds = [...new Set(movements.map(movement => movement.batchId).filter(Boolean))];
  const purchaseMovements = batchIds.length
    ? await client.stockMovement.findMany({
      where: {
        batchId: { in: batchIds },
        type: 'ENTRADA',
        reason: 'COMPRA',
        unitCost: { not: null }
      },
      select: {
        batchId: true,
        quantity: true,
        unitCost: true,
        reversedBy: { select: { id: true } }
      }
    })
    : [];

  return aggregateStockConsumptionMovements(movements, buildBatchUnitCostMap(purchaseMovements));
}
