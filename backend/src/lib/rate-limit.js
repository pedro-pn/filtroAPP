export function createMemoryRateLimit({ windowMs, max, message }) {
  const hits = new Map();

  return function memoryRateLimit(req, res, next) {
    const now = Date.now();
    const key = `${req.ip || req.socket?.remoteAddress || 'unknown'}:${req.originalUrl || req.url}`;
    const current = hits.get(key);
    const entry = current && current.resetAt > now
      ? current
      : { count: 0, resetAt: now + windowMs };

    entry.count += 1;
    hits.set(key, entry);

    if (entry.count > max) {
      return res.status(429).json({ error: message || 'Muitas tentativas. Tente novamente mais tarde.' });
    }

    if (hits.size > 1000) {
      for (const [itemKey, value] of hits.entries()) {
        if (value.resetAt <= now) hits.delete(itemKey);
      }
    }

    next();
  };
}
