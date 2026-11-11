import { AsyncLocalStorage } from 'node:async_hooks';
import { projectAccessCacheKey } from '../projects/access-scope.js';
import { currentDerivedReadVersion } from './derived-read-cache.js';

const sources = new AsyncLocalStorage();

export const hasRequestSourceContext = () => sources.getStore() !== undefined;

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
  // Data loaded before verification, or by another nested source revision,
  // cannot become a source for a newly verified response in this same GET.
  const scopedKey = JSON.stringify([projectAccessCacheKey(), currentDerivedReadVersion(), key]);
  if (!entries.has(scopedKey)) entries.set(scopedKey, Promise.resolve().then(loader));
  return entries.get(scopedKey);
}
