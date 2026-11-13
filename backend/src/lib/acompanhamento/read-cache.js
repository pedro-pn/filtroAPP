import env from '../../config/env.js';
import prisma from '../prisma.js';
import { projectAccessCacheKey } from '../projects/access-scope.js';
import { loadRequestSource } from '../operations/request-sources.js';
import { createDerivedReadCache, databaseReadVersion, withDerivedReadVersion } from '../operations/derived-read-cache.js';
import { measureRequestStage } from '../operations/request-performance.js';

const cache = createDerivedReadCache({ ttlMs: Math.min(env.dashboardCacheTtlMs, 15000), cacheName: 'responses' });

// Called after authentication, authorization and query validation. Cached DTOs
// already include the financial projection for this user and read variant.
export function createAcompanhamentoReader({ database = prisma, config = env } = {}) {
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
    return withDerivedReadVersion(version, () => config.acompanhamentoResponseCacheEnabled
      ? cache.get(version, [projectAccessCacheKey(), req.auth.user.id, variant], loader)
      : loader());
  };
}

export const readAcompanhamentoResponse = createAcompanhamentoReader();
