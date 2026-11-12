import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { recordRequestCache, measureRequestCacheStage } from './request-performance.js';

const versions = new AsyncLocalStorage();
const caches = new Set();

// These operational records are not inputs to the cached financial DTOs.
// Authentication/authorization still read sessions before entering this cache.
export const UNTRACKED_READ_CACHE_MODELS = Object.freeze([
  'PerformanceReadRevision', 'JobRun', 'JobLock', 'UserSession', 'ApiRequestLog',
  'ApiUsageBucket', 'DataRetentionRun', 'NotificationRead', 'NotificationPreferenceToken'
]);

export const currentDerivedReadVersion = () => versions.getStore() ?? null;
export const withDerivedReadVersion = (version, callback) => versions.run(version, callback);

// Each writer changes its own marker in the same transaction as the source.
// Hash the complete committed vector, so late commits cannot hide behind a
// newer writer. Operational polling/session traffic does not invalidate data.
// No shared writer row is locked by ordinary source writes.
export async function databaseReadVersion(database) {
  const [row] = await database.$queryRaw`
    SELECT encode(sha256(convert_to(COALESCE(string_agg(id::text || ':' || revision::text, ',' ORDER BY id), ''), 'UTF8')), 'hex') AS revision,
      pg_postmaster_start_time()::text AS server,
      current_database() AS database
    FROM "public"."PerformanceReadRevision"
    HAVING bool_or("writerPid" = 0)
  `;
  if (!row?.revision || !row?.server || !row?.database) throw new Error('Não foi possível verificar a revisão das fontes.');
  return createHash('sha256').update(JSON.stringify([row.database, row.server, row.revision, new Date().toISOString().slice(0, 10)])).digest('hex');
}

// Completed results and running calculations have separate bounds. TTL/LRU
// apply only to completed results, so slow or overlapping reads keep sharing
// their pending calculation. At the pending limit, new keys bypass admission
// without a queue; already admitted work continues to be shared.
export function createDerivedReadCache({ ttlMs = 15000, maxEntries = 32, maxBytes = 16 * 1024 * 1024, maxEntryBytes = 2 * 1024 * 1024,
  maxPendingEntries = 256, cacheName, now = Date.now, encode = JSON.stringify, decode = JSON.parse } = {}) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || !Number.isFinite(ttlMs) || ttlMs < 0
    || !Number.isInteger(maxPendingEntries) || maxPendingEntries < 1
    || !Number.isFinite(maxBytes) || maxBytes < 1 || !Number.isFinite(maxEntryBytes) || maxEntryBytes < 1
    || typeof encode !== 'function' || typeof decode !== 'function') {
    throw new TypeError('Limites de cache de leitura inválidos.');
  }
  const entries = new Map();
  const pending = new Map();
  const record = (field, value) => recordRequestCache(cacheName, field, value);
  let bytes = 0;
  let lastVersion;
  function remove(key) {
    const entry = entries.get(key);
    if (!entry) return;
    bytes -= entry.bytes;
    entries.delete(key);
  }
  function clear() { entries.clear(); pending.clear(); bytes = 0; lastVersion = undefined; }
  async function read(identity, entry) {
    const snapshot = await entry.pending;
    try {
      // Binary decoders may return typed-array views into their input. Give
      // them caller-owned bytes so no returned view can mutate cached storage.
      return await measureRequestCacheStage(cacheName, 'decode', () =>
        decode(Buffer.isBuffer(snapshot) ? Buffer.from(snapshot) : snapshot));
    }
    catch (error) {
      if (entries.get(identity) === entry) remove(identity);
      record('decodeFailed');
      throw error;
    }
  }
  caches.add(clear);
  return {
    clear,
    stats: () => ({ entries: entries.size, bytes, pendingEntries: pending.size }),
    async get(version, key, loader) {
      if (lastVersion !== undefined && lastVersion !== version) record('revisionChanged');
      lastVersion = version;
      const identity = JSON.stringify([version, key]);
      let entry = entries.get(identity);
      if (entry && entry.expiresAt <= now()) { remove(identity); record('expired'); entry = null; }
      if (entry) {
        entries.delete(identity); entries.set(identity, entry);
        record('hit');
        return read(identity, entry);
      }
      entry = pending.get(identity);
      if (entry) { record('shared'); return read(identity, entry); }
      record('miss');
      const admitted = pending.size < maxPendingEntries;
      if (!admitted) record('bypassed');
      entry = { bytes: 0, pending: null };
      entry.pending = Promise.resolve().then(() => versions.run(version, async () => {
        const value = await loader();
        const snapshot = measureRequestCacheStage(cacheName, 'encode', () => encode(value));
        if (typeof snapshot !== 'string' && !Buffer.isBuffer(snapshot)) throw new Error('Resposta de leitura inválida.');
        return snapshot;
      })).then(snapshot => {
        const size = Buffer.byteLength(snapshot);
        record('encodedBytes', size);
        const oversized = size > maxEntryBytes || size > maxBytes;
        if (oversized) record('oversized');
        // A clear or a newer calculation cannot resurrect this result.
        if (pending.get(identity) !== entry) return snapshot;
        pending.delete(identity);
        if (oversized) return snapshot;
        while (entries.size >= maxEntries || bytes + size > maxBytes) {
          remove(entries.keys().next().value); record('evicted');
        }
        entry.bytes = size; bytes += size; entry.expiresAt = now() + ttlMs;
        entries.set(identity, entry);
        return snapshot;
      }, error => {
        if (pending.get(identity) === entry) pending.delete(identity);
        record('loadFailed');
        throw error;
      });
      if (admitted) pending.set(identity, entry);
      return read(identity, entry);
    }
  };
}

export function clearDerivedReadCaches() {
  for (const clear of caches) clear();
}
