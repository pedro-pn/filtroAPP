export function createTtlCache(ttlMs) {
  let entry = null;

  return {
    async get(loader) {
      const now = Date.now();
      if (entry && entry.expiresAt > now) return entry.value;

      const pending = Promise.resolve().then(loader);
      entry = {
        value: pending,
        expiresAt: now + ttlMs
      };

      try {
        const value = await pending;
        if (entry?.value === pending) {
          entry = {
            value,
            expiresAt: Date.now() + ttlMs
          };
        }
        return value;
      } catch (error) {
        if (entry?.value === pending) entry = null;
        throw error;
      }
    },
    clear() {
      entry = null;
    }
  };
}

export function createKeyedTtlCache(ttlMs, maxEntries = 100) {
  const entries = new Map();

  function prune() {
    while (entries.size > maxEntries) {
      const oldestKey = entries.keys().next().value;
      entries.delete(oldestKey);
    }
  }

  return {
    async get(key, loader) {
      const now = Date.now();
      const cached = entries.get(key);
      if (cached && cached.expiresAt > now) return cached.value;

      const pending = Promise.resolve().then(loader);
      entries.set(key, {
        value: pending,
        expiresAt: now + ttlMs
      });
      prune();

      try {
        const value = await pending;
        if (entries.get(key)?.value === pending) {
          entries.set(key, {
            value,
            expiresAt: Date.now() + ttlMs
          });
          prune();
        }
        return value;
      } catch (error) {
        if (entries.get(key)?.value === pending) entries.delete(key);
        throw error;
      }
    },
    clear(key = null) {
      if (key == null) {
        entries.clear();
        return;
      }
      entries.delete(key);
    }
  };
}
