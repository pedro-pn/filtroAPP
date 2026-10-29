import { randomUUID } from 'node:crypto';
import env from '../../config/env.js';
import { z } from 'zod';

import { makeApiCredentialSchemas } from '../../../../shared/schemas/api-credentials.js';
import { hasIntegrationScopes, makeIntegrationApiSchemas, makeOperationalReadQuerySchema } from '../../../../shared/schemas/integration-api.js';
import { createIntegrationQualityRecord, validateIntegrationQualityCreate } from '../qualidade/integration-create.js';
import { getIntegrationQualityRecord, listIntegrationQualityRecords } from '../qualidade/integration-service.js';
import { listIntegrationQualityNatures } from '../qualidade/integration-natures.js';
import { recordApiRequest, recordCredentialEvent } from './audit.js';
import { getApiOperation } from './catalog.js';
import { executeApiWrite } from './write-simulation.js';
import { getOperationalResource } from './operational-resources.js';
import { listOperationalResources, prepareOperationalQuery } from './operational-service.js';
import { createPrismaQuotaStore, reserveCredentialQuota, settleCredentialQuota } from './quota.js';
import { ApiCredentialServiceError, effectiveCredentialStatus, validateCredentialId } from './service.js';
import { checkPlaygroundDownload } from './playground-downloads.js';
import { getEfetivoProjectStatus, validateEfetivoProjectStatusRequest } from './efetivo-project-status.js';
import { getJobRoleSalary, validateJobRoleSalaryRequest } from './job-role-salary.js';
import { createCrmDocument, createCrmProject, upsertCrmCommercialFact, validateCommercialFact, validateCrmDocument, validateProjectCreation, validateProjectWriteAccess } from './efetivo-project-writes.js';
import { receiveCrmOpportunity, validateCrmOpportunity } from '../projects/crm-opportunities.js';
import { getCrmPlanningState, listCrmPlanningStates, validatePlanningDetailParams, validatePlanningListQuery, validatePlanningReadAccess } from '../projects/crm-planning-read.js';

const PLAYGROUND_MAX_ITEMS = 20;
const requestSchema = makeApiCredentialSchemas(z).playground;
const integrationSchemas = makeIntegrationApiSchemas(z);

export function validatePlaygroundRequest(input) {
  const parsed = requestSchema.parse(input);
  const hasExplicitLimit = parsed.query.limit !== undefined;
  const operation = getApiOperation(parsed.operationId);
  if (parsed.headers && operation?.operationId !== 'quality.records.create') throw new ApiCredentialServiceError(400, 'UNKNOWN_PARAMETER', 'Esta operação não aceita headers no playground.');
  if (!operation?.supportsPlayground) throw new ApiCredentialServiceError(400, 'UNKNOWN_OPERATION', 'Operação indisponível no playground.');
  if (operation.method === 'GET' && parsed.body !== undefined) throw new ApiCredentialServiceError(400, 'BODY_NOT_ALLOWED', 'Esta operação não aceita corpo.');
  if (operation.method === 'POST' && parsed.body === undefined) throw new ApiCredentialServiceError(400, 'MISSING_BODY', 'Informe o corpo JSON.');
  const pathKeys = Object.keys(parsed.pathParams || {});
  const queryKeys = Object.keys(parsed.query || {});
  if (pathKeys.some(key => !(operation.pathParams || []).includes(key))
    || queryKeys.some(key => !(operation.queryParams || []).includes(key))) {
    throw new ApiCredentialServiceError(400, 'UNKNOWN_PARAMETER', 'O playground aceita somente parâmetros catalogados.');
  }
  for (const required of operation.pathParams || []) {
    if (!parsed.pathParams?.[required]) throw new ApiCredentialServiceError(400, 'MISSING_PARAMETER', `Informe ${required}.`);
  }
  if (operation.pathParams?.includes('id')) parsed.pathParams = integrationSchemas.idParams.parse(parsed.pathParams);
  if (operation.operationId === 'quality.records.list') parsed.query = integrationSchemas.qualityRecordsQuery.parse(parsed.query);
  else if (operation.operationId === 'quality.records.get') parsed.query = integrationSchemas.qualityRecordDetailQuery.parse(parsed.query);
  else if (operation.operationId === 'quality.natures.list') parsed.query = integrationSchemas.qualityNaturesQuery.parse(parsed.query);
  else if (operation.operationId === 'efetivo.projects.status.get') validateEfetivoProjectStatusRequest(parsed.pathParams, parsed.query, { projectAccessMode: 'ALL' });
  else if (operation.operationId === 'jobRoles.salary.get') validateJobRoleSalaryRequest(parsed.pathParams, parsed.query);
  else if (operation.operationId === 'quality.records.create') validateIntegrationQualityCreate(parsed.body, parsed.headers?.['Idempotency-Key'], { scopes: new Set(['qualidade.registros.create']), projectAccessMode: 'ALL' });
  else if (operation.operationId === 'efetivo.projects.create') validateProjectCreation(parsed.body);
  else if (operation.operationId === 'acompanhamento.opportunities.post') validateCrmOpportunity(parsed.body);
  else if (operation.operationId === 'acompanhamento.opportunities.links.list') validatePlanningListQuery(parsed.query);
  else if (operation.operationId === 'acompanhamento.opportunities.get') validatePlanningDetailParams(parsed.pathParams, parsed.query);
  else if (operation.operationId === 'efetivo.projects.commercialFact.post') validateCommercialFact(parsed.body);
  else if (operation.operationId === 'efetivo.projects.document.post') validateCrmDocument(parsed.body);
  else if (getOperationalResource(operation.operationId)) parsed.query = makeOperationalReadQuerySchema(z).parse(parsed.query);
  if (!hasExplicitLimit) delete parsed.query.limit;
  return parsed;
}

