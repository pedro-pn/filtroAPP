import prisma from '../prisma.js';
import { buildOmieCostCategoryWhere } from './cost-categories.js';
import { getEquipmentUsageByProject } from './equipment-usage.js';
import { getStockConsumptionCostByProject } from './stock-cost.js';
import { getManualProjectCostsByProject } from './manual-costs.js';
import { getRoleParamsResolver } from './labor-cost.js';
import { getAnnualCollaboratorCosts } from './settings.js';
import { projectAccessCacheKey } from '../projects/access-scope.js';
import { createReportCostCollaboratorLoader } from './project-detail-collaborators.js';

function partition(rows, projectIds) {
  const byProject = new Map(projectIds.map(id => [id, []]));
  for (const { projectId, ...row } of rows) byProject.get(projectId)?.push(row);
  return byProject;
}

// Request-owned sources only. Project/division responses still assemble their
// own facts, and a subsequent request always re-reads these mutable sources.
export async function loadGroupDetailSources(projectIds, { includeAdminOnlyCategories = true } = {}) {
  const ids = [...new Set(projectIds)];
  const categoryWhere = await buildOmieCostCategoryWhere({
    includeAdminOnly: includeAdminOnlyCategories, excludeChemicalProducts: true
  });
  const where = { projectId: { in: ids }, ...categoryWhere };
  const [costGroups, costStatusGroups, equipmentByProject, stockCosts, manualCostsByProject] = await Promise.all([
    prisma.omiePurchase.groupBy({ by: ['projectId', 'categoriaCodigo', 'categoriaDescricao'], where, _sum: { valor: true } }),
    prisma.omiePurchase.groupBy({ by: ['projectId', 'statusTitulo', 'categoriaCodigo', 'categoriaDescricao'], where, _sum: { valor: true } }),
    getEquipmentUsageByProject(ids),
    getStockConsumptionCostByProject(ids),
    getManualProjectCostsByProject(ids, { includeEntries: true })
  ]);
  let reportCostCatalog, reportCollaborators;
  return {
    projectIds: new Set(ids), categoryWhere, includeAdminOnlyCategories, accessScope: projectAccessCacheKey(),
    costGroupsByProject: partition(costGroups, ids), costStatusGroupsByProject: partition(costStatusGroups, ids),
    equipmentByProject, stockCosts, manualCostsByProject,
    // A catalog for this group's visible, non-deleted rosters only. Loading is
    // lazy so empty groups and progress projections do not read collaborators.
    loadReportCollaborators: () => reportCollaborators ??= prisma.collaborator.findMany({
      where: { reportLinks: { some: { report: { projectId: { in: ids }, deletedAt: null } } } },
      select: { id: true, name: true, jobRole: { select: { name: true } } }
    }).then(rows => new Map(rows.map(row => [row.id, row]))),
    loadReportCostCollaborators: createReportCostCollaboratorLoader(prisma),
    loadReportCostCatalog: () => reportCostCatalog ??= Promise.all([getRoleParamsResolver(), getAnnualCollaboratorCosts()])
  };
}
