import { serialize, deserialize } from 'node:v8';
import env from '../../config/env.js';
import { projectAccessCacheKey } from '../projects/access-scope.js';
import { createDerivedReadCache, currentDerivedReadVersion } from '../operations/derived-read-cache.js';
import { hasRequestSourceContext } from '../operations/request-sources.js';

// Share only explicitly selected cost catalogs, after a read verified the
// transactional revision. Never retain resolvers/functions or Prisma clients.
// Different clients (including transactions), channels and visibility scopes
// own different entries. Each caller receives its own values and Dates.
const clients = new WeakMap();
let nextClient = 0;
const snapshots = createDerivedReadCache({ ttlMs: Math.min(env.dashboardCacheTtlMs, 15000),
  cacheName: 'references',
  maxEntries: 16, maxBytes: 4 * 1024 * 1024, maxEntryBytes: 1024 * 1024,
  encode: serialize, decode: deserialize });

export function readVerifiedCostSource(database, key, loader) {
  const version = currentDerivedReadVersion();
  if (!env.acompanhamentoReferenceCacheEnabled || !version || !hasRequestSourceContext()) return loader();
  if (!clients.has(database)) clients.set(database, ++nextClient);
  return snapshots.get(version, [clients.get(database), projectAccessCacheKey(), key], loader);
}
