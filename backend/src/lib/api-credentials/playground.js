import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { makeApiCredentialSchemas } from '../../../../shared/schemas/api-credentials.js';
import { makeIntegrationApiSchemas, makeOperationalReadQuerySchema } from '../../../../shared/schemas/integration-api.js';
import { getIntegrationQualityRecord, listIntegrationQualityRecords } from '../qualidade/integration-service.js';
import { listIntegrationQualityNatures } from '../qualidade/integration-natures.js';
import { recordCredentialEvent } from './audit.js';
import { getApiOperation } from './catalog.js';
import { getOperationalResource } from './operational-resources.js';
import { listOperationalResources, prepareOperationalQuery } from './operational-service.js';
import { createPrismaQuotaStore, reserveCredentialQuota, settleCredentialQuota } from './quota.js';
import { ApiCredentialServiceError, effectiveCredentialStatus, validateCredentialId } from './service.js';
import { checkPlaygroundDownload } from './playground-downloads.js';

const PLAYGROUND_MAX_ITEMS = 20;
const requestSchema = makeApiCredentialSchemas(z).playground;
const integrationSchemas = makeIntegrationApiSchemas(z);

export function validatePlaygroundRequest(input) {
  const parsed = requestSchema.parse(input);
  const hasExplicitLimit = parsed.query.limit !== undefined;
  const operation = getApiOperation(parsed.operationId);
  if (!operation?.supportsPlayground) throw new ApiCredentialServiceError(400, 'UNKNOWN_OPERATION', 'Operação indisponível no playground.');
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

function curlForPath(path, download = false) {
  const url = '$FILTRO_API_BASE_URL' + path;
  if (download) return `curl --fail -H "Authorization: Bearer $FILTRO_API_TOKEN" --output "arquivo-baixado.bin" "${url}"`;
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
  if (!['ACTIVE', 'NEAR_EXPIRY'].includes(effectiveCredentialStatus(credential, options.now || new Date()))) {
    throw new ApiCredentialServiceError(409, 'INACTIVE_CREDENTIAL', 'A credencial não está ativa.');
  }
  const scopes = new Set(credential.scopes.map(item => item.scopeCode));
  if (!['ALL', 'SELECTED'].includes(credential.projectAccessMode) || (credential.projectAccessMode === 'SELECTED' && !credential.projects.length)) {
    throw new ApiCredentialServiceError(403, 'PROJECT_NOT_ALLOWED', 'A credencial não possui um recorte de projetos válido.');
  }
  if (operation.requiredScopes.some(scope => !scopes.has(scope))) {
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
  try {
    if (isDownload) {
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
    } else {
      const result = await listOperationalResources(prisma, parsed.operationId, query, context);
      body = { ...result, generatedAt: new Date().toISOString(), schemaVersion: '1.0', requestId };
      rows = result.items.length;
    }
    await settleCredentialQuota({ store, reservation, actualRows: rows, responseBytes: Buffer.byteLength(JSON.stringify(body)) });
  } catch (error) {
    try { await settleCredentialQuota({ store, reservation, actualRows: 0, responseBytes: 0 }); } catch { /* preserva falha original */ }
    throw error;
  }
  await recordCredentialEvent(prisma, {
    credentialId,
    actorUserId: options.actorUserId,
    type: 'TESTED',
    actorIp: options.actorIp,
    actorUserAgent: options.actorUserAgent,
    summary: { operationId: parsed.operationId, rows }
  });
  const path = requestPath(operation, parsed.pathParams, query);
  return {
    request: { method: operation.method, path, authorization: `Bearer ••••${credential.secretLastFour}`, curl: curlForPath(path, isDownload) },
    response: {
      status: 200,
      durationMs: Number((process.hrtime.bigint() - started) / 1_000_000n),
      requestId,
      truncated: rows >= PLAYGROUND_MAX_ITEMS,
      body
    }
  };
}
