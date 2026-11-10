import { AsyncLocalStorage } from 'node:async_hooks';
import { projectAccessCacheKey } from '../projects/access-scope.js';

const sources = new AsyncLocalStorage();

// A read request owns these promises. Nothing is shared with another request,
// write operation, database client or project visibility/channel context.
export function requestSourceContext(req, _res, next) {
  return ['GET', 'HEAD'].includes(req.method) ? sources.run(new WeakMap(), next) : sources.exit(next);
}

export function loadRequestSource(database, key, loader) {
  const context = sources.getStore();
  if (!context) return loader();
  let entries = context.get(database);
  if (!entries) {
    entries = new Map();
    context.set(database, entries);
  }
  const scopedKey = JSON.stringify([projectAccessCacheKey(), key]);
  if (!entries.has(scopedKey)) entries.set(scopedKey, Promise.resolve().then(loader));
  return entries.get(scopedKey);
}
