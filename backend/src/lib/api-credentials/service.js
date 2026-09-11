import { z } from 'zod';

import { makeApiCredentialSchemas, NEVER_EXPIRES_CONFIRMATION } from '../../../../shared/schemas/api-credentials.js';
import env from '../../config/env.js';
import { getApiScope } from './catalog.js';
import { assertPolicyReduction } from './authorization.js';
import { normalizeCidrs } from './restrictions.js';
import { createApiToken, serializeCredentialPublic } from './token.js';
import { sanitizeAdminEvent } from './audit.js';

export const credentialInclude = {
  scopes: true,
  projects: true,
  createdBy: { select: { id: true, name: true } },
  replacement: { select: { id: true } },
  usageBuckets: { where: { windowKind: 'DAY' }, orderBy: { windowStart: 'desc' }, take: 1 }
};

export class ApiCredentialServiceError extends Error {
  constructor(statusCode, code, message, extra = {}) {
    super(message);
    this.name = 'ApiCredentialServiceError';
    this.statusCode = statusCode;
    this.code = code;
    Object.assign(this, extra);
  }
}

const IDEMPOTENCY_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertIdempotencyKey(value) {
  if (!IDEMPOTENCY_KEY_PATTERN.test(value || '')) {
    throw new ApiCredentialServiceError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Informe uma Idempotency-Key UUID válida.');
  }
}

export function effectiveCredentialStatus(credential, now = new Date(), nearExpiryDays = 7) {
  const point = new Date(now);
  if ((credential.revokedAt && new Date(credential.revokedAt) <= point)
    || (credential.overlapEndsAt && new Date(credential.overlapEndsAt) <= point)) return 'REVOKED';
  if (credential.expiresAt && new Date(credential.expiresAt) <= point) return 'EXPIRED';
  if (new Date(credential.startsAt) > point) return 'SCHEDULED';
  if (credential.expiresAt && new Date(credential.expiresAt).getTime() - point.getTime() <= nearExpiryDays * 86400000) return 'NEAR_EXPIRY';
  return 'ACTIVE';
}

function iso(value) {
  return value ? new Date(value).toISOString() : null;
}

export function publicCredential(credential, { now = new Date() } = {}) {
  const base = serializeCredentialPublic(credential);
  return {
    id: base.id,
    name: base.name,
    purpose: base.purpose,
    recipientName: base.recipientName,
    recipientContact: base.recipientContact ?? null,
    description: base.description ?? null,
    displayToken: `fva_${credential.selector.slice(0, 4)}_••••${credential.secretLastFour}`,
    effectiveStatus: effectiveCredentialStatus(credential, now),
    startsAt: iso(base.startsAt),
    expiresAt: iso(base.expiresAt),
    revokedAt: iso(base.revokedAt),
    revocationReason: base.revocationReason ?? null,
    scopeCodes: (base.scopes || []).filter(item => !item.revokedAt).map(item => item.scopeCode).sort(),
    projectAccess: {
      mode: base.projectAccessMode,
      projectIds: (base.projects || []).filter(item => !item.revokedAt).map(item => item.projectId).sort()
    },
    allowedIpCidrs: base.allowedIpCidrs || [],
    allowedFormats: base.allowedFormats || ['JSON'],
    limits: {
      requestsPerMinute: base.requestsPerMinute,
      requestsPerDay: base.requestsPerDay,
      rowsPerDay: base.rowsPerDay,
      maxPageSize: base.maxPageSize
    },
    lastUsedAt: iso(base.lastUsedAt),
    recentUsage: base.usageBuckets?.[0] ? {
      windowStart: iso(base.usageBuckets[0].windowStart),
      requests: base.usageBuckets[0].requests,
      rows: base.usageBuckets[0].rows,
      bytes: Number(base.usageBuckets[0].bytes)
    } : null,
    rotatedFromId: base.rotatedFromId ?? null,
    replacementId: base.replacement?.id ?? null,
    overlapEndsAt: iso(base.overlapEndsAt),
    version: base.version,
    createdBy: base.createdBy || null,
    createdAt: iso(base.createdAt),
    updatedAt: iso(base.updatedAt)
  };
}

