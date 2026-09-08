import prisma from '../prisma.js';
import { buildOmieCostCategoryWhere } from './cost-categories.js';
import { isSedeCostCenterCode, SEDE_COST_CENTERS, SEDE_OMIE_CODES } from './sede-cost-centers.js';

export { SEDE_COST_CENTERS, SEDE_OMIE_CODES } from './sede-cost-centers.js';

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function purchaseDate(row) {
  return row.dataPrevisao ?? row.dataVencimento ?? row.dataEmissao ?? row.syncedAt ?? null;
}

function purchaseCenterCode(row) {
  const osNumber = String(row.osNumber ?? '').trim();
  if (isSedeCostCenterCode(osNumber)) return osNumber;
  const codigoProjeto = String(row.codigoProjeto ?? '').trim();
  return isSedeCostCenterCode(codigoProjeto) ? codigoProjeto : null;
}

function monthKey(date) {
  if (!date) return 'sem-data';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return 'sem-data';
  return d.toISOString().slice(0, 7);
}

function monthLabel(key) {
  if (key === 'sem-data') return 'Sem data';
  const [year, month] = key.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, 1));
  return d.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric', timeZone: 'UTC' }).replace('.', '');
}

function currentMonthKey(now) {
  return monthKey(now);
}

function isPaid(status) {
  return String(status ?? '').trim().toUpperCase() === 'PAGO';
}

function emptyCenter(center) {
  return {
    ...center,
    total: 0,
    paidTotal: 0,
    openTotal: 0,
    currentMonthTotal: 0,
    count: 0,
    lastPurchaseDate: null,
    monthly: [],
    topCategories: []
  };
}

function compareMonthDesc(a, b) {
  if (a.month === 'sem-data') return 1;
  if (b.month === 'sem-data') return -1;
  return b.month.localeCompare(a.month);
}

export function buildSedeCostCards(purchases = [], {
  centers = SEDE_COST_CENTERS,
  now = new Date(),
  monthsLimit = null,
  range = null
} = {}) {
  const currentKey = currentMonthKey(now);
  const availableMonths = new Set();
  const cards = new Map(centers.map(center => [center.code, {
    ...emptyCenter(center),
    monthlyMap: new Map(),
    categoryMap: new Map()
  }]));

  for (const row of purchases) {
    const code = purchaseCenterCode(row);
    const card = cards.get(code);
    if (!card) continue;

    const value = toNumber(row.valor);
    const date = purchaseDate(row);
    const key = monthKey(date);
    if (key !== 'sem-data') availableMonths.add(key);
    if (range && (key === 'sem-data' || key < range.fromMonth || key > range.toMonth)) continue;

    const paid = isPaid(row.statusTitulo);
    const category = row.categoriaDescricao || row.categoriaCodigo || 'Sem categoria';

    card.total += value;
    card.count += 1;
    if (paid) card.paidTotal += value;
    else card.openTotal += value;
    if (key === currentKey) card.currentMonthTotal += value;
    if (date && (!card.lastPurchaseDate || new Date(date) > new Date(card.lastPurchaseDate))) {
      card.lastPurchaseDate = date instanceof Date ? date.toISOString() : new Date(date).toISOString();
    }

    const monthly = card.monthlyMap.get(key) || { month: key, label: monthLabel(key), total: 0, paidTotal: 0, openTotal: 0, count: 0 };
    monthly.total += value;
    monthly.count += 1;
    if (paid) monthly.paidTotal += value;
    else monthly.openTotal += value;
    card.monthlyMap.set(key, monthly);

    const cat = card.categoryMap.get(category) || { categoria: category, total: 0, count: 0 };
    cat.total += value;
    cat.count += 1;
    card.categoryMap.set(category, cat);
  }

  const resultCards = [...cards.values()].map(card => {
    const monthlyItems = [...card.monthlyMap.values()].sort(compareMonthDesc);
    const visibleMonthlyItems = Number.isInteger(monthsLimit) && monthsLimit > 0
      ? monthlyItems.slice(0, monthsLimit)
      : monthlyItems;
    const monthly = visibleMonthlyItems
      .map(item => ({
        ...item,
        total: roundMoney(item.total),
        paidTotal: roundMoney(item.paidTotal),
        openTotal: roundMoney(item.openTotal)
      }));
    const topCategories = [...card.categoryMap.values()]
      .sort((a, b) => b.total - a.total || a.categoria.localeCompare(b.categoria, 'pt-BR'))
      .slice(0, 5)
      .map(item => ({ ...item, total: roundMoney(item.total) }));

    return {
      code: card.code,
      label: card.label,
      shortLabel: card.shortLabel,
      total: roundMoney(card.total),
      paidTotal: roundMoney(card.paidTotal),
      openTotal: roundMoney(card.openTotal),
      currentMonthTotal: roundMoney(card.currentMonthTotal),
      count: card.count,
      lastPurchaseDate: card.lastPurchaseDate,
      monthly,
      topCategories
    };
  });

  const summary = resultCards.reduce((acc, card) => {
    acc.total += card.total;
    acc.paidTotal += card.paidTotal;
    acc.openTotal += card.openTotal;
    acc.currentMonthTotal += card.currentMonthTotal;
    acc.count += card.count;
    return acc;
  }, { total: 0, paidTotal: 0, openTotal: 0, currentMonthTotal: 0, count: 0 });

  return {
    codes: SEDE_OMIE_CODES,
    currentMonth: currentKey,
    currentMonthLabel: monthLabel(currentKey),
    availableMonths: [...availableMonths].sort(),
    summary: {
      total: roundMoney(summary.total),
      paidTotal: roundMoney(summary.paidTotal),
      openTotal: roundMoney(summary.openTotal),
      currentMonthTotal: roundMoney(summary.currentMonthTotal),
      count: summary.count
    },
    cards: resultCards
  };
}

export async function listSedeCosts({ monthsLimit = null, range = null, includeAdminOnlyCategories = true } = {}) {
  const categoryWhere = await buildOmieCostCategoryWhere({
    includeAdminOnly: includeAdminOnlyCategories
  });
  const omieProjects = await prisma.omieProject.findMany({
    where: {
      OR: [
        { osNumber: { in: SEDE_OMIE_CODES } },
        { codigo: { in: SEDE_OMIE_CODES } }
      ]
    },
    select: { codigo: true }
  });
  const internalCodes = omieProjects.map(project => project.codigo);
  const purchases = await prisma.omiePurchase.findMany({
    where: {
      OR: [
        { osNumber: { in: SEDE_OMIE_CODES } },
        { codigoProjeto: { in: [...SEDE_OMIE_CODES, ...internalCodes] } }
      ],
      ...categoryWhere
    },
    select: {
      codigoProjeto: true,
      osNumber: true,
      valor: true,
      statusTitulo: true,
      categoriaCodigo: true,
      categoriaDescricao: true,
      dataEmissao: true,
      dataVencimento: true,
      dataPrevisao: true,
      syncedAt: true
    },
    orderBy: [
      { dataPrevisao: 'desc' },
      { dataVencimento: 'desc' },
      { dataEmissao: 'desc' },
      { syncedAt: 'desc' }
    ]
  });
  return buildSedeCostCards(purchases, { monthsLimit, range });
}
