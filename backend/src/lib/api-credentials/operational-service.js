import { z } from 'zod';
import { createHash } from 'node:crypto';
import { makeOperationalReadQuerySchema } from '../../../../shared/schemas/integration-api.js';
import { IntegrationApiError } from '../../middleware/api-request-context.js';
import { createSignedCursor, readSignedCursor, stableJson } from './cursor.js';
import { getOperationalResource } from './operational-resources.js';
import { enrichOperationalRows, serializeOperationalResource } from './operational-serialization.js';
import { reportAttachmentWhere } from './extended-operational-resources.js';

const querySchema = makeOperationalReadQuerySchema(z);

export function prepareOperationalQuery(operationId, input, context) {
  const resource = getOperationalResource(operationId);
  if (!resource) throw new IntegrationApiError(400, 'UNKNOWN_OPERATION', 'Operação indisponível.');
  if (resource.requiredScopes.some(scope => !context.scopes.has(scope))) throw new IntegrationApiError(403, 'INSUFFICIENT_SCOPE', 'A credencial não possui a permissão necessária.');
  const query = querySchema.parse(input);
  if (Object.keys(query).some(key => !resource.queryParams.includes(key))) {
    throw new IntegrationApiError(400, 'UNKNOWN_PARAMETER', 'Parâmetro não disponível nesta operação.');
  }
  const max = Math.min(context.maxPageSize || 100, 500);
  query.limit ??= Math.min(100, max);
  if (query.limit > max) throw new IntegrationApiError(400, 'INVALID_LIMIT', `O limite por página deve estar entre 1 e ${max}.`);
  if (!['ALL', 'SELECTED'].includes(context.projectAccessMode)
    || (context.projectAccessMode === 'SELECTED' && !context.projectIds?.size)
    || (query.projectId && context.projectAccessMode === 'SELECTED' && !context.projectIds.has(query.projectId))
    || (query.projectCode && context.projectAccessMode === 'SELECTED' && !context.projectCodes?.has(query.projectCode))) {
    throw new IntegrationApiError(403, 'PROJECT_NOT_ALLOWED', 'O projeto solicitado não está autorizado.');
  }
  return { resource, query };
}

function projectWhere(resource, query, context) {
  const ids = query.projectId ? [query.projectId] : context.projectAccessMode === 'SELECTED' ? [...context.projectIds] : null;
  const code = query.projectCode;
  if ((!ids && !code) || resource.projectPolicy === 'GLOBAL') return {};
  const projectId = ids ? { in: ids } : null;
  const direct = {
    ...(projectId ? { projectId } : {}),
    ...(code ? { project: { code } } : {})
  };
  const report = {
    ...(projectId ? { projectId } : {}),
    ...(code ? { project: { code } } : {})
  };
  switch (resource.projectPolicy) {
    case 'SELF': return { ...(projectId ? { id: projectId } : {}), ...(code ? { code } : {}) };
    case 'DIRECT': return direct;
    case 'REPORT': return { report,
      ...(['ReportSignature', 'ReportAuditLog'].includes(resource.model) ? { OR: [{ versionId: null }, { version: { report } }] } : {}) };
    case 'MAINTENANCE': return { maintenance: { report } };
    case 'STOCK_BATCH': return { movements: { some: {
      ...(projectId ? { projectId } : {}), project: { deletedAt: null, ...(code ? { code } : {}) }
    } } };
    case 'REPORT_ATTACHMENT': return reportAttachmentWhere(report);
    case 'COLLABORATOR_REPORT': return { reportLinks: { some: { report: {
      ...(projectId ? { projectId } : {}), status: 'APPROVED', deletedAt: null,
      project: { deletedAt: null, ...(code ? { code } : {}) }
    } } } };
    default: throw new IntegrationApiError(403, 'PROJECT_NOT_ALLOWED', 'Política de projeto indisponível.');
  }
}