export function validateScopeSelection(scopeCodes) {
  const selected = new Set(scopeCodes);
  for (const code of selected) {
    const definition = getApiScope(code);
    if (!definition || definition.status !== 'AVAILABLE') {
      throw new ApiCredentialServiceError(400, 'UNKNOWN_SCOPE', `Escopo indisponível: ${code}.`);
    }
    const missing = definition.dependencies.filter(item => !selected.has(item));
    if (missing.length) {
      throw new ApiCredentialServiceError(400, 'SCOPE_DEPENDENCY_REQUIRED', `O escopo ${code} exige: ${missing.join(', ')}.`);
    }
  }
}

function parseCreateInput(input, globalMaxPageSize) {
  const schemas = makeApiCredentialSchemas(z, { globalMaxPageSize });
  return schemas.create.parse(input);
}

function cursorFromRow(row) {
  return Buffer.from(JSON.stringify({ createdAt: iso(row.createdAt), id: row.id })).toString('base64url');
}

export function validateCredentialId(id) {
  return z.string().trim().min(1).max(100).parse(id);
}

export function parseAdminCursor(cursor) {
  if (cursor === undefined) return undefined;
  try {
    const encoded = z.string().min(1).max(2048).regex(/^[A-Za-z0-9_-]+$/).parse(cursor);
    return z.object({ createdAt: z.string().datetime({ offset: true }), id: z.string().trim().min(1).max(100) }).strict()
      .parse(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')));
  } catch {
    throw new ApiCredentialServiceError(400, 'INVALID_CURSOR', 'Cursor inválido.');
  }
}

function cursorWhere(cursor) {
  const parsed = parseAdminCursor(cursor);
  if (!parsed) return undefined;
  const createdAt = new Date(parsed.createdAt);
  return { OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: parsed.id } }] };
}

function usableCredentialWhere(point) {
  return {
    AND: [
      { OR: [{ revokedAt: null }, { revokedAt: { gt: point } }] },
      { OR: [{ overlapEndsAt: null }, { overlapEndsAt: { gt: point } }] }
    ]
  };
}

export function credentialStatusWhere(status, now = new Date(), nearExpiryDays = 7) {
  if (!status) return undefined;
  const point = new Date(now);
  const near = new Date(point.getTime() + nearExpiryDays * 86400000);
  if (status === 'REVOKED') return { OR: [{ revokedAt: { lte: point } }, { overlapEndsAt: { lte: point } }] };
  if (status === 'EXPIRED') return { AND: [usableCredentialWhere(point), { expiresAt: { lte: point } }] };
  if (status === 'SCHEDULED') return { AND: [usableCredentialWhere(point), { startsAt: { gt: point } }, { OR: [{ expiresAt: null }, { expiresAt: { gt: point } }] }] };
  if (status === 'NEAR_EXPIRY') return { AND: [usableCredentialWhere(point), { startsAt: { lte: point } }, { expiresAt: { gt: point, lte: near } }] };
  if (status === 'ACTIVE') return { AND: [usableCredentialWhere(point), { startsAt: { lte: point } }, { OR: [{ expiresAt: null }, { expiresAt: { gt: near } }] }] };
  return undefined;
}

