import { createSignedCursor, readSignedCursor } from '../api-credentials/cursor.js';
import { IntegrationApiError } from '../../middleware/api-request-context.js';
import { calculateQualityRecurrence } from './recurrence.js';
import { publicQualityRecord } from './public-serializer.js';

export const QUALITY_RECORD_PUBLIC_SELECT = {
  id: true,
  number: true,
  type: true,
  registeredAt: true,
  origin: true,
  projectId: true,
  eventDate: true,
  natureId: true,
  description: true,
  impact: true,
  linkedRnc: true,
  disposition: true,
  definedAction: true,
  actionOwner: true,
  actionDeadline: true,
  evidence: true,
  resultVerification: true,
  status: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  project: { select: { id: true, code: true, name: true } },
  nature: { select: { id: true, name: true, isActive: true } },
  evidences: {
    select: { id: true, kind: true, label: true, fileName: true, mimeType: true, storagePath: true, position: true, createdAt: true },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }]
  }
};

export function assertProjectAllowed(projectId, { projectAccessMode, projectIds }) {
  if (projectAccessMode === 'ALL') return true;
  if (!projectId || !projectIds?.has(projectId)) {
    throw new IntegrationApiError(403, 'PROJECT_NOT_ALLOWED', 'O projeto solicitado não está autorizado.');
  }
  return true;
}

export function assertProjectFilterAllowed(query, context) {
  if (query.projectId) assertProjectAllowed(query.projectId, context);
  if (query.projectCode && context.projectAccessMode !== 'ALL' && !context.projectCodes?.has(query.projectCode)) {
    throw new IntegrationApiError(403, 'PROJECT_NOT_ALLOWED', 'O projeto solicitado não está autorizado.');
  }
  return true;
}

function normalizedFilters(query) {
  return {
    ...(query.updatedSince ? { updatedSince: new Date(query.updatedSince).toISOString() } : {}),
    ...(query.projectCode ? { projectCode: query.projectCode } : {}),
    ...(query.projectId ? { projectId: query.projectId } : {}),
    ...(query.natureId ? { natureId: query.natureId } : {}),
    ...(query.eventDateFrom ? { eventDateFrom: query.eventDateFrom } : {}),
    ...(query.eventDateTo ? { eventDateTo: query.eventDateTo } : {}),
    ...(query.status?.length ? { status: [...query.status].sort() } : {}),
    ...(query.type?.length ? { type: [...query.type].sort() } : {}),
    includeDeleted: Boolean(query.includeDeleted)
  };
}

async function recurrenceForRows(client, rows, context) {
  const natureIds = [...new Set(rows.map(row => row.natureId).filter(Boolean))];
  const eventTimes = rows.map(row => new Date(row.eventDate).getTime()).filter(Number.isFinite);
  if (!natureIds.length || !eventTimes.length) return new Map();
  const from = new Date(Math.min(...eventTimes));
  from.setUTCMonth(from.getUTCMonth() - 12);
  const to = new Date(Math.max(...eventTimes));
  const candidates = await client.qualityRecord.findMany({
    where: {
      deletedAt: null,
      natureId: { in: natureIds },
      eventDate: { gte: from, lte: to },
      ...(context.projectAccessMode === 'SELECTED' ? { projectId: { in: [...context.projectIds] } } : {})
    },
    select: { id: true, natureId: true, eventDate: true }
  });
  return calculateQualityRecurrence(candidates);
}