function requestPath(operation, pathParams, query) {
  let path = operation.path;
  for (const [key, value] of Object.entries(pathParams || {})) path = path.replace(`:${key}`, encodeURIComponent(value));
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  const suffix = params.toString();
  return `/api/integracoes/v1${path}${suffix ? `?${suffix}` : ''}`;
}

function curlForPath(path, download = false, method = 'GET', body, headers) {
  const url = '$FILTRO_API_BASE_URL' + path;
  if (download) return `curl --fail -H "Authorization: Bearer $FILTRO_API_TOKEN" --output "arquivo-baixado.bin" "${url}"`;
  if (method === 'POST') {
    const quotedBody = JSON.stringify(body).replaceAll("'", "'\\''");
    const idempotency = path === '/api/integracoes/v1/acompanhamento/oportunidades' ? ` -H "Idempotency-Key: ${body.eventId}"`
      : headers?.['Idempotency-Key'] ? ` -H "Idempotency-Key: ${headers['Idempotency-Key']}"` : '';
    const preference = headers?.Prefer ? ' -H "Prefer: validate-only"' : '';
    return `curl --fail-with-body -X POST -H "Authorization: Bearer $FILTRO_API_TOKEN" -H "Content-Type: application/json"${idempotency}${preference} --data-raw '${quotedBody}' "${url}"`;
  }
  return `curl --fail-with-body -H "Authorization: Bearer $FILTRO_API_TOKEN" -H "Accept: application/json" "${url}"`;
}

