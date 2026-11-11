import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';

const versions = new AsyncLocalStorage();
const caches = new Set();

// These operational records are not inputs to the three cached financial DTOs.
// Authentication/authorization still read sessions before entering this cache.
export const UNTRACKED_READ_CACHE_MODELS = Object.freeze([
  'PerformanceReadRevision', 'JobRun', 'JobLock', 'UserSession', 'ApiRequestLog',
  'ApiUsageBucket', 'DataRetentionRun', 'NotificationRead', 'NotificationPreferenceToken'
]);

export const currentDerivedReadVersion = () => versions.getStore() ?? null;

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

// Module-owned DTO cache: immutable serialized payloads, bounded completed
// bytes and entry count, single-flight, and no cache entry after a failure.
export function createDerivedReadCache({ ttlMs = 15000, maxEntries = 32, maxBytes = 16 * 1024 * 1024, maxEntryBytes = 2 * 1024 * 1024,
  now = Date.now, encode = JSON.stringify, decode = JSON.parse } = {}) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || !Number.isFinite(ttlMs) || ttlMs < 0
    || !Number.isFinite(maxBytes) || maxBytes < 1 || !Number.isFinite(maxEntryBytes) || maxEntryBytes < 1
    || typeof encode !== 'function' || typeof decode !== 'function') {
    throw new TypeError('Limites de cache de leitura inválidos.');
  }
  const entries = new Map();
  let bytes = 0;
  function remove(key) {
    const entry = entries.get(key);
    if (!entry) return;
    bytes -= entry.bytes;
    entries.delete(key);
  }
  function clear() { entries.clear(); bytes = 0; }
  async function read(identity, entry) {
    try {
      const snapshot = await entry.pending;
      // Binary decoders may return typed-array views into their input. Give
      // them caller-owned bytes so no returned view can mutate cached storage.
      return await decode(Buffer.isBuffer(snapshot) ? Buffer.from(snapshot) : snapshot);
    }
    catch (error) {
      if (entries.get(identity) === entry) remove(identity);
      throw error;
    }
  }
  caches.add(clear);
  return {
    clear,
    stats: () => ({ entries: entries.size, bytes }),
    async get(version, key, loader) {
      const identity = JSON.stringify([version, key]);
      let entry = entries.get(identity);
      if (entry && entry.expiresAt <= now()) { remove(identity); entry = null; }
      if (entry) {
        entries.delete(identity); entries.set(identity, entry);
        return read(identity, entry);
      }
      while (entries.size >= maxEntries) remove(entries.keys().next().value);
      entry = { bytes: 0, expiresAt: now() + ttlMs, pending: null };
      entry.pending = Promise.resolve().then(() => versions.run(version, async () => {
        const snapshot = encode(await loader());
        if (typeof snapshot !== 'string' && !Buffer.isBuffer(snapshot)) throw new Error('Resposta de leitura inválida.');
        return snapshot;
      })).then(snapshot => {
        if (entries.get(identity) !== entry) return snapshot;
        const size = Buffer.byteLength(snapshot);
        if (size > maxEntryBytes || size > maxBytes) { remove(identity); return snapshot; }
        entry.bytes = size; bytes += size; entry.expiresAt = now() + ttlMs;
        while (bytes > maxBytes) remove(entries.keys().next().value);
        return snapshot;
      }, error => {
        if (entries.get(identity) === entry) remove(identity);
        throw error;
      });
      entries.set(identity, entry);
      return read(identity, entry);
    }
  };
}

export function clearDerivedReadCaches() {
  for (const clear of caches) clear();
}
