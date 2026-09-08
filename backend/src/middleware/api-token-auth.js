import env from '../config/env.js';
import asyncHandler from '../lib/async-handler.js';
import { getApiOperation } from '../lib/api-credentials/catalog.js';
import { recordApiRequest } from '../lib/api-credentials/audit.js';
import { createPrismaQuotaStore, reserveCredentialQuota, settleCredentialQuota } from '../lib/api-credentials/quota.js';
import { isIpAllowed, resolveEffectiveClientIp } from '../lib/api-credentials/restrictions.js';
import { parseApiToken, verifyApiToken } from '../lib/api-credentials/token.js';
import prisma from '../lib/prisma.js';
import { sendIntegrationError } from './api-request-context.js';

function bearerValue(header) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ') || header.length > 256) return '';
  const value = header.slice(7);
  return value && value.trim() === value && !/\s/.test(value) ? value : '';
}

function credentialIsUsable(credential, now) {
  if (!credential) return false;
  if (credential.startsAt > now) return false;
  if (credential.expiresAt && credential.expiresAt <= now) return false;
  if (credential.revokedAt && credential.revokedAt <= now) return false;
  if (credential.overlapEndsAt && credential.overlapEndsAt <= now) return false;
  return true;
}

export function createCoarseIpLimiter({ max = 300, windowMs = 60_000 } = {}) {
  const hits = new Map();
  return function coarseIpLimiter(req, res, next) {
    const now = Date.now();
    const ip = resolveEffectiveClientIp(req) || 'unknown';
    const prior = hits.get(ip);
    const item = prior && prior.resetAt > now ? prior : { count: 0, resetAt: now + windowMs };
    item.count += 1;
    hits.set(ip, item);
    if (hits.size > 5000) {
      for (const [key, value] of hits) if (value.resetAt <= now) hits.delete(key);
    }
    while (hits.size > 10_000) hits.delete(hits.keys().next().value);
    if (item.count > max) {
      return sendIntegrationError(res, req, 429, 'RATE_LIMITED', 'Muitas requisições para esta origem.', {
        retryAfterSeconds: Math.max(1, Math.ceil((item.resetAt - now) / 1000))
      });
    }
    next();
  };
}

export function createApiTokenAuthenticator({ prismaClient = prisma, envConfig = env, now = () => new Date() } = {}) {
  return asyncHandler(async (req, res, next) => {
    const rawToken = bearerValue(req.headers?.authorization);
    const parsed = parseApiToken(rawToken);
    const credential = parsed
      ? await prismaClient.apiCredential.findUnique({
        where: { selector: parsed.selector },
        include: {
          scopes: { where: { revokedAt: null }, select: { scopeCode: true } },
          projects: { where: { revokedAt: null }, select: { projectId: true } }
        }
      })
      : null;
    const keyResolver = version => envConfig.apiTokenHashKeys?.[version] || '';
    const verified = verifyApiToken({ rawToken, credential, keyResolver });
    if (!verified || !credentialIsUsable(credential, now())) {
      return sendIntegrationError(res, req, 401, 'INVALID_TOKEN', 'Credencial de integração inválida.');
    }

    const clientIp = resolveEffectiveClientIp(req);
    if (!isIpAllowed(clientIp, credential.allowedIpCidrs)) {
      return sendIntegrationError(res, req, 403, 'IP_NOT_ALLOWED', 'A origem desta requisição não está autorizada.');
    }
    req.apiAuth = {
      credential,
      credentialId: credential.id,
      clientIp,
      scopeCodes: new Set(credential.scopes.map(item => item.scopeCode)),
      projectIds: new Set(credential.projects.map(item => item.projectId))
    };
    next();
  });
}

export function requireApiOperation(operationId) {
  const operation = getApiOperation(operationId);
  if (!operation) throw new Error(`Operação de integração desconhecida: ${operationId}.`);
  return function operationAuthorization(req, res, next) {
    const granted = req.apiAuth?.scopeCodes || new Set();
    const missing = operation.requiredScopes.filter(scope => !granted.has(scope));
    if (req.query?.includeDeleted === 'true' && !granted.has('qualidade.excluidos.read')) {
      missing.push('qualidade.excluidos.read');
    }
    if (missing.length) {
      return sendIntegrationError(res, req, 403, 'INSUFFICIENT_SCOPE', 'A credencial não possui o escopo necessário.');
    }
    req.apiOperation = operation;
    next();
  };
}

export const coarseApiTokenIpLimit = createCoarseIpLimiter({ max: env.apiTokenCoarseIpRequestsPerMinute });
export const requireApiToken = createApiTokenAuthenticator();

export async function runMeteredApiOperation(req, {
  prismaClient = prisma,
  operationId,
  requestedRows = 0,
  filterSummary = {},
  execute
}) {
  const operation = getApiOperation(operationId);
  if (!operation || !req.apiAuth?.credential) throw new Error('Contexto de operação inválido.');
  const credential = req.apiAuth.credential;
  const limits = {
    requestsPerMinute: credential.requestsPerMinute,
    requestsPerDay: credential.requestsPerDay,
    rowsPerDay: credential.rowsPerDay
  };
  const store = createPrismaQuotaStore(prismaClient);
  let reservation = null;
  let settled = false;
  const startedAt = process.hrtime.bigint();
  let statusCode = 500;
  let outcomeCode = 'INTERNAL_ERROR';
  try {
    reservation = await reserveCredentialQuota({
      store,
      credentialId: credential.id,
      limits,
      requestedRows
    });
    const result = await execute();
    statusCode = result.statusCode || 200;
    outcomeCode = result.outcomeCode || 'OK';
    const rows = Math.max(0, Number(result.rows) || 0);
    const bytes = result.bytes !== undefined && Number.isFinite(Number(result.bytes))
      ? Math.max(0, Number(result.bytes)) : Buffer.byteLength(JSON.stringify(result.body ?? ''));
    await settleCredentialQuota({ store, reservation, actualRows: rows, responseBytes: bytes });
    settled = true;
    await recordApiRequest(prismaClient, {
      credentialId: credential.id,
      requestId: req.requestId,
      operationId,
      scopeCode: operation.requiredScopes[0],
      pathTemplate: operation.path,
      statusCode,
      outcomeCode,
      responseRows: rows,
      responseBytes: bytes,
      durationMs: Number((process.hrtime.bigint() - startedAt) / 1_000_000n),
      clientIp: req.apiAuth.clientIp,
      userAgent: req.headers?.['user-agent'],
      filterSummary
    });
    return result;
  } catch (error) {
    statusCode = error?.statusCode || 500;
    outcomeCode = error?.code || 'INTERNAL_ERROR';
    if (reservation && !settled) {
      try { await settleCredentialQuota({ store, reservation, actualRows: 0, responseBytes: 0 }); } catch { /* preserva o erro original */ }
    }
    try {
      await recordApiRequest(prismaClient, {
        credentialId: credential.id,
        requestId: req.requestId,
        operationId,
        scopeCode: operation.requiredScopes[0],
        pathTemplate: operation.path,
        statusCode,
        outcomeCode,
        responseRows: 0,
        responseBytes: 0,
        durationMs: Number((process.hrtime.bigint() - startedAt) / 1_000_000n),
        clientIp: req.apiAuth.clientIp,
        userAgent: req.headers?.['user-agent'],
        filterSummary
      });
    } catch { /* observabilidade não substitui a falha original */ }
    throw error;
  }
}