export async function createCredential(prisma, input, options) {
  const {
    actorUserId,
    idempotencyKey,
    now = new Date(),
    activeKeyVersion = env.apiTokenActiveKeyVersion,
    hashKeys = env.apiTokenHashKeys,
    globalMaxPageSize = env.apiTokenGlobalMaxPageSize,
    actorIp,
    actorUserAgent
  } = options || {};
  if (!actorUserId) throw new ApiCredentialServiceError(403, 'ADMIN_REQUIRED', 'Administrador obrigatório.');
  assertIdempotencyKey(idempotencyKey);
  const existing = await prisma.apiCredential.findUnique({ where: { issuanceRequestId: idempotencyKey }, include: credentialInclude });
  if (existing) {
    throw new ApiCredentialServiceError(409, 'IDEMPOTENCY_REPLAY', 'Esta emissão já foi processada; o segredo não pode ser reexibido.', {
      credential: publicCredential(existing, { now })
    });
  }
  const parsed = parseCreateInput(input, globalMaxPageSize);
  validateScopeSelection(parsed.scopeCodes);
  const startsAt = new Date(parsed.startsAt);
  if (startsAt.getTime() < new Date(now).getTime() - 5 * 60_000) {
    throw new ApiCredentialServiceError(400, 'INVALID_START', 'O início não pode ser retroativo.');
  }
  const hashKey = hashKeys?.[activeKeyVersion];
  const issued = createApiToken({ key: hashKey, keyVersion: activeKeyVersion });
  const expiresAt = parsed.expiresAt ? new Date(parsed.expiresAt) : null;
  const neverExpiresConfirmedAt = !expiresAt && parsed.neverExpiresConfirmation === NEVER_EXPIRES_CONFIRMATION ? new Date(now) : null;
  const allowedIpCidrs = normalizeCidrs(parsed.allowedIpCidrs);
  const data = {
    selector: issued.selector,
    secretVerifier: issued.verifier,
    hashKeyVersion: issued.keyVersion,
    secretLastFour: issued.secretLastFour,
    name: parsed.name,
    purpose: parsed.purpose,
    recipientName: parsed.recipientName,
    recipientContact: parsed.recipientContact,
    description: parsed.description,
    startsAt,
    expiresAt,
    neverExpiresConfirmedAt,
    projectAccessMode: parsed.projectAccess.mode,
    allowedIpCidrs,
    allowedFormats: parsed.allowedFormats,
    ...parsed.limits,
    createdByUserId: actorUserId,
    issuanceRequestId: idempotencyKey,
    scopes: { create: parsed.scopeCodes.map(scopeCode => ({ scopeCode, grantedByUserId: actorUserId })) },
    ...(parsed.projectAccess.mode === 'SELECTED' ? {
      projects: { create: parsed.projectAccess.projectIds.map(projectId => ({ projectId, grantedByUserId: actorUserId })) }
    } : {})
  };
  try {
    const credential = await prisma.$transaction(async tx => {
      const created = await tx.apiCredential.create({ data, include: credentialInclude });
      await tx.apiCredentialEvent.create({ data: sanitizeAdminEvent({
        credentialId: created.id,
        actorUserId,
        type: 'CREATED',
        requestId: idempotencyKey,
        actorIp: actorIp || null,
        actorUserAgent: actorUserAgent?.slice(0, 255) || null,
        summary: { scopeCount: parsed.scopeCodes.length, projectAccessMode: parsed.projectAccess.mode }
      }) });
      return created;
    });
    return { credential: publicCredential(credential, { now }), token: issued.token, tokenShownOnce: true };
  } catch (error) {
    if (error?.code === 'P2002') {
      throw new ApiCredentialServiceError(409, 'IDEMPOTENCY_REPLAY', 'Esta emissão já foi processada; o segredo não pode ser reexibido.');
    }
    throw error;
  }
}

export async function listCredentials(prisma, filters = {}, { now = new Date() } = {}) {
  const limit = Math.min(100, Math.max(1, Number(filters.limit) || 25));
  const statusCondition = credentialStatusWhere(filters.status, now);
  const cursorCondition = cursorWhere(filters.cursor);
  const clauses = [
    ...(filters.q ? [{ OR: [
      { name: { contains: filters.q, mode: 'insensitive' } },
      { recipientName: { contains: filters.q, mode: 'insensitive' } }
    ] }] : []),
    ...(statusCondition ? [statusCondition] : []),
    ...(cursorCondition ? [cursorCondition] : [])
  ];
  const where = {
    ...(clauses.length ? { AND: clauses } : {}),
    ...(filters.scope ? { scopes: { some: { scopeCode: filters.scope, revokedAt: null } } } : {}),
    ...(filters.expiresBefore ? { expiresAt: { lte: new Date(filters.expiresBefore) } } : {})
  };
  const rows = await prisma.apiCredential.findMany({ where, include: credentialInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1 });
  const mapped = rows.map(row => publicCredential(row, { now }));
  const hasMore = mapped.length > limit;
  const items = mapped.slice(0, limit);
  return { items, page: { limit, hasMore, nextCursor: hasMore ? cursorFromRow(rows[limit - 1]) : null } };
}

