import { getSalaryCategoryCodes } from './salary.js';
import prisma from '../prisma.js';

export async function getManualCostExcludedCategoryCodes() {
  const categories = await prisma.omieCategory.findMany({
    where: { includeInAcompanhamentoCosts: false },
    select: { codigo: true }
  });
  return categories.map(category => category.codigo);
}

export async function getAdminOnlyCategoryCodes() {
  const categories = await prisma.omieCategory.findMany({
    where: { adminOnly: true },
    select: { codigo: true }
  });
  return categories.map(category => category.codigo);
}

export async function getExcludedAcompanhamentoCostCategoryCodes({ includeAdminOnly = true } = {}) {
  const [salaryCodes, manualCodes, adminOnlyCodes] = await Promise.all([
    getSalaryCategoryCodes(),
    getManualCostExcludedCategoryCodes(),
    includeAdminOnly ? Promise.resolve([]) : getAdminOnlyCategoryCodes()
  ]);
  return Array.from(new Set([...salaryCodes, ...manualCodes, ...adminOnlyCodes].filter(Boolean)));
}

export function omitCategoryCodesWhere(codes = []) {
  return codes.length
    ? { OR: [{ categoriaCodigo: null }, { categoriaCodigo: { notIn: codes } }] }
    : {};
}

function chemicalProductDescriptionWhere(field) {
  return { OR: ['químico', 'quimico'].map(term => ({ [field]: { contains: term, mode: 'insensitive' } })) };
}

async function getChemicalProductCategories() {
  const [categories, purchases] = await Promise.all([
    prisma.omieCategory.findMany({
      where: chemicalProductDescriptionWhere('descricao'),
      select: { codigo: true, descricao: true }
    }),
    prisma.omiePurchase.groupBy({
      by: ['categoriaCodigo', 'categoriaDescricao'],
      where: chemicalProductDescriptionWhere('categoriaDescricao')
    })
  ]);
  const isChemical = description => /\bquimicos?\b/.test(
    String(description ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  );
  const chemicalCategories = categories.filter(category => isChemical(category.descricao));
  const chemicalPurchases = purchases.filter(purchase => isChemical(purchase.categoriaDescricao));
  return {
    codes: [...new Set([
      ...chemicalCategories.map(category => category.codigo),
      ...chemicalPurchases.map(purchase => purchase.categoriaCodigo)
    ].filter(Boolean))],
    descriptions: [...new Set(chemicalPurchases.map(purchase => purchase.categoriaDescricao))]
  };
}

export async function buildOmieCostCategoryWhere({
  categoryCode = null,
  includeAdminOnly = true,
  excludeChemicalProducts = false
} = {}) {
  const [excludedCodes, chemicals] = await Promise.all([
    getExcludedAcompanhamentoCostCategoryCodes({ includeAdminOnly }),
    excludeChemicalProducts ? getChemicalProductCategories() : { codes: [], descriptions: [] }
  ]);
  const filters = [];
  if (categoryCode) filters.push({ categoriaCodigo: categoryCode });
  const omitted = omitCategoryCodesWhere(excludedCodes);
  if (Object.keys(omitted).length) filters.push(omitted);
  const chemicalFilters = [];
  const omittedChemicals = omitCategoryCodesWhere(chemicals.codes);
  if (Object.keys(omittedChemicals).length) chemicalFilters.push(omittedChemicals);
  if (chemicals.descriptions.length) chemicalFilters.push({
    OR: [{ categoriaDescricao: null }, { categoriaDescricao: { notIn: chemicals.descriptions } }]
  });
  if (chemicalFilters.length) filters.push({
    OR: [
      // Sem saída de químicos em romaneio, o projeto ainda usa a despesa do Omie.
      // Verifica a existência da saída, mesmo com custo zero ou devolução integral.
      { project: { stockMovements: { none: {
        type: 'SAIDA',
        reason: 'USO_EM_PROJETO',
        quantity: { gt: 0 },
        item: { type: 'PRODUTO_QUIMICO' },
        romaneio: { type: 'OUTBOUND' },
        reversedBy: null
      } } } },
      { AND: chemicalFilters }
    ]
  });
  return filters.length ? { AND: filters } : {};
}