export function operationalVisibilityWhere(resource, query, context) {
  return { AND: [resource.where, projectWhere(resource, query, context),
    ...resource.filterFields.filter(field => query[field]).map(field => {
      if (field === 'reportId' && resource.projectPolicy === 'REPORT_ATTACHMENT') {
        return { OR: [{ reportId: query[field] }, { reportService: { reportId: query[field] } }] };
      }
      if (field === 'reportType') {
        const reportType = { in: query[field] };
        if (resource.projectPolicy === 'REPORT_ATTACHMENT') {
          return { OR: [{ report: { reportType } }, { reportService: { report: { reportType } } }] };
        }
        if (resource.projectPolicy === 'REPORT') return { report: { reportType } };
        return { reportType };
      }
      return { [field]: query[field] };
    })
  ] };
}

export async function listOperationalResources(client, operationId, input, context) {
  const { resource, query } = prepareOperationalQuery(operationId, input, context);
  const filters = {
    ...(query.projectCode ? { projectCode: query.projectCode } : {}),
    ...(query.projectId ? { projectId: query.projectId } : {}),
    ...(query.updatedSince ? { updatedSince: new Date(query.updatedSince).toISOString() } : {}),
    ...(query.createdSince ? { createdSince: new Date(query.createdSince).toISOString() } : {}),
    ...Object.fromEntries(resource.filterFields.filter(field => query[field])
      .map(field => [field, Array.isArray(query[field]) ? [...query[field]].sort() : query[field]])),
    ...(query.active !== undefined ? { active: query.active } : {}),
    policyFingerprint: createHash('sha256').update(stableJson({
      projectAccessMode: context.projectAccessMode,
      projectIds: context.projectAccessMode === 'SELECTED' ? [...context.projectIds].sort() : []
    })).digest('hex')
  };
  const now = new Date(context.snapshotAt || new Date());
  let snapshotAt = query.snapshotAt ? new Date(query.snapshotAt) : now;
  let position;
  const timestamp = resource.timestampField;
  const orderFields = [...(timestamp ? [timestamp] : []), ...resource.keyFields];
  const since = query.updatedSince || query.createdSince;
  if (query.cursor) {
    const cursor = readSignedCursor({ cursor: query.cursor, key: context.cursorKey, operationId, filters, positionKeys: orderFields });
    if (query.snapshotAt && snapshotAt.toISOString() !== cursor.snapshotAt) throw new IntegrationApiError(400, 'INVALID_CURSOR', 'Snapshot incompatível com o cursor.');
    snapshotAt = new Date(cursor.snapshotAt);
    position = cursor.position;
  }
  if (!Number.isFinite(snapshotAt.getTime()) || snapshotAt > now
    || (since && new Date(since) > snapshotAt)
    || (position && timestamp && (!Number.isFinite(new Date(position[timestamp]).getTime()) || new Date(position[timestamp]) > snapshotAt))) {
    throw new IntegrationApiError(400, 'INVALID_SNAPSHOT', 'Informe um intervalo válido, sem datas futuras.');
  }
  const positionValue = field => field === timestamp ? new Date(position[field]) : position[field];
  const rows = await client[resource.delegate].findMany({
    select: resource.select,
    where: { AND: [operationalVisibilityWhere(resource, query, context),
      timestamp ? { [timestamp]: { lte: snapshotAt, ...(since ? { gte: new Date(since) } : {}) } } : { report: { createdAt: { lte: snapshotAt } } },
      ...(query.active !== undefined ? [{ isActive: query.active }] : []),
      ...(position ? [{ OR: orderFields.map((field, index) => ({
        ...Object.fromEntries(orderFields.slice(0, index).map(previous => [previous, positionValue(previous)])),
        [field]: { gt: positionValue(field) }
      })) }] : [])
    ] },
    orderBy: orderFields.map(field => ({ [field]: 'asc' })), take: query.limit + 1
  });
  const pageRows = rows.slice(0, query.limit);
  const hasMore = rows.length > query.limit;
  const last = pageRows.at(-1);
  const nextCursor = hasMore && last ? createSignedCursor({ key: context.cursorKey, payload: {
    version: 1, operationId, filters, snapshotAt: snapshotAt.toISOString(),
    position: Object.fromEntries(orderFields.map(field => [field, field === timestamp ? new Date(last[field]).toISOString() : last[field]]))
  } }) : null;
  const outputRows = await enrichOperationalRows(client, resource, pageRows, context);
  return { items: outputRows.map(row => serializeOperationalResource(resource, row, context)),
    page: { limit: query.limit, hasMore, nextCursor, snapshotAt: snapshotAt.toISOString() } };
}
