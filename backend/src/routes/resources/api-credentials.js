import { Router } from 'express';
import { z } from 'zod';

import env from '../../config/env.js';
import asyncHandler from '../../lib/async-handler.js';
import { API_CATALOG_VERSION, API_DATA_DOMAINS, API_OPERATIONS, API_SCOPES, futureScopeDefinitions, publicApiOperations } from '../../lib/api-credentials/catalog.js';
import { createCredential, getCredential, getCredentialUsage, listCredentialEvents, listCredentials, reduceCredential, revokeCredential, rotateCredential, parseAdminCursor, validateCredentialId } from '../../lib/api-credentials/service.js';
import { adminCredentialRequestContext, adminCredentialErrorHandler } from '../../lib/api-credentials/admin-http.js';
import { executePlaygroundOperation, validatePlaygroundRequest } from '../../lib/api-credentials/playground.js';
import prisma from '../../lib/prisma.js';
import { requireAuth, requireHubAdmin } from '../../middleware/auth.js';

const router = Router();

router.use(requireAuth, requireHubAdmin);
router.use(adminCredentialRequestContext);
router.param('id', (req, _res, next, id) => { req.params.id = validateCredentialId(id); next(); });

const listSchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['SCHEDULED', 'ACTIVE', 'NEAR_EXPIRY', 'EXPIRED', 'REVOKED']).optional(),
  scope: z.string().trim().max(120).optional(),
  expiresBefore: z.string().datetime({ offset: true }).optional(),
  cursor: z.string().max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
}).strict();

const scopeCatalogQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  domain: z.string().trim().max(80).optional(),
  availability: z.enum(['AVAILABLE', 'PLANNED', 'SENSITIVE', 'RESERVED', 'PROHIBITED']).optional()
}).strict();

router.get('/api-scopes', (req, res) => {
  const query = scopeCatalogQuerySchema.parse(req.query);
  const definitions = [...API_SCOPES.map(({ status, dependencies, ...scope }) => ({
    ...scope,
    availability: status,
    requiredScopes: dependencies,
    operations: API_OPERATIONS.filter(operation => [...operation.requiredScopes, ...operation.optionalScopes].includes(scope.code)).map(operation => operation.operationId),
    models: scope.models || (scope.code === 'qualidade.naturezas.read' ? ['QualityNature'] : scope.code.includes('evidencias') ? ['QualityEvidence'] : ['QualityRecord']),
    exposedFields: scope.exposedFields || (scope.code.includes('evidencias') ? ['id', 'kind', 'label', 'fileName', 'mimeType', 'position', 'createdAt'] : ['campos públicos do contrato v1']),
    excludedFields: scope.excludedFields || ['storagePath', 'publicToken', 'seq', 'year', 'createdById', 'updatedById', 'deletedById'],
    endpointFamilies: API_OPERATIONS.filter(operation => [...operation.requiredScopes, ...operation.optionalScopes].includes(scope.code)).map(operation => operation.path)
  })), ...futureScopeDefinitions()];
  const normalized = query.q?.toLocaleLowerCase('pt-BR');
  const items = definitions.filter(item => (
    (!query.domain || item.domain === query.domain)
    && (!query.availability || item.availability === query.availability)
    && (!normalized || [item.domain, item.code, item.label, item.description, ...(item.models || [])].join(' ').toLocaleLowerCase('pt-BR').includes(normalized))
  ));
  res.json({
    version: API_CATALOG_VERSION,
    domains: API_DATA_DOMAINS,
    operations: publicApiOperations(),
    items
  });
});

router.get('/api-credentials', asyncHandler(async (req, res) => {
  res.json(await listCredentials(prisma, listSchema.parse(req.query)));
}));

router.post('/api-credentials', asyncHandler(async (req, res) => {
  const result = await createCredential(prisma, req.body, {
    actorUserId: req.auth.user.id,
    idempotencyKey: String(req.headers['idempotency-key'] || ''),
    actorIp: req.ip,
    actorUserAgent: req.headers['user-agent'],
    activeKeyVersion: env.apiTokenActiveKeyVersion,
    hashKeys: env.apiTokenHashKeys
  });
  res.status(201).json(result);
}));

router.get('/api-credentials/:id', asyncHandler(async (req, res) => {
  res.json(await getCredential(prisma, req.params.id));
}));

router.patch('/api-credentials/:id', asyncHandler(async (req, res) => {
  res.json(await reduceCredential(prisma, req.params.id, req.body, {
    actorUserId: req.auth.user.id,
    actorIp: req.ip,
    actorUserAgent: req.headers['user-agent']
  }));
}));

router.post('/api-credentials/:id/test', asyncHandler(async (req, res) => {
  const input = validatePlaygroundRequest(req.body);
  res.json(await executePlaygroundOperation(prisma, req.params.id, input, {
    actorUserId: req.auth.user.id,
    actorIp: req.ip,
    actorUserAgent: req.headers['user-agent'],
    requestId: req.requestId,
    cursorKey: env.apiTokenHashKeys[env.apiTokenActiveKeyVersion]
  }));
}));

router.post('/api-credentials/:id/rotate', asyncHandler(async (req, res) => {
  const result = await rotateCredential(prisma, req.params.id, req.body, {
    actorUserId: req.auth.user.id,
    idempotencyKey: String(req.headers['idempotency-key'] || ''),
    actorIp: req.ip,
    actorUserAgent: req.headers['user-agent'],
    activeKeyVersion: env.apiTokenActiveKeyVersion,
    hashKeys: env.apiTokenHashKeys
  });
  res.status(201).json(result);
}));

router.post('/api-credentials/:id/revoke', asyncHandler(async (req, res) => {
  res.json(await revokeCredential(prisma, req.params.id, req.body, {
    actorUserId: req.auth.user.id,
    idempotencyKey: String(req.headers['idempotency-key'] || ''),
    actorIp: req.ip,
    actorUserAgent: req.headers['user-agent']
  }));
}));

router.get('/api-credentials/:id/events', asyncHandler(async (req, res) => {
  const query = z.object({ cursor: z.string().max(2048).optional(), limit: z.coerce.number().int().min(1).max(100).optional() }).strict().parse(req.query);
  parseAdminCursor(query.cursor);
  await getCredential(prisma, req.params.id);
  res.json(await listCredentialEvents(prisma, req.params.id, query));
}));

router.get('/api-credentials/:id/usage', asyncHandler(async (req, res) => {
  const query = z.object({ from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) }).strict()
    .refine(value => new Date(value.from) < new Date(value.to), 'Informe um intervalo de uso válido.').parse(req.query);
  await getCredential(prisma, req.params.id);
  res.json(await getCredentialUsage(prisma, req.params.id, query));
}));

router.use(adminCredentialErrorHandler);

export default router;
