import env from '../../config/env.js';
import prisma from '../prisma.js';
import { projectAccessCacheKey } from '../projects/access-scope.js';
import { loadRequestSource } from '../operations/request-sources.js';
import { createDerivedReadCache, databaseReadVersion } from '../operations/derived-read-cache.js';

const cache = createDerivedReadCache({ ttlMs: Math.min(env.dashboardCacheTtlMs, 15000) });

// Called after authentication, authorization and query validation. Cached DTOs
// already include the financial projection for this user and read variant.
export async function readAcompanhamentoResponse(req, variant, loader) {
  if (!env.acompanhamentoReadCacheEnabled) return loader();
  let version;
  try {
    version = await loadRequestSource(prisma, 'acompanhamento.database-version', () => databaseReadVersion(prisma));
  } catch (cause) {
    const error = new Error('Não foi possível verificar a atualização dos dados. Tente novamente.', { cause });
    error.status = 503;
    throw error;
  }
  return cache.get(version, [projectAccessCacheKey(), req.auth.user.id, variant], loader);
}
