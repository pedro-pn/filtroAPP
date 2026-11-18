import { collaboratorVisibilityWhere } from '../collaborators/workforce-policy.js';
import { workforceVisibilityClasses } from '../collaborators/workforce-visibility-context.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';

import { IntegrationApiError } from '../../middleware/api-request-context.js';
import { assembleReviewWeek, loadReviewRangeContexts } from '../efetivo/allocation-review/read-model.js';
import { getAllocationTrailsForRange } from '../acompanhamento/allocation-audit.js';
import { withAllocationReviewSources } from '../projects/access-scope.js';
import { projectChannelWhere } from '../projects/distribution.js';
import { createSignedCursor, readSignedCursor, stableJson } from './cursor.js';

export const ALLOCATION_REVIEW_OPERATION = 'efetivo.allocationReview.list';
export const ALLOCATION_REVIEW_SCOPE = 'efetivo.conferencia.read';
export const ALLOCATION_REVIEW_SCHEMA_VERSION = '2.0';

const DAY_MS = 86400000;
const dateOf = value => new Date(`${value}T00:00:00.000Z`);
const dateKey = value => new Date(value).toISOString().slice(0, 10);
const querySchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  collaboratorId: z.string().trim().min(1).max(100).optional(),
  limit: z.union([z.number(), z.string().regex(/^\d+$/)]).pipe(z.coerce.number().int().min(1).max(500)).optional(),
  cursor: z.string().min(1).max(4096).optional()
}).strict().refine(query => {
  const days = (dateOf(query.to) - dateOf(query.from)) / DAY_MS;
  return days >= 0 && days < 93;
}, 'Informe um período de até 93 dias, com início anterior ou igual ao fim.');

export function validateAllocationReviewQuery(input, context) {
  if (!context.scopes?.has(ALLOCATION_REVIEW_SCOPE)) {
    throw new IntegrationApiError(403, 'INSUFFICIENT_SCOPE', 'A credencial não possui o escopo necessário.');
  }
  // Dias na sede e afastamentos não pertencem a um projeto: um recorte por projetos
  // não autoriza a leitura do calendário completo das pessoas.
  if (context.projectAccessMode !== 'ALL') {
    throw new IntegrationApiError(403, 'PROJECT_NOT_ALLOWED', 'A conferência de alocação exige acesso a todos os projetos.');
  }
  const query = querySchema.parse(input);
  const max = Math.min(context.maxPageSize || 100, 500);
  query.limit ??= Math.min(100, max);
  if (query.limit > max) throw new IntegrationApiError(400, 'INVALID_LIMIT', `O limite por página deve estar entre 1 e ${max}.`);
  return query;
}

function serializeDay(day, collaborator, projects) {
  const confirmedAt = day.confirmedAt ? new Date(day.confirmedAt).toISOString() : null;
  return {
    id: day.id,
    date: day.date,
    kind: day.kind,
    collaborator: {
      id: collaborator.id, code: collaborator.code,
      name: collaborator.name, registrationNumber: collaborator.registrationNumber
    },
    projects: day.projectIds.map(id => projects.get(id)).map(project => {
      const digits = String(project.clientCnpj || '').replace(/\D/g, '');
      return {
        id: project.id, code: project.code, name: project.name,
        clientName: project.clientName,
        clientCnpj: digits.length === 14 ? digits : null
      };
    }),
    confirmationStatus: confirmedAt ? 'CONFIRMED' : 'PENDING',
    confirmedAt,
    weekStart: day.weekStart,
    weekVersion: day.weekVersion,
    updatedAt: day.updatedAt ? new Date(day.updatedAt).toISOString() : null
  };
}

