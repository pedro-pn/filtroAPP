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

export async function buildOmieCostCategoryWhere({ categoryCode = null, includeAdminOnly = true } = {}) {
  const excludedCodes = await getExcludedAcompanhamentoCostCategoryCodes({ includeAdminOnly });
  const filters = [];
  if (categoryCode) filters.push({ categoriaCodigo: categoryCode });
  const omitted = omitCategoryCodesWhere(excludedCodes);
  if (Object.keys(omitted).length) filters.push(omitted);
  return filters.length ? { AND: filters } : {};
}
