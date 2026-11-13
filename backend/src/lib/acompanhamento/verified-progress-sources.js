import { serialize, deserialize } from 'node:v8';
import env from '../../config/env.js';
import { projectAccessCacheKey } from '../projects/access-scope.js';
import { hasRequestSourceContext } from '../operations/request-sources.js';
import { createDerivedReadCache, currentDerivedReadVersion } from '../operations/derived-read-cache.js';

const clients = new WeakMap();
let nextClient = 0;
const snapshots = createDerivedReadCache({ ttlMs: Math.min(env.dashboardCacheTtlMs, 15000),
  cacheName: 'progress',
  maxEntries: 8, maxBytes: 8 * 1024 * 1024, maxEntryBytes: 2 * 1024 * 1024,
  encode: serialize, decode: deserialize });

// Cards, individual detail and groups request overlapping project sets. Share
// each project's normalized progress sources, while loading uncached IDs in
// batches through the original protected reader. No unverified/worker sharing.
export function readVerifiedProgressSources(database, projectIds, applyCorrections, loader) {
  const version = currentDerivedReadVersion();
  if (!env.acompanhamentoProgressCacheEnabled || !version || !hasRequestSourceContext()) return loader(projectIds);
  if (!clients.has(database)) clients.set(database, ++nextClient);
  const client = clients.get(database), scope = projectAccessCacheKey();
  const ids = [...new Set(projectIds)];
  let waiting = [], scheduled = false;
  const loadOne = id => new Promise((resolve, reject) => {
    waiting.push({ id, resolve, reject });
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(async () => {
      const batch = waiting;
      waiting = []; scheduled = false;
      try {
        const result = await loader(batch.map(row => row.id));
        for (const row of batch) row.resolve({ present: result.has(row.id), value: result.get(row.id) });
      } catch (error) {
        for (const row of batch) row.reject(error);
      }
    });
  });
  return Promise.all(ids.map(id => snapshots.get(version, [client, scope, applyCorrections, id], () => loadOne(id))))
    .then(rows => new Map(rows.flatMap((row, index) => row.present ? [[ids[index], row.value]] : [])));
}
