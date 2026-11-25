import { Router } from 'express';
import { z } from 'zod';

import env from '../../config/env.js';
import asyncHandler from '../../lib/async-handler.js';
import { API_CATALOG_VERSION, API_DATA_DOMAINS, API_OPERATIONS, API_SCOPES, futureScopeDefinitions, publicApiOperations } from '../../lib/api-credentials/catalog.js';
import { createCredential, getCredential, getCredentialUsage, listCredentialEvents, listCredentials, reduceCredential, updateCredentialWriteMode, revokeCredential, rotateCredential, parseAdminCursor, validateCredentialId } from '../../lib/api-credentials/service.js';
import { adminCredentialRequestContext, adminCredentialErrorHandler } from '../../lib/api-credentials/admin-http.js';
import { executePlaygroundOperation, validatePlaygroundRequest } from '../../lib/api-credentials/playground.js';
import prisma from '../../lib/prisma.js';
import { requireAuth, requireHubAdmin } from '../../middleware/auth.js';

import { defineRoute } from '../../lib/api-contract/registry.js';
import { opsRoute, jsonResponseSchema, libValidatedBodySchema } from '../../lib/api-contract/domains/operacoes.js';
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

defineRoute(router, opsRoute('GET /api-scopes', { tag: 'admin', summary: 'Credenciais de API: Catálogo de escopos', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), (req, res) => {
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

defineRoute(router, opsRoute('GET /api-credentials', { tag: 'admin', summary: 'Credenciais de API: Listar credenciais', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), asyncHandler(async (req, res) => {
  res.json(await listCredentials(prisma, listSchema.parse(req.query)));
}));

defineRoute(router, opsRoute('POST /api-credentials', { tag: 'admin', summary: 'Credenciais de API: Criar credencial', body: libValidatedBodySchema, validatedBy: 'handler/serviço (corpo conferido fora do contrato)', responses: { 201: jsonResponseSchema }, errors: [400, 401, 403] }), asyncHandler(async (req, res) => {
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

defineRoute(router, opsRoute('GET /api-credentials/:id', { tag: 'admin', summary: 'Credenciais de API: Consultar credencial', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), asyncHandler(async (req, res) => {
  res.json(await getCredential(prisma, req.params.id));
}));

defineRoute(router, opsRoute('PATCH /api-credentials/:id', { tag: 'admin', summary: 'Credenciais de API: Atualizar credencial', body: libValidatedBodySchema, validatedBy: 'handler/serviço (corpo conferido fora do contrato)', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), asyncHandler(async (req, res) => {
  const update = Object.hasOwn(req.body || {}, 'writeMode') ? updateCredentialWriteMode : reduceCredential;
  res.json(await update(prisma, req.params.id, req.body, {
    actorUserId: req.auth.user.id,
    actorIp: req.ip,
    actorUserAgent: req.headers['user-agent']
  }));
}));

defineRoute(router, opsRoute('POST /api-credentials/:id/test', { tag: 'admin', summary: 'Credenciais de API: Testar credencial', body: libValidatedBodySchema, validatedBy: 'handler/serviço (corpo conferido fora do contrato)', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), asyncHandler(async (req, res) => {
  const operation = API_OPERATIONS.find(item => item.operationId === req.body?.operationId);
  if (operation?.method === 'POST') {
    const credential = await getCredential(prisma, req.params.id);
    if (credential.writeMode === 'SIMULATE' || req.body?.writeMode !== 'LIVE') res.setHeader('Preference-Applied', 'validate-only');
  }
  const input = validatePlaygroundRequest(req.body);
  res.json(await executePlaygroundOperation(prisma, req.params.id, input, {
    actorUserId: req.auth.user.id,
    actorIp: req.ip,
    actorUserAgent: req.headers['user-agent'],
    requestId: req.requestId,
    cursorKey: env.apiTokenHashKeys[env.apiTokenActiveKeyVersion]
  }));
}));

defineRoute(router, opsRoute('POST /api-credentials/:id/rotate', { tag: 'admin', summary: 'Credenciais de API: Gerar novo token (rotação)', body: libValidatedBodySchema, validatedBy: 'handler/serviço (corpo conferido fora do contrato)', responses: { 201: jsonResponseSchema }, errors: [400, 401, 403] }), asyncHandler(async (req, res) => {
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

defineRoute(router, opsRoute('POST /api-credentials/:id/revoke', { tag: 'admin', summary: 'Credenciais de API: Revogar credencial', body: libValidatedBodySchema, validatedBy: 'handler/serviço (corpo conferido fora do contrato)', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), asyncHandler(async (req, res) => {
  res.json(await revokeCredential(prisma, req.params.id, req.body, {
    actorUserId: req.auth.user.id,
    idempotencyKey: String(req.headers['idempotency-key'] || ''),
    actorIp: req.ip,
    actorUserAgent: req.headers['user-agent']
  }));
}));

defineRoute(router, opsRoute('GET /api-credentials/:id/events', { tag: 'admin', summary: 'Credenciais de API: Eventos da credencial', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), asyncHandler(async (req, res) => {
  const query = z.object({ cursor: z.string().max(2048).optional(), limit: z.coerce.number().int().min(1).max(100).optional() }).strict().parse(req.query);
  parseAdminCursor(query.cursor);
  await getCredential(prisma, req.params.id);
  res.json(await listCredentialEvents(prisma, req.params.id, query));
}));

defineRoute(router, opsRoute('GET /api-credentials/:id/usage', { tag: 'admin', summary: 'Credenciais de API: Uso da credencial', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), asyncHandler(async (req, res) => {
  const query = z.object({ from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) }).strict()
    .refine(value => new Date(value.from) < new Date(value.to), 'Informe um intervalo de uso válido.').parse(req.query);
  await getCredential(prisma, req.params.id);
  res.json(await getCredentialUsage(prisma, req.params.id, query));
}));

router.use(adminCredentialErrorHandler);

export default router;
