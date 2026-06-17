import { createKeyedTtlCache, createTtlCache } from './ttl-cache.js';
import env from '../config/env.js';

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
export const statisticsProjectsCache = createKeyedTtlCache(DASHBOARD_TTL_MS);

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