export async function getCredential(prisma, id, { now = new Date() } = {}) {
  id = validateCredentialId(id);
  const row = await prisma.apiCredential.findUnique({ where: { id }, include: credentialInclude });
  if (!row) throw new ApiCredentialServiceError(404, 'NOT_FOUND', 'Credencial não encontrada.');
  return publicCredential(row, { now });
}

export async function reduceCredential(prisma, id, input, options = {}) {
  id = validateCredentialId(id);
  const { actorUserId, now = new Date(), globalMaxPageSize = env.apiTokenGlobalMaxPageSize, actorIp, actorUserAgent } = options;
  const schemas = makeApiCredentialSchemas(z, { globalMaxPageSize });
  const parsed = schemas.reduce.parse(input);
  const current = await prisma.apiCredential.findUnique({ where: { id }, include: credentialInclude });
  if (!current) throw new ApiCredentialServiceError(404, 'NOT_FOUND', 'Credencial não encontrada.');
  if (effectiveCredentialStatus(current, now) === 'REVOKED' || effectiveCredentialStatus(current, now) === 'EXPIRED') {
    throw new ApiCredentialServiceError(409, 'TERMINAL_CREDENTIAL', 'Credenciais revogadas ou expiradas não podem ser alteradas.');
  }
  if (current.version !== parsed.expectedVersion) {
    throw new ApiCredentialServiceError(409, 'VERSION_CONFLICT', 'A credencial foi alterada por outra pessoa. Recarregue os dados.');
  }
  if (parsed.scopeCodes) validateScopeSelection(parsed.scopeCodes);
  const normalizedPatch = {
    ...parsed,
    ...(parsed.allowedIpCidrs ? { allowedIpCidrs: normalizeCidrs(parsed.allowedIpCidrs) } : {})
  };
  assertPolicyReduction(current, normalizedPatch);
  const nextScopeCodes = new Set(parsed.scopeCodes || current.scopes.filter(item => !item.revokedAt).map(item => item.scopeCode));
  const nextProjectIds = new Set(parsed.projectAccess?.projectIds || current.projects.filter(item => !item.revokedAt).map(item => item.projectId));
  const updateData = {
    ...Object.fromEntries(['name', 'purpose', 'recipientName', 'recipientContact', 'description'].filter(key => parsed[key] !== undefined).map(key => [key, parsed[key]])),
    ...(normalizedPatch.allowedIpCidrs ? { allowedIpCidrs: normalizedPatch.allowedIpCidrs } : {}),
    ...(parsed.expiresAt ? { expiresAt: new Date(parsed.expiresAt) } : {}),
    ...(parsed.projectAccess ? { projectAccessMode: parsed.projectAccess.mode } : {}),
    ...(parsed.limits || {}),
    version: { increment: 1 }
  };
  return prisma.$transaction(async tx => {
    const changed = await tx.apiCredential.updateMany({ where: { id, version: parsed.expectedVersion }, data: updateData });
    if (changed.count !== 1) throw new ApiCredentialServiceError(409, 'VERSION_CONFLICT', 'A credencial foi alterada por outra pessoa.');
    if (parsed.scopeCodes) {
      await tx.apiCredentialScope.updateMany({
        where: { credentialId: id, revokedAt: null, scopeCode: { notIn: [...nextScopeCodes] } },
        data: { revokedAt: new Date(now), revokedByUserId: actorUserId }
      });
    }
    if (parsed.projectAccess && current.projectAccessMode === 'ALL') {
      await tx.apiCredentialProject.createMany({
        data: [...nextProjectIds].map(projectId => ({ credentialId: id, projectId, grantedByUserId: actorUserId })),
        skipDuplicates: true
      });
    } else if (parsed.projectAccess) {
      await tx.apiCredentialProject.updateMany({
        where: { credentialId: id, revokedAt: null, projectId: { notIn: [...nextProjectIds] } },
        data: { revokedAt: new Date(now), revokedByUserId: actorUserId }
      });
    }
    await tx.apiCredentialEvent.create({ data: sanitizeAdminEvent({
      credentialId: id, actorUserId, type: 'RESTRICTIONS_REDUCED', reason: parsed.reason,
      actorIp: actorIp || null, actorUserAgent: actorUserAgent?.slice(0, 255) || null,
      summary: { scopeCount: nextScopeCodes.size, projectCount: nextProjectIds.size }
    }) });
    const updated = await tx.apiCredential.findUnique({ where: { id }, include: credentialInclude });
    return publicCredential(updated, { now });
  });
}

