function routePathKey(req) {
  const routePath = req.route?.path;
  if (routePath) {
    const normalizedRoute = Array.isArray(routePath)
      ? routePath.join('|')
      : String(routePath);
    return `${req.baseUrl || ''}${normalizedRoute}`;
  }
  return req.path || String(req.url || '').split('?')[0] || 'unknown-route';
}

function defaultKeyGenerator(req) {
  return `${req.ip || req.socket?.remoteAddress || 'unknown'}:${routePathKey(req)}`;
}

function evictExpired(hits, now) {
  for (const [itemKey, value] of hits.entries()) {
    if (value.resetAt <= now) hits.delete(itemKey);
  }
}

function evictOldest(hits, maxKeys) {
  while (hits.size > maxKeys) {
    const oldestKey = hits.keys().next().value;
    if (oldestKey === undefined) return;
    hits.delete(oldestKey);
  }
}

export function createMemoryRateLimit({
  windowMs,
  max,
  message,
  keyGenerator = defaultKeyGenerator,
  maxKeys = 1000
}) {
  const hits = new Map();
  const cappedMaxKeys = Number.isFinite(maxKeys) && maxKeys > 0 ? maxKeys : 1000;

  return function memoryRateLimit(req, res, next) {
    const now = Date.now();
    const key = keyGenerator(req);
    const current = hits.get(key);
    const entry = current && current.resetAt > now
      ? current
      : { count: 0, resetAt: now + windowMs };

    entry.count += 1;
    hits.set(key, entry);

    if (hits.size > cappedMaxKeys) {
      evictExpired(hits, now);
      evictOldest(hits, cappedMaxKeys);
    }

    if (entry.count > max) {
      return res.status(429).json({ error: message || 'Muitas tentativas. Tente novamente mais tarde.' });
    }

    next();
  };
}
