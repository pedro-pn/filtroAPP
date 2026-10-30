import { createKeyedTtlCache, createTtlCache } from './ttl-cache.js';
import env from '../config/env.js';
import { isApiWriteSimulation } from './api-credentials/write-context.js';
import { registerCollaboratorCacheInvalidator } from './cache/invalidation.js';
import { projectAccessCacheKey } from './projects/access-scope.js';

function scopedProjectCache(ttl, maxEntries) {
  const cache = createKeyedTtlCache(ttl, maxEntries);
  return {
    get: (key, loader) => cache.get(JSON.stringify([projectAccessCacheKey(), key]), loader),
    clear: () => cache.clear()
  };
}

const MASTER_DATA_TTL_MS = env.resourceListCacheTtlMs;
const DASHBOARD_TTL_MS = env.dashboardCacheTtlMs;

export const collaboratorsCache = createTtlCache(MASTER_DATA_TTL_MS);
export const equipmentCache = createTtlCache(MASTER_DATA_TTL_MS);
export const inhibitionOptionsCache = createTtlCache(MASTER_DATA_TTL_MS);
export const manometersCache = createTtlCache(MASTER_DATA_TTL_MS);
export const particleCountersCache = createTtlCache(MASTER_DATA_TTL_MS);
export const unitsCache = createTtlCache(MASTER_DATA_TTL_MS);
export const unitCategoriesCache = createTtlCache(MASTER_DATA_TTL_MS);
export const companyEquipmentCache = createTtlCache(MASTER_DATA_TTL_MS);
export const equipmentCategoriesCache = createTtlCache(MASTER_DATA_TTL_MS);
export const statisticsProjectsCache = scopedProjectCache(DASHBOARD_TTL_MS);
export const commercialDashboardCache = scopedProjectCache(DASHBOARD_TTL_MS, 50);
export const projectCardsCache = scopedProjectCache(DASHBOARD_TTL_MS, 10);
export const laborCostCache = scopedProjectCache(DASHBOARD_TTL_MS, 10);

export function clearProjectDerivedCaches() {
  if (isApiWriteSimulation()) return;
  statisticsProjectsCache.clear();
  commercialDashboardCache.clear();
  projectCardsCache.clear();
  laborCostCache.clear();
}

export function clearCollaboratorDerivedCaches() {
  collaboratorsCache.clear();
  clearProjectDerivedCaches();
}

registerCollaboratorCacheInvalidator(clearCollaboratorDerivedCaches);

// Caches dos shims de compatibilidade do RDO que agora leem do modelo unificado.
export function clearEquipmentModuleCaches() {
  companyEquipmentCache.clear();
  equipmentCategoriesCache.clear();
  manometersCache.clear();
  particleCountersCache.clear();
  unitsCache.clear();
}

export function clearRomaneioCatalogDependentCaches() {
  unitCategoriesCache.clear();
}