export async function executePlaygroundOperation(prisma, credentialId, input, options = {}) {
  credentialId = validateCredentialId(credentialId);
  const parsed = validatePlaygroundRequest(input);
  const operation = getApiOperation(parsed.operationId);
  const credential = await prisma.apiCredential.findUnique({
    where: { id: credentialId },
    include: { scopes: { where: { revokedAt: null }, select: { scopeCode: true } }, projects: { where: { revokedAt: null }, select: { projectId: true, project: { select: { code: true } } } } }
  });
  if (!credential) throw new ApiCredentialServiceError(404, 'NOT_FOUND', 'Credencial não encontrada.');
  const simulated = operation.method === 'POST' && (credential.writeMode === 'SIMULATE' || parsed.writeMode !== 'LIVE');
  if (!['ACTIVE', 'NEAR_EXPIRY'].includes(effectiveCredentialStatus(credential, options.now || new Date()))) {
    throw new ApiCredentialServiceError(409, 'INACTIVE_CREDENTIAL', 'A credencial não está ativa.');
  }
  const scopes = new Set(credential.scopes.map(item => item.scopeCode));
  if (!['ALL', 'SELECTED'].includes(credential.projectAccessMode) || (credential.projectAccessMode === 'SELECTED' && !credential.projects.length)) {
    throw new ApiCredentialServiceError(403, 'PROJECT_NOT_ALLOWED', 'A credencial não possui um recorte de projetos válido.');
  }
  if (!hasIntegrationScopes(operation, scopes)) {
    throw new ApiCredentialServiceError(403, 'INSUFFICIENT_SCOPE', 'A credencial não possui o escopo necessário.');
  }
  if (parsed.query.includeDeleted && !scopes.has('qualidade.excluidos.read')) {
    throw new ApiCredentialServiceError(403, 'INSUFFICIENT_SCOPE', 'A credencial não permite excluídos.');
  }

  const query = { ...parsed.query };
  if (operation.queryParams.includes('limit')) {
    const requestedLimit = query.limit === undefined ? Math.min(10, credential.maxPageSize) : Number(query.limit);
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > credential.maxPageSize) {
      throw new ApiCredentialServiceError(400, 'INVALID_LIMIT', `Informe um limite entre 1 e ${credential.maxPageSize}.`);
    }
    query.limit = Math.min(PLAYGROUND_MAX_ITEMS, requestedLimit);
  }
  const context = {
    credentialId,
    scopes,
    projectAccessMode: credential.projectAccessMode,
    projectIds: new Set(credential.projects.map(item => item.projectId)),
    projectCodes: new Set(credential.projects.map(item => item.project?.code).filter(Boolean)),
    maxPageSize: Math.min(credential.maxPageSize, PLAYGROUND_MAX_ITEMS),
    cursorKey: options.cursorKey,
    snapshotAt: options.now || new Date()
  };
  const started = process.hrtime.bigint();
  if (getOperationalResource(parsed.operationId)) prepareOperationalQuery(parsed.operationId, query, context);
  if (parsed.operationId === 'efetivo.projects.status.get') validateEfetivoProjectStatusRequest(parsed.pathParams, query, context);
  if (operation.method === 'POST' && parsed.operationId !== 'quality.records.create') validateProjectWriteAccess(parsed.pathParams.id, query, context, { create: ['efetivo.projects.create', 'acompanhamento.opportunities.post'].includes(parsed.operationId) });
  if (parsed.operationId === 'quality.records.create') validateIntegrationQualityCreate(parsed.body, parsed.headers?.['Idempotency-Key'], context, query);
  if (['acompanhamento.opportunities.links.list', 'acompanhamento.opportunities.get'].includes(parsed.operationId)) validatePlanningReadAccess(credential);
  const requestId = options.requestId || randomUUID();
  const isDownload = operation.responseKind === 'DOWNLOAD_CHECK';
  const requestedRows = isDownload ? 0 : parsed.operationId.endsWith('.list') ? Number(query.limit) || PLAYGROUND_MAX_ITEMS : 1;
  const store = createPrismaQuotaStore(prisma);
  const reservation = await reserveCredentialQuota({
    store,
    credentialId,
    limits: {
      requestsPerMinute: credential.requestsPerMinute,
      requestsPerDay: credential.requestsPerDay,
      rowsPerDay: credential.rowsPerDay
    },
    requestedRows
  });
  let body;
  let rows = 0;
  let responseStatus;
  let settled = false;
  try {
    if (operation.method === 'POST') {
      const result = await executeApiWrite(prisma, { operation, simulated, requestId, execute: async database => {
        let response;
        let statusCode = 200;
        if (parsed.operationId === 'quality.records.create') {
          response = await createIntegrationQualityRecord(database, parsed.body, parsed.headers['Idempotency-Key'], context);
          statusCode = 201;
        } else if (parsed.operationId === 'acompanhamento.opportunities.post') {
          const received = await receiveCrmOpportunity(database, parsed.body, { envConfig: options.envConfig || env, idempotencyKey: parsed.body.eventId });
          response = received.body; statusCode = received.statusCode;
        } else if (parsed.operationId === 'efetivo.projects.create') response = await createCrmProject(database, parsed.body);
        else if (parsed.operationId === 'efetivo.projects.commercialFact.post') response = await upsertCrmCommercialFact(database, parsed.pathParams.id, parsed.body);
        else if (parsed.operationId === 'efetivo.projects.document.post') response = await createCrmDocument(database, parsed.pathParams.id, parsed.body);
        else throw new ApiCredentialServiceError(501, 'SIMULATION_NOT_SUPPORTED', 'A operação não suporta simulação.');
        if (['created', 'CREATED'].includes(response?.status || response?.outcome)) statusCode = 201;
        return { body: response, statusCode, rows: 1 };
      } });
      body = result.body; responseStatus = result.statusCode; rows = result.rows;
    } else if (isDownload) {
      body = await checkPlaygroundDownload(prisma, operation, parsed.pathParams, context, options.fileRoots);
    } else if (parsed.operationId === 'quality.records.list') {
      const result = await listIntegrationQualityRecords(prisma, integrationSchemas.qualityRecordsQuery.parse(query), context);
      body = { ...result, generatedAt: new Date().toISOString(), schemaVersion: '1.0', requestId };
      rows = result.items.length;
    } else if (parsed.operationId === 'quality.records.get') {
      body = await getIntegrationQualityRecord(prisma, parsed.pathParams.id, integrationSchemas.qualityRecordDetailQuery.parse(query), context);
      rows = 1;
    } else if (parsed.operationId === 'quality.natures.list') {
      const result = await listIntegrationQualityNatures(prisma, integrationSchemas.qualityNaturesQuery.parse(query), context);
      body = { ...result, generatedAt: new Date().toISOString(), schemaVersion: '1.0', requestId };
      rows = result.items.length;
    } else if (parsed.operationId === 'jobRoles.salary.get') {
      body = await getJobRoleSalary(prisma, parsed.pathParams, query, context);
      rows = 1;
    } else if (parsed.operationId === 'efetivo.projects.status.get') {
      body = {
        ...await getEfetivoProjectStatus(prisma, parsed.pathParams.id, context),
        generatedAt: new Date().toISOString(), schemaVersion: '1.0', requestId
      };
      rows = 1;
    } else if (parsed.operationId === 'acompanhamento.opportunities.get') {
      body = await getCrmPlanningState(prisma, parsed.pathParams.externalId, options.envConfig || env);
      rows = 1;
    } else if (parsed.operationId === 'acompanhamento.opportunities.links.list') {
      body = await listCrmPlanningStates(prisma, query, { envConfig: options.envConfig || env, maxPageSize: context.maxPageSize,
        cursorKey: options.cursorKey || env.apiTokenHashKeys[env.apiTokenActiveKeyVersion] });
      rows = body.items.length;
    } else {
      const result = await listOperationalResources(prisma, parsed.operationId, query, context);
      body = { ...result, generatedAt: new Date().toISOString(), schemaVersion: '1.0', requestId };
      rows = result.items.length;
    }
    await settleCredentialQuota({ store, reservation, actualRows: rows, responseBytes: Buffer.byteLength(JSON.stringify(body)) });
    settled = true;
    if (operation.method === 'POST') await recordApiRequest(prisma, {
      credentialId, requestId, operationId: operation.operationId, scopeCode: operation.requiredScopes[0],
      pathTemplate: operation.path, statusCode: responseStatus, outcomeCode: simulated ? 'SIMULATED' : 'OK', simulated,
      responseRows: rows, responseBytes: Buffer.byteLength(JSON.stringify(body)), durationMs: Number((process.hrtime.bigint() - started) / 1_000_000n)
    });
  } catch (error) {
    if (!settled) {
      try { await settleCredentialQuota({ store, reservation, actualRows: 0, responseBytes: 0 }); } catch { /* preserva falha original */ }
    }
    if (operation.method === 'POST') {
      await recordApiRequest(prisma, { credentialId, requestId, operationId: operation.operationId,
        scopeCode: operation.requiredScopes[0], pathTemplate: operation.path, simulated,
        statusCode: error.statusCode || 500, outcomeCode: error.code || 'INTERNAL_ERROR', durationMs: 0 }).catch(() => {});
    }
    throw error;
  }
  await recordCredentialEvent(prisma, {
    credentialId,
    actorUserId: options.actorUserId,
    type: 'TESTED',
    actorIp: options.actorIp,
    actorUserAgent: options.actorUserAgent,
    summary: { operationId: parsed.operationId, rows, simulated }
  });
  const path = requestPath(operation, parsed.pathParams, query);
  const headers = { ...parsed.headers, ...(simulated ? { Prefer: 'validate-only' } : {}) };
  return {
    request: { method: operation.method, path, authorization: `Bearer ••••${credential.secretLastFour}`, curl: curlForPath(path, isDownload, operation.method, parsed.body, headers), body: operation.method === 'POST' ? parsed.body : null,
      ...(Object.keys(headers).length ? { headers } : {}) },
    response: {
      ...(simulated ? { headers: { 'Preference-Applied': 'validate-only' } } : {}),
      status: responseStatus ?? (operation.method === 'POST' && ['created', 'CREATED'].includes(body?.status || body?.outcome) ? 201 : 200),
      durationMs: Number((process.hrtime.bigint() - started) / 1_000_000n),
      requestId,
      truncated: rows >= PLAYGROUND_MAX_ITEMS,
      body
    }
  };
}