export function validateRotationWindow(value, now = new Date(), maxOverlapMinutes = env.apiTokenMaxOverlapMinutes) {
  const revokeAt = new Date(value);
  const current = new Date(now);
  if (Number.isNaN(revokeAt.getTime()) || revokeAt.getTime() < current.getTime() - 5_000) {
    throw new ApiCredentialServiceError(400, 'INVALID_ROTATION_WINDOW', 'A revogação anterior não pode ser retroativa.');
  }
  if (revokeAt.getTime() > current.getTime() + maxOverlapMinutes * 60_000) {
    throw new ApiCredentialServiceError(400, 'INVALID_ROTATION_WINDOW', `A sobreposição máxima é de ${maxOverlapMinutes} minutos.`);
  }
  return revokeAt.getTime() <= current.getTime() ? current : revokeAt;
}

function createDataForIssuedCredential(parsed, issued, { actorUserId, idempotencyKey, now, rotatedFromId = null }) {
  const expiresAt = parsed.expiresAt ? new Date(parsed.expiresAt) : null;
  return {
    selector: issued.selector,
    secretVerifier: issued.verifier,
    hashKeyVersion: issued.keyVersion,
    secretLastFour: issued.secretLastFour,
    name: parsed.name,
    purpose: parsed.purpose,
    recipientName: parsed.recipientName,
    recipientContact: parsed.recipientContact,
    description: parsed.description,
    startsAt: new Date(parsed.startsAt),
    expiresAt,
    neverExpiresConfirmedAt: !expiresAt && parsed.neverExpiresConfirmation === NEVER_EXPIRES_CONFIRMATION ? new Date(now) : null,
    projectAccessMode: parsed.projectAccess.mode,
    allowedIpCidrs: normalizeCidrs(parsed.allowedIpCidrs),
    allowedFormats: parsed.allowedFormats,
    ...parsed.limits,
    createdByUserId: actorUserId,
    issuanceRequestId: idempotencyKey,
    rotatedFromId,
    scopes: { create: parsed.scopeCodes.map(scopeCode => ({ scopeCode, grantedByUserId: actorUserId })) },
    ...(parsed.projectAccess.mode === 'SELECTED' ? {
      projects: { create: parsed.projectAccess.projectIds.map(projectId => ({ projectId, grantedByUserId: actorUserId })) }
    } : {})
  };
}

