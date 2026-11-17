import { serialize, deserialize } from 'node:v8';
import env from '../../config/env.js';
import { projectAccessCacheKey } from '../projects/access-scope.js';
import { createDerivedReadCache, currentDerivedReadVersion } from '../operations/derived-read-cache.js';
import { hasRequestSourceContext } from '../operations/request-sources.js';
import { fitsMonthlySnapshotBudget } from './monthly-snapshot-admission.js';

// Only read requests that verified the transactional source revision may share
// monthly calculations. Serialize trusted in-process values to preserve Dates,
// Maps and aliases, with an independent object graph for every consumer.
const snapshots = createDerivedReadCache({ ttlMs: Math.min(env.dashboardCacheTtlMs, 15000),
  cacheName: 'monthly',
  maxEntries: 8, maxBytes: 8 * 1024 * 1024, maxEntryBytes: 2 * 1024 * 1024,
  encode: serialize, decode: deserialize, admitOwnedValue: fitsMonthlySnapshotBudget });

export async function readMonthlyCostSnapshot(importId, options, loader) {
  const version = currentDerivedReadVersion();
  if (!env.acompanhamentoMonthlyCacheEnabled || !version || !hasRequestSourceContext()) return loader(options);
  // Cost projection and point listing use exactly the same calculation. Load
  // ignored names and workforce annotations once too. A shared snapshot must
  // remain complete even when a financial reader can omit annotations on its
  // uncached path. Remove ignored names for cost readers after decoding.
  const result = await snapshots.get(version, [projectAccessCacheKey(), importId || null],
    () => loader({ includeIgnoredNames: true, includeWorkforceDetails: true }));
  if (options.includeIgnoredNames) return result;
  const { ignoredExternalEmployees: _ignored, ...costs } = result;
  return costs;
}