export async function listIntegrationQualityRecords(client, query, context) {
  const requestedLimit = Number(query.limit) || 100;
  const maxPageSize = Math.min(context.maxPageSize || 500, 500);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > maxPageSize) {
    throw new IntegrationApiError(400, 'INVALID_LIMIT', `O limite por página deve estar entre 1 e ${maxPageSize}.`);
  }
  if (query.includeDeleted && !context.scopes.has('qualidade.excluidos.read')) {
    throw new IntegrationApiError(403, 'INSUFFICIENT_SCOPE', 'O escopo de excluídos é obrigatório.');
  }
  assertProjectFilterAllowed(query, context);

  const filters = normalizedFilters(query);
  let snapshotAt = query.snapshotAt || query.updatedUntil ? new Date(query.snapshotAt || query.updatedUntil) : new Date(context.snapshotAt || new Date());
  let position = null;
  if (query.cursor) {
    const cursor = readSignedCursor({ cursor: query.cursor, key: context.cursorKey, operationId: 'quality.records.list', filters });
    if (query.snapshotAt && new Date(query.snapshotAt).toISOString() !== cursor.snapshotAt) {
      throw new IntegrationApiError(400, 'INVALID_CURSOR', 'O snapshot não corresponde ao cursor.');
    }
    snapshotAt = new Date(cursor.snapshotAt);
    position = cursor.position;
  }
  if (Number.isNaN(snapshotAt.getTime())) throw new IntegrationApiError(400, 'INVALID_SNAPSHOT', 'Snapshot inválido.');

  const accessWhere = context.projectAccessMode === 'SELECTED' ? { projectId: { in: [...context.projectIds] } } : {};
  const where = {
    ...accessWhere,
    ...(!query.includeDeleted ? { deletedAt: null } : {}),
    updatedAt: {
      lte: snapshotAt,
      ...(query.updatedSince ? { gte: new Date(query.updatedSince) } : {})
    },
    ...(query.projectCode ? { project: { code: query.projectCode } } : {}),
    ...(query.projectId ? { projectId: query.projectId } : {}),
    ...(query.natureId ? { natureId: query.natureId } : {}),
    ...((query.eventDateFrom || query.eventDateTo) ? { eventDate: {
      ...(query.eventDateFrom ? { gte: new Date(`${query.eventDateFrom}T00:00:00.000Z`) } : {}),
      ...(query.eventDateTo ? { lte: new Date(`${query.eventDateTo}T23:59:59.999Z`) } : {})
    } } : {}),
    ...(query.status?.length ? { status: { in: query.status } } : {}),
    ...(query.type?.length ? { type: { in: query.type } } : {}),
    ...(position ? { OR: [
      { updatedAt: { gt: new Date(position.updatedAt), lte: snapshotAt } },
      { updatedAt: new Date(position.updatedAt), id: { gt: position.id } }
    ] } : {})
  };
  const rows = await client.qualityRecord.findMany({
    where,
    select: QUALITY_RECORD_PUBLIC_SELECT,
    orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    take: requestedLimit + 1
  });
  const hasMore = rows.length > requestedLimit;
  const pageRows = rows.slice(0, requestedLimit);
  const recurrence = await recurrenceForRows(client, pageRows, context);
  const last = pageRows.at(-1);
  const nextCursor = hasMore && last ? createSignedCursor({
    key: context.cursorKey,
    payload: {
      operationId: 'quality.records.list', version: 1, filters,
      position: { updatedAt: new Date(last.updatedAt).toISOString(), id: last.id },
      snapshotAt: snapshotAt.toISOString()
    }
  }) : null;
  return {
    items: pageRows.map(row => publicQualityRecord(row, { scopes: context.scopes, recurrence: recurrence.get(row.id) })),
    page: { nextCursor, limit: requestedLimit, hasMore, snapshotAt: snapshotAt.toISOString() }
  };
}

export async function getIntegrationQualityRecord(client, id, { includeDeleted = false } = {}, context) {
  if (includeDeleted && !context.scopes.has('qualidade.excluidos.read')) {
    throw new IntegrationApiError(403, 'INSUFFICIENT_SCOPE', 'O escopo de excluídos é obrigatório.');
  }
  const row = await client.qualityRecord.findFirst({
    where: {
      id,
      ...(!includeDeleted ? { deletedAt: null } : {}),
      ...(context.projectAccessMode === 'SELECTED' ? { projectId: { in: [...context.projectIds] } } : {})
    },
    select: QUALITY_RECORD_PUBLIC_SELECT
  });
  if (!row) throw new IntegrationApiError(404, 'NOT_FOUND', 'Registro de qualidade não encontrado.');
  const recurrence = await recurrenceForRows(client, [row], context);
  return publicQualityRecord(row, { scopes: context.scopes, recurrence: recurrence.get(row.id) });
}
