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

// Observador global de bloqueios (HTTP 429), usado pela detecção de abuso
// (lib/abuse/monitor.js). Fica fora daqui para este módulo não depender do banco.
let rateLimitObserver = null;

export function setRateLimitObserver(observer) {
  rateLimitObserver = typeof observer === 'function' ? observer : null;
}

export function createMemoryRateLimit({
  // Nome do limitador nos alertas de abuso; sem nome, vale a rota.
  name = null,
  windowMs,
  max,
  message,
  keyGenerator = defaultKeyGenerator,
  maxKeys = 1000,
  // Quando true, respostas < 400 devolvem a tentativa ao contador: o limite passa a
  // medir só falhas. Usado nos limites amplos do login (por IP e por usuário) para
  // não bloquear vários colaboradores legítimos atrás do mesmo NAT.
  skipSuccessfulRequests = false
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
      if (rateLimitObserver) {
        try {
          rateLimitObserver({ name: name || routePathKey(req), req });
        } catch {
          // Observação é melhor esforço: o bloqueio vale de qualquer jeito.
        }
      }
      return res.status(429).json({ error: message || 'Muitas tentativas. Tente novamente mais tarde.' });
    }

    if (skipSuccessfulRequests && typeof res.once === 'function') {
      res.once('finish', () => {
        if (res.statusCode < 400 && entry.count > 0) entry.count -= 1;
      });
    }

    next();
  };
}

// Limites das rotas autenticadas que custam caro (pilar 10.1): geração de PDF/DOCX,
// exportações e uploads. Cada categoria tem um limite por usuário e outro por IP,
// com folga para o uso normal (um gestor abrindo dezenas de RDOs seguidos, uma
// equipe inteira atrás do mesmo IP do escritório). A resposta é o mesmo 429 dos
// demais limitadores, e cada bloqueio entra na detecção de abuso.

const TEN_MINUTES = 10 * 60 * 1000;

export const EXPENSIVE_ROUTE_LIMITS = Object.freeze({
  // Baixar/gerar PDF ou DOCX de um documento existente.
  document: { windowMs: TEN_MINUTES, perUser: 120, perIp: 400, message: 'Muitos documentos gerados em sequência. Aguarde alguns minutos e tente novamente.' },
  // Geração pesada: Data Book, regeneração, download em lote, conversão DOCX→PDF.
  generation: { windowMs: TEN_MINUTES, perUser: 20, perIp: 60, message: 'Muitas gerações de documentos em sequência. Aguarde alguns minutos e tente novamente.' },
  // Exportações (CSV/XLSX, exportação de dados).
  export: { windowMs: TEN_MINUTES, perUser: 30, perIp: 100, message: 'Muitas exportações em sequência. Aguarde alguns minutos e tente novamente.' },
  // Uploads (fotos e anexos de RDO, documentos).
  upload: { windowMs: TEN_MINUTES, perUser: 400, perIp: 1200, message: 'Muitos envios de arquivos em sequência. Aguarde alguns minutos e tente novamente.' }
});

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

const cache = new Map();

/**
 * Middlewares [por usuário, por IP] da categoria. Os contadores são compartilhados
 * por todas as rotas da mesma categoria. Use depois do middleware de autenticação.
 */
export function expensiveRouteLimit(category) {
  const config = EXPENSIVE_ROUTE_LIMITS[category];
  if (!config) throw new TypeError(`Categoria de limite desconhecida: ${category}`);
  if (cache.has(category)) return cache.get(category);
  const limiters = [
    createMemoryRateLimit({
      name: `${category}-usuario`,
      windowMs: config.windowMs,
      max: config.perUser,
      message: config.message,
      maxKeys: 10_000,
      keyGenerator: req => `${category}:user:${req.auth?.user?.id || `ip:${clientIp(req)}`}`
    }),
    createMemoryRateLimit({
      name: `${category}-ip`,
      windowMs: config.windowMs,
      max: config.perIp,
      message: config.message,
      maxKeys: 10_000,
      keyGenerator: req => `${category}:ip:${clientIp(req)}`
    })
  ];
  cache.set(category, limiters);
  return limiters;
}
