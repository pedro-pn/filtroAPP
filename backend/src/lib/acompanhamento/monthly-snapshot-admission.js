// Conservative admission check for the trusted calculation DTO. Stop at a byte,
// visit or depth budget before creating a full V8 buffer. False means "do not
// cache", not "invalid data": the caller-owned result must remain unchanged.
export function fitsMonthlySnapshotBudget(value, maxBytes, { maxVisits = 50000, maxDepth = 64 } = {}) {
  if (!Number.isFinite(maxBytes) || maxBytes < 1) return false;
  let remaining = maxBytes, visits = maxVisits;
  const seen = new WeakSet();
  const consume = bytes => (remaining -= bytes) >= 0;
  const text = value => consume(8 + value.length * 2);
  function visit(item, depth) {
    if (--visits < 0 || depth > maxDepth || !consume(8)) return false;
    if (item == null || typeof item === 'boolean' || typeof item === 'number') return true;
    if (typeof item === 'string') return text(item);
    if (typeof item !== 'object') return false;
    if (seen.has(item)) return true;
    seen.add(item);
    if (!consume(32)) return false;
    if (item instanceof Date) return true;
    if (ArrayBuffer.isView(item) || item instanceof ArrayBuffer) return consume(item.byteLength);
    if (item instanceof Map) {
      for (const [key, value] of Map.prototype.entries.call(item)) {
        if (!visit(key, depth + 1) || !visit(value, depth + 1)) return false;
      }
      return true;
    }
    if (item instanceof Set) {
      for (const value of Set.prototype.values.call(item)) if (!visit(value, depth + 1)) return false;
      return true;
    }
    const array = Array.isArray(item);
    if (array) {
      if (!consume(item.length * 8)) return false;
    } else if (![Object.prototype, null].includes(Object.getPrototypeOf(item))) return false;
    for (const key in item) {
      if (!Object.hasOwn(item, key)) continue;
      if (!text(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !visit(descriptor.value, depth + 1)) return false;
    }
    return true;
  }
  try { return visit(value, 0); }
  catch { return false; }
}
