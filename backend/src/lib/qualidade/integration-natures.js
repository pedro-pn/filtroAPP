import { createSignedCursor, readSignedCursor } from '../api-credentials/cursor.js';
import { IntegrationApiError } from '../../middleware/api-request-context.js';
import { publicQualityNature } from './public-serializer.js';

const NATURE_SELECT = { id: true, name: true, isActive: true, position: true, createdAt: true, updatedAt: true };

export async function listIntegrationQualityNatures(client, query, context) {
  const limit = Number(query.limit) || 100;
  const maxPageSize = Math.min(context.maxPageSize || 500, 500);
  if (!Number.isInteger(limit) || limit < 1 || limit > maxPageSize) {
    throw new IntegrationApiError(400, 'INVALID_LIMIT', `O limite por página deve estar entre 1 e ${maxPageSize}.`);
  }
  const filters = {
    ...(query.updatedSince ? { updatedSince: new Date(query.updatedSince).toISOString() } : {}),
    ...(query.active === undefined ? {} : { active: query.active })
  };
  let snapshotAt = query.snapshotAt ? new Date(query.snapshotAt) : new Date(context.snapshotAt || new Date());
  let position = null;
  if (query.cursor) {
    const decoded = readSignedCursor({ cursor: query.cursor, key: context.cursorKey, operationId: 'quality.natures.list', filters });
    if (query.snapshotAt && new Date(query.snapshotAt).toISOString() !== decoded.snapshotAt) {
      throw new IntegrationApiError(400, 'INVALID_CURSOR', 'O snapshot não corresponde ao cursor.');
    }
    snapshotAt = new Date(decoded.snapshotAt);
    position = decoded.position;
  }
  const rows = await client.qualityNature.findMany({
    where: {
      updatedAt: { lte: snapshotAt, ...(query.updatedSince ? { gte: new Date(query.updatedSince) } : {}) },
      ...(query.active === undefined ? {} : { isActive: query.active }),
      ...(position ? { OR: [
        { updatedAt: { gt: new Date(position.updatedAt), lte: snapshotAt } },
        { updatedAt: new Date(position.updatedAt), id: { gt: position.id } }
      ] } : {})
    },
    select: NATURE_SELECT,
    orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    take: limit + 1
  });
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  return {
    items: pageRows.map(publicQualityNature),
    page: {
      nextCursor: hasMore && last ? createSignedCursor({ key: context.cursorKey, payload: {
        operationId: 'quality.natures.list', version: 1, filters,
        position: { updatedAt: new Date(last.updatedAt).toISOString(), id: last.id }, snapshotAt: snapshotAt.toISOString()
      } }) : null,
      limit,
      hasMore,
      snapshotAt: snapshotAt.toISOString()
    }
  };
}