export async function rotateCredential(prisma, id, input, options = {}) {
  id = validateCredentialId(id);
  const {
    actorUserId,
    idempotencyKey,
    now = new Date(),
    activeKeyVersion = env.apiTokenActiveKeyVersion,
    hashKeys = env.apiTokenHashKeys,
    maxOverlapMinutes = env.apiTokenMaxOverlapMinutes,
    globalMaxPageSize = env.apiTokenGlobalMaxPageSize,
    actorIp,
    actorUserAgent
  } = options;
  assertIdempotencyKey(idempotencyKey);
  const replay = await prisma.apiCredential.findUnique({ where: { issuanceRequestId: idempotencyKey }, include: credentialInclude });
  if (replay) {
    throw new ApiCredentialServiceError(409, 'IDEMPOTENCY_REPLAY', 'Esta rotação já foi processada; o segredo não pode ser reexibido.', {
      credential: publicCredential(replay, { now })
    });
  }
  const schemas = makeApiCredentialSchemas(z, { globalMaxPageSize });
  const parsed = schemas.rotate.parse(input);
  const current = await prisma.apiCredential.findUnique({ where: { id }, include: credentialInclude });
  if (!current) throw new ApiCredentialServiceError(404, 'NOT_FOUND', 'Credencial não encontrada.');
  if (!['ACTIVE', 'NEAR_EXPIRY', 'SCHEDULED'].includes(effectiveCredentialStatus(current, now))) {
    throw new ApiCredentialServiceError(409, 'TERMINAL_CREDENTIAL', 'Credenciais revogadas ou expiradas não podem ser rotacionadas.');
  }
  if (current.version !== parsed.expectedVersion) throw new ApiCredentialServiceError(409, 'VERSION_CONFLICT', 'A credencial foi alterada por outra pessoa.');
  if (current.replacement) throw new ApiCredentialServiceError(409, 'ALREADY_ROTATED', 'A credencial já possui uma substituta.');
  validateScopeSelection(parsed.replacement.scopeCodes);
  const revokePreviousAt = validateRotationWindow(parsed.revokePreviousAt, now, maxOverlapMinutes);
  const immediate = revokePreviousAt.getTime() <= new Date(now).getTime();
  const issued = createApiToken({ key: hashKeys?.[activeKeyVersion], keyVersion: activeKeyVersion });
  const data = createDataForIssuedCredential(parsed.replacement, issued, { actorUserId, idempotencyKey, now, rotatedFromId: id });
  try {
    const replacement = await prisma.$transaction(async tx => {
      const updated = await tx.apiCredential.updateMany({
        where: { id, version: parsed.expectedVersion, revokedAt: null },
        data: immediate
          ? { revokedAt: new Date(now), revokedByUserId: actorUserId, revocationReason: parsed.reason, overlapEndsAt: null, version: { increment: 1 } }
          : { overlapEndsAt: revokePreviousAt, revocationReason: parsed.reason, version: { increment: 1 } }
      });
      if (updated.count !== 1) throw new ApiCredentialServiceError(409, 'VERSION_CONFLICT', 'A credencial foi alterada por outra pessoa.');
      const created = await tx.apiCredential.create({ data, include: credentialInclude });
      await tx.apiCredentialEvent.create({ data: sanitizeAdminEvent({
        credentialId: id, actorUserId, type: 'ROTATED', reason: parsed.reason, requestId: idempotencyKey,
        actorIp: actorIp || null, actorUserAgent: actorUserAgent?.slice(0, 255) || null,
        summary: { replacementId: created.id, revokePreviousAt: revokePreviousAt.toISOString() }
      }) });
      await tx.apiCredentialEvent.create({ data: sanitizeAdminEvent({
        credentialId: created.id, actorUserId, type: 'CREATED', reason: 'Criada por rotação.',
        summary: { rotatedFromId: id }
      }) });
      if (immediate) await tx.apiCredentialEvent.create({ data: sanitizeAdminEvent({
        credentialId: id, actorUserId, type: 'REVOKED', reason: parsed.reason,
        summary: { replacementId: created.id }
      }) });
      return created;
    });
    return { credential: publicCredential(replacement, { now }), token: issued.token, tokenShownOnce: true };
  } catch (error) {
    if (error?.code === 'P2002') throw new ApiCredentialServiceError(409, 'IDEMPOTENCY_REPLAY', 'A rotação já foi processada; o segredo não pode ser reexibido.');
    throw error;
  }
}