export async function listReviewAllocations(client, input, context, deps = {}) {
  const query = validateAllocationReviewQuery(input, context);
  const filters = { from: query.from, to: query.to, collaboratorId: query.collaboratorId || null,
    workforceClassifications: workforceVisibilityClasses('API'),
    reviewWorkforceClassifications: workforceVisibilityClasses('ALLOCATION_REVIEW'),
    schemaVersion: ALLOCATION_REVIEW_SCHEMA_VERSION, credentialId: context.credentialId };
  const cursor = query.cursor ? readSignedCursor({ cursor: query.cursor, key: context.cursorKey,
    operationId: ALLOCATION_REVIEW_OPERATION, filters, positionKeys: ['date', 'collaboratorId', 'revision'] }) : null;
  const range = { gte: dateOf(query.from), lte: dateOf(query.to) };
  const savedWhere = { workDate: range, collaborator: collaboratorVisibilityWhere('API'),
    ...(query.collaboratorId ? { collaboratorId: query.collaboratorId } : {}) };

  // Cada página lê revisões e dados no mesmo snapshot do banco. Se houver edição,
  // confirmação/desconfirmação ou mudança dos cadastros entre páginas, o cliente
  // deve recomeçar o período para não aplicar uma importação parcial/inconsistente.
  return client.$transaction(async database => {
    const [contexts, savedDays] = await withAllocationReviewSources(() => Promise.all([
      loadReviewRangeContexts({ from: query.from, to: query.to,
        collaboratorIds: query.collaboratorId ? [query.collaboratorId] : null }, {
        ...deps, database,
        getTrails: deps.getTrails || (range => getAllocationTrailsForRange(range, { database }))
      }),
      database.allocationReviewDay.findMany({
        where: savedWhere,
        select: {
          id: true, workDate: true, kind: true, updatedAt: true, collaboratorId: true,
          row: { select: { confirmedAt: true, week: { select: { weekStart: true, version: true } } } },
          projects: { select: { projectId: true } }
        }
      })
    ]));
    const days = new Map();
    // Preserva o histórico persistido mesmo quando o vínculo hoje está inativo.
    for (const day of savedDays) days.set(`${day.collaboratorId}|${dateKey(day.workDate)}`, {
      id: day.id, collaboratorId: day.collaboratorId, date: dateKey(day.workDate), kind: day.kind,
      projectIds: day.projects.map(item => item.projectId).sort(), confirmedAt: day.row.confirmedAt,
      weekStart: dateKey(day.row.week.weekStart), weekVersion: day.row.week.version, updatedAt: day.updatedAt
    });
    const now = new Date(context.snapshotAt || new Date());
    for (const source of contexts) {
      const week = assembleReviewWeek(source, { now });
      for (const row of week.rows) for (const day of row.days) {
        if (!day.eligible || !day.value || day.date < query.from || day.date > query.to) continue;
        const key = `${row.collaborator.id}|${day.date}`;
        if (days.has(key)) continue;
        days.set(key, {
          id: `automatic:${row.collaborator.id}:${day.date}`, collaboratorId: row.collaborator.id,
          date: day.date, kind: day.value.kind, projectIds: [...day.value.projectIds].sort(),
          // Uma sugestão não persistida nunca herda a confirmação da linha.
          confirmedAt: null, weekStart: week.week.weekStart, weekVersion: week.week.version, updatedAt: null
        });
      }
    }
    const [collaborators, projects] = await Promise.all([
      database.collaborator.findMany({
        where: { AND: [{ id: { in: [...new Set([...days.values()].map(day => day.collaboratorId))] } }, collaboratorVisibilityWhere('API')] },
        select: { id: true, code: true, name: true, registrationNumber: true }
      }),
      database.project.findMany({
        where: { AND: [{ id: { in: [...new Set([...days.values()].flatMap(day => day.projectIds))] } }, projectChannelWhere('api')] },
        select: { id: true, code: true, name: true, clientName: true, clientCnpj: true }
      })
    ]);
    const collaboratorById = new Map(collaborators.map(item => [item.id, item]));
    const projectById = new Map(projects.map(item => [item.id, item]));
    const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
    const items = [...days.values()]
      // Omitir o dia inteiro impede exportação parcial de múltiplos projetos.
      .filter(day => collaboratorById.has(day.collaboratorId) && day.projectIds.every(id => projectById.has(id)))
      .sort((a, b) => compare(a.date, b.date) || compare(a.collaboratorId, b.collaboratorId))
      .map(day => serializeDay(day, collaboratorById.get(day.collaboratorId), projectById));
    // Inclui o resultado automático: ponto, RDO, ausência, calendário e planejamento
    // podem mudar sem incrementar a versão de uma semana ainda não conferida.
    const weeks = contexts.map(source => ({ weekStart: source.weekStart, version: source.savedWeek?.version || 0 }));
    const revision = createHash('sha256').update(stableJson({ weeks, items })).digest('hex');
    if (cursor && cursor.position.revision !== revision) {
      throw new IntegrationApiError(409, 'ALLOCATION_REVIEW_CHANGED', 'Os dados foram alterados. Reinicie a consulta do período sem cursor.');
    }
    const rows = cursor ? items.filter(day => compare(day.date, cursor.position.date) > 0
      || (day.date === cursor.position.date && compare(day.collaborator.id, cursor.position.collaboratorId) > 0)) : items;
    const pageRows = rows.slice(0, query.limit);
    const hasMore = rows.length > query.limit;
    const last = pageRows.at(-1);
    const snapshotAt = cursor?.snapshotAt || new Date(context.snapshotAt || new Date()).toISOString();
    const nextCursor = hasMore ? createSignedCursor({ key: context.cursorKey, payload: {
      version: 1, operationId: ALLOCATION_REVIEW_OPERATION, filters, snapshotAt,
      position: { date: last.date, collaboratorId: last.collaborator.id, revision }
    } }) : null;
    return { items: pageRows, page: { limit: query.limit, hasMore, nextCursor, snapshotAt } };
  }, { isolationLevel: 'RepeatableRead', timeout: 60_000 });
}
