import env from '../../config/env.js';
import prisma from '../prisma.js';
import { projectAccessCacheKey } from '../projects/access-scope.js';
import { loadRequestSource } from '../operations/request-sources.js';
import { createDerivedReadCache, databaseReadVersion, withDerivedReadVersion } from '../operations/derived-read-cache.js';
import { measureRequestStage, measureRequestCacheStage } from '../operations/request-performance.js';

// A cached response is immutable JSON already projected for this user. HTTP
// consumers can send those bytes directly; object consumers still get a fresh
// DTO. Never let a mutable object or Buffer expose the cached storage.
class SerializedJsonResponse {
  constructor(body) { this.body = body; }
  value() { return measureRequestCacheStage('responses', 'decode', () => JSON.parse(this.body)); }
}

const cache = createDerivedReadCache({ ttlMs: Math.min(env.dashboardCacheTtlMs, 15000), cacheName: 'responses',
  decode: body => new SerializedJsonResponse(body) });

// Called after authentication, authorization and query validation. Cached DTOs
// already include the financial projection for this user and read variant.
export function createAcompanhamentoReader({ database = prisma, config = env, serializedResponses = false } = {}) {
  return async function readAcompanhamentoResponse(req, variant, loader) {
    if (!config.acompanhamentoReadCacheEnabled || ![
      config.acompanhamentoResponseCacheEnabled, config.acompanhamentoMonthlyCacheEnabled,
      config.acompanhamentoReferenceCacheEnabled, config.acompanhamentoProgressCacheEnabled
    ].some(Boolean)) return loader();
    let version;
    try {
      version = await loadRequestSource(database, 'acompanhamento.database-version', () =>
        measureRequestStage('cache.verify', () => databaseReadVersion(database)));
    } catch (cause) {
      const error = new Error('Não foi possível verificar a atualização dos dados. Tente novamente.', { cause });
      error.status = 503;
      throw error;
    }
    const response = await withDerivedReadVersion(version, () => config.acompanhamentoResponseCacheEnabled
      ? cache.get(version, [projectAccessCacheKey(), req.auth.user.id, variant], loader)
      : loader());
    return response instanceof SerializedJsonResponse && !serializedResponses ? response.value() : response;
  };
}

export const readAcompanhamentoResponse = createAcompanhamentoReader();

export function createAcompanhamentoResponder(options = {}) {
  const read = createAcompanhamentoReader({ ...options, serializedResponses: true });
  return async function sendAcompanhamentoResponse(req, res, variant, loader) {
    const response = await read(req, variant, loader);
    if (response instanceof SerializedJsonResponse) {
      // Preserve Express JSON formatting/escaping/replacers if an application
      // customizes them. res.send keeps Content-Type/length, ETag, HEAD and 304
      // handling identical to the normal res.json -> res.send path.
      const app = res.app ?? req.app;
      const customJson = ['json replacer', 'json spaces', 'json escape'].some(key => app?.get(key) !== undefined);
      if (!customJson) return measureRequestStage('http.serialize', () => {
        if (!res.getHeader('Content-Type')) res.type('application/json');
        return res.send(response.body);
      });
      return res.json(response.value());
    }
    return res.json(response);
  };
}

export const sendAcompanhamentoResponse = createAcompanhamentoResponder();