export async function revokeCredential(prisma, id, input, options = {}) {
  id = validateCredentialId(id);
  const { actorUserId, idempotencyKey, now = new Date(), actorIp, actorUserAgent } = options;
  assertIdempotencyKey(idempotencyKey);
  const replay = await prisma.apiCredentialEvent.findUnique({ where: { requestId: idempotencyKey } });
  if (replay) throw new ApiCredentialServiceError(409, 'IDEMPOTENCY_REPLAY', 'Esta revogação já foi processada.');
  const parsed = makeApiCredentialSchemas(z).revoke.parse(input);
  const current = await prisma.apiCredential.findUnique({ where: { id }, include: credentialInclude });
  if (!current) throw new ApiCredentialServiceError(404, 'NOT_FOUND', 'Credencial não encontrada.');
  if (effectiveCredentialStatus(current, now) === 'REVOKED' || effectiveCredentialStatus(current, now) === 'EXPIRED') {
    throw new ApiCredentialServiceError(409, 'TERMINAL_CREDENTIAL', 'A credencial já está em estado terminal.');
  }
  if (current.version !== parsed.expectedVersion) throw new ApiCredentialServiceError(409, 'VERSION_CONFLICT', 'A credencial foi alterada por outra pessoa.');
  return prisma.$transaction(async tx => {
    const changed = await tx.apiCredential.updateMany({
      where: { id, version: parsed.expectedVersion, revokedAt: null },
      data: { revokedAt: new Date(now), revokedByUserId: actorUserId, revocationReason: parsed.reason, overlapEndsAt: null, version: { increment: 1 } }
    });
    if (changed.count !== 1) throw new ApiCredentialServiceError(409, 'VERSION_CONFLICT', 'A credencial foi alterada por outra pessoa.');
    await tx.apiCredentialEvent.create({ data: sanitizeAdminEvent({
      credentialId: id, actorUserId, type: 'REVOKED', reason: parsed.reason, requestId: idempotencyKey,
      actorIp: actorIp || null, actorUserAgent: actorUserAgent?.slice(0, 255) || null, summary: {}
    }) });
    const updated = await tx.apiCredential.findUnique({ where: { id }, include: credentialInclude });
    return publicCredential(updated, { now });
  });
}

export async function listCredentialEvents(prisma, credentialId, { cursor, limit: requestedLimit } = {}) {
  credentialId = validateCredentialId(credentialId);
  const limit = z.coerce.number().int().min(1).max(100).default(25).parse(requestedLimit);
  const cursorValue = parseAdminCursor(cursor);
  const rows = await prisma.apiCredentialEvent.findMany({
    where: {
      credentialId,
      ...(cursorValue ? { OR: [
        { createdAt: { lt: new Date(cursorValue.createdAt) } },
        { createdAt: new Date(cursorValue.createdAt), id: { lt: cursorValue.id } }
      ] } : {})
    },
    select: { id: true, type: true, reason: true, summary: true, requestId: true, createdAt: true, actor: { select: { id: true, name: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1
  });
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map(row => ({ ...row, createdAt: iso(row.createdAt) }));
  const last = items.at(-1);
  return {
    items,
    page: {
      limit, hasMore,
      nextCursor: hasMore && last ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.id })).toString('base64url') : null
    }
  };
}

export async function getCredentialUsage(prisma, credentialId, { from, to }) {
  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate >= toDate) {
    throw new ApiCredentialServiceError(400, 'INVALID_INTERVAL', 'Informe um intervalo de uso válido.');
  }
  const where = { credentialId, createdAt: { gte: fromDate, lte: toDate } };
  const [totals, statusGroups, operationGroups] = await Promise.all([
    prisma.apiRequestLog.aggregate({ where, _count: { _all: true }, _sum: { responseRows: true, responseBytes: true } }),
    prisma.apiRequestLog.groupBy({ by: ['statusCode'], where, _count: { _all: true } }),
    prisma.apiRequestLog.groupBy({ by: ['operationId'], where, _count: { _all: true } })
  ]);
  return {
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
    requests: totals._count._all,
    rows: totals._sum.responseRows || 0,
    bytes: totals._sum.responseBytes || 0,
    byStatus: Object.fromEntries(statusGroups.map(item => [item.statusCode, item._count._all])),
    byOperation: Object.fromEntries(operationGroups.map(item => [item.operationId, item._count._all]))
  };
}
