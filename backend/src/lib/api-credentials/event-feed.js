import { createHash } from 'node:crypto';
import { IntegrationApiError } from '../../middleware/api-request-context.js';
import { createSignedCursor, readSignedCursor, stableJson } from './cursor.js';

export const INTEGRATION_EVENT_RETENTION_DAYS = 30;
export const EVENT_RESOURCE_SCOPES = Object.freeze({
  'rdo.criado': ['rdo.relatorios.todos.read'],
  'rdo.aprovado': ['rdo.relatorios.read', 'rdo.relatorios.todos.read'],
  'rdo.devolvido': ['rdo.relatorios.todos.read'],
  'rdo.assinado': ['rdo.relatorios.todos.read'],
  'workflow.etapa_alterada': ['efetivo.projetos.status.read'],
  'qualidade.criado': ['qualidade.registros.read'],
  'qualidade.alterado': ['qualidade.registros.read'],
  'romaneio.emitido': ['romaneios.itens.read'],
  'projeto.responsaveis_alterados': ['projetos.responsaveis.read']
});

export async function listIntegrationEvents(client, query, context) {
  const now = new Date(context.snapshotAt || new Date());
  const cutoff = new Date(+now - INTEGRATION_EVENT_RETENTION_DAYS * 86400000);
  const filters = { policy: createHash('sha256').update(stableJson({
    credentialId: context.credentialId || null, projectAccessMode: context.projectAccessMode,
    projectIds: context.projectAccessMode === 'SELECTED' ? [...context.projectIds].sort() : [],
    scopes: [...context.scopes].sort()
  })).digest('hex') };
  let sequence = '0';
  if (query.cursor) {
    const cursor = readSignedCursor({ cursor: query.cursor, key: context.cursorKey,
      operationId: 'integration.events.list', filters, positionKeys: ['sequence'] });
    if (!/^\d{1,19}$/.test(cursor.position.sequence) || BigInt(cursor.position.sequence) > 9223372036854775807n
      || !Number.isFinite(Date.parse(cursor.snapshotAt)) || new Date(cursor.snapshotAt) > now) {
      throw new IntegrationApiError(400, 'INVALID_CURSOR', 'Cursor de eventos inválido.');
    }
    const progressAt = new Date(cursor.snapshotAt);
    if (progressAt < cutoff) throw new IntegrationApiError(410, 'CURSOR_EXPIRED', 'Cursor fora da retenção de 30 dias. Reconcilie os recursos e reinicie sem cursor.');
    sequence = cursor.position.sequence;
  }
  const types = Object.entries(EVENT_RESOURCE_SCOPES).filter(([, scopes]) => scopes.some(scope => context.scopes.has(scope))).map(([type]) => type);
  const rows = await client.integrationEvent.findMany({
    where: { sequence: { gt: BigInt(sequence) }, occurredAt: { gte: cutoff }, type: { in: types },
      ...(context.projectAccessMode === 'SELECTED' ? { projectId: { in: [...context.projectIds] } } : {}) },
    orderBy: { sequence: 'asc' }, take: query.limit + 1,
    select: { id: true, sequence: true, type: true, occurredAt: true, projectId: true, projectCode: true, resource: true, resourceId: true }
  });
  const pageRows = rows.slice(0, query.limit);
  const last = pageRows.at(-1);
  const hasMore = rows.length > query.limit;
  // Sem mais páginas, renova a validade até em feed vazio. Não avançar pela
  // sequência global: uma transação ainda não confirmada pode estar em andamento.
  const nextCursor = createSignedCursor({ key: context.cursorKey, payload: {
    version: 1, operationId: 'integration.events.list', filters,
    snapshotAt: (hasMore && last ? new Date(last.occurredAt) : now).toISOString(),
    position: { sequence: last ? String(last.sequence) : sequence }
  } });
  return { items: pageRows.map(row => ({ id: row.id, type: row.type, occurredAt: new Date(row.occurredAt).toISOString(),
    projectId: row.projectId ?? null, projectCode: row.projectCode ?? null, resource: row.resource, resourceId: row.resourceId })),
    page: { limit: query.limit, hasMore, nextCursor, snapshotAt: now.toISOString() } };
}
