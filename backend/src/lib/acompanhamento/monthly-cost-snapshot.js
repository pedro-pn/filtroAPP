import { serialize, deserialize } from 'node:v8';
import env from '../../config/env.js';
import { projectAccessCacheKey } from '../projects/access-scope.js';
import { createDerivedReadCache, currentDerivedReadVersion } from '../operations/derived-read-cache.js';
import { hasRequestSourceContext } from '../operations/request-sources.js';

// Only read requests that verified the transactional source revision may share
// monthly calculations. Serialize trusted in-process values to preserve Dates,
// Maps and aliases, with an independent object graph for every consumer.
const snapshots = createDerivedReadCache({ ttlMs: Math.min(env.dashboardCacheTtlMs, 15000),
  maxEntries: 8, maxBytes: 8 * 1024 * 1024, maxEntryBytes: 2 * 1024 * 1024,
  encode: serialize, decode: deserialize });

export async function readMonthlyCostSnapshot(importId, options, loader) {
  const version = currentDerivedReadVersion();
  if (!version || !hasRequestSourceContext()) return loader(options);
  // Cost projection and point listing use exactly the same calculation. Load
  // ignored names once too, then remove that optional metadata for cost readers.
  const result = await snapshots.get(version, [projectAccessCacheKey(), importId || null],
    () => loader({ includeIgnoredNames: true }));
  if (options.includeIgnoredNames) return result;
  const { ignoredExternalEmployees: _ignored, ...costs } = result;
  return costs;
}
