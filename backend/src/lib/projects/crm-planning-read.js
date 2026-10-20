import { z } from 'zod';
import { IntegrationApiError } from '../../middleware/api-request-context.js';
import { createSignedCursor, readSignedCursor } from '../api-credentials/cursor.js';
import { opportunityWhere, planningNamespace } from './crm-planning-schema.js';

const querySchema = z.object({ after: z.string().min(1).max(4096).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(), updatedSince: z.iso.datetime({ offset: true }).optional() }).strict();
const include = { targetProject: { select: { code: true } }, project: { select: { code: true } } };
export const validatePlanningListQuery = input => querySchema.parse(input);
export function validatePlanningDetailParams(params, query = {}) {
  if (Object.keys(query).length) throw new IntegrationApiError(400, 'UNKNOWN_PARAMETER', 'A consulta de oportunidade não aceita filtros.');
  return z.object({ externalId: z.string().min(1).max(180) }).strict().parse(params);
}
export function validatePlanningReadAccess(credential) {
  if (credential.projectAccessMode !== 'ALL') throw new IntegrationApiError(403, 'PROJECT_NOT_ALLOWED', 'Oportunidades sem projeto exigem acesso ALL.');
}
function serialize(record) {
  return { externalId: record.externalId, accompanimentId: record.id, projectId: record.projectId,
    targetProjectId: record.targetProjectId, prismaMissionId: record.prismaMissionId,
    projectNumber: record.project?.code ?? record.targetProject?.code ?? record.snapshot?.opportunity.project?.number ?? null,
    numberScope: record.snapshot?.opportunity.project?.numberScope ?? null,
    currentSourceVersion: Number(record.sourceVersion), currentEventId: record.currentEventId, canonicalHash: record.payloadHash,
    projectLinkStatus: record.projectLinkStatus, projectLinkReason: record.projectLinkReason,
    commercialStatus: record.commercialStatus, planningRequested: record.planningRequested,
    sourceRecordDeleted: record.sourceRecordDeleted, updatedAt: record.updatedAt.toISOString() };
}
export async function getCrmPlanningState(database, externalId, envConfig) {
  const record = await database.crmOpportunity.findUnique({ where: opportunityWhere({ ...planningNamespace(envConfig), externalId }), include });
  if (!record) throw new IntegrationApiError(404, 'NOT_FOUND', 'Oportunidade não encontrada neste ambiente.');
  return serialize(record);
}
export async function listCrmPlanningStates(database, rawQuery, { envConfig, maxPageSize, cursorKey, now = new Date() }) {
  const query = validatePlanningListQuery(rawQuery);
  const limit = query.limit ?? Math.min(100, maxPageSize);
  if (limit > maxPageSize) throw new IntegrationApiError(400, 'INVALID_LIMIT', 'Limite superior ao autorizado pela credencial.');
  const ns = planningNamespace(envConfig);
  const filters = { ...ns, updatedSince: query.updatedSince || null };
  const cursor = query.after ? readSignedCursor({ cursor: query.after, key: cursorKey, operationId: 'acompanhamento.opportunities.links.list', filters }) : null;
  const stamp = z.iso.datetime({ offset: true });
  if (cursor && (!stamp.safeParse(cursor.snapshotAt).success || !stamp.safeParse(cursor.position.updatedAt).success)) {
    throw new IntegrationApiError(400, 'INVALID_CURSOR', 'Cursor inválido.');
  }
  const snapshotAt = cursor ? new Date(cursor.snapshotAt) : now;
  const after = cursor?.position;
  const rows = await database.crmOpportunity.findMany({ where: { ...ns,
    updatedAt: { lte: snapshotAt, ...(query.updatedSince ? { gte: new Date(query.updatedSince) } : {}) },
    ...(after ? { OR: [{ updatedAt: { gt: new Date(after.updatedAt) } }, { updatedAt: new Date(after.updatedAt), id: { gt: after.id } }] } : {}) },
    include, orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], take: limit + 1 });
  const selected = rows.slice(0, limit);
  const last = selected.at(-1);
  return { items: selected.map(serialize), page: {
    hasMore: rows.length > limit, snapshotAt: snapshotAt.toISOString(),
    reconcileFrom: new Date(snapshotAt.getTime() - 60_000).toISOString(),
    nextCursor: rows.length > limit ? createSignedCursor({ key: cursorKey, payload: { version: 1,
      operationId: 'acompanhamento.opportunities.links.list', filters, snapshotAt: snapshotAt.toISOString(),
      position: { updatedAt: last.updatedAt.toISOString(), id: last.id } } }) : null
  } };
}
