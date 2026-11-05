import { createHash } from 'node:crypto';
import { z } from 'zod';

import { IntegrationApiError } from '../../middleware/api-request-context.js';
import { mondayOf } from '../efetivo/allocation-review/read-model.js';
import { projectChannelWhere } from '../projects/distribution.js';
import { createSignedCursor, readSignedCursor, stableJson } from './cursor.js';

export const ALLOCATION_REVIEW_OPERATION = 'efetivo.allocationReview.list';
export const ALLOCATION_REVIEW_SCOPE = 'efetivo.conferencia.read';

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

function serializeDay(day) {
  return {
    id: day.id,
    date: dateKey(day.workDate),
    kind: day.kind,
    collaborator: {
      id: day.collaborator.id, code: day.collaborator.code,
      name: day.collaborator.name, registrationNumber: day.collaborator.registrationNumber
    },
    projects: day.projects.map(({ project }) => {
      const digits = String(project.clientCnpj || '').replace(/\D/g, '');
      return {
        id: project.id, code: project.code, name: project.name,
        clientName: project.clientName,
        clientCnpj: digits.length === 14 ? digits : null
      };
    }),
    confirmedAt: new Date(day.row.confirmedAt).toISOString(),
    weekStart: dateKey(day.row.week.weekStart),
    weekVersion: day.row.week.version,
    updatedAt: new Date(day.updatedAt).toISOString()
  };
}

export async function listConfirmedAllocations(client, input, context) {
  const query = validateAllocationReviewQuery(input, context);
  const filters = { from: query.from, to: query.to, collaboratorId: query.collaboratorId || null,
    credentialId: context.credentialId };
  const cursor = query.cursor ? readSignedCursor({ cursor: query.cursor, key: context.cursorKey,
    operationId: ALLOCATION_REVIEW_OPERATION, filters, positionKeys: ['date', 'collaboratorId', 'revision'] }) : null;
  const range = { gte: dateOf(query.from), lte: dateOf(query.to) };
  const confirmed = { workDate: range, row: { confirmedAt: { not: null } },
    ...(query.collaboratorId ? { collaboratorId: query.collaboratorId } : {}) };

  // Cada página lê revisões e dados no mesmo snapshot do banco. Se houver edição,
  // confirmação/desconfirmação ou mudança dos cadastros entre páginas, o cliente
  // deve recomeçar o período para não aplicar uma importação parcial/inconsistente.
  return client.$transaction(async database => {
    const weeks = await database.allocationReviewWeek.findMany({
      where: { weekStart: { gte: dateOf(mondayOf(query.from)), lte: dateOf(query.to) } },
      select: { id: true, version: true }, orderBy: { weekStart: 'asc' }
    });
    // O hash usa os campos publicados, não apenas MAX(updatedAt): duas edições
    // concorrentes podem confirmar em ordem diferente de seus timestamps.
    const collaborators = await database.collaborator.findMany({
      where: { allocationReviewDays: { some: confirmed } },
      select: { id: true, code: true, name: true, registrationNumber: true }, orderBy: { id: 'asc' }
    });
    const projects = await database.project.findMany({
      where: { AND: [projectChannelWhere('api'), { allocationReviewDayProjects: { some: { day: confirmed } } }] },
      select: { id: true, code: true, name: true, clientName: true, clientCnpj: true }, orderBy: { id: 'asc' }
    });
    const revision = createHash('sha256').update(stableJson({ weeks, collaborators, projects })).digest('hex');
    if (cursor && cursor.position.revision !== revision) {
      throw new IntegrationApiError(409, 'ALLOCATION_REVIEW_CHANGED', 'Os dados foram alterados. Reinicie a consulta do período sem cursor.');
    }
    const rows = await database.allocationReviewDay.findMany({
      where: {
        ...confirmed,
        // Não publicar parte de um dia com múltiplos projetos nem expor projetos
        // excluídos ou que não foram disponibilizados para a API.
        projects: { every: { project: projectChannelWhere('api') } },
        ...(cursor ? { OR: [
          { workDate: { gt: dateOf(cursor.position.date) } },
          { workDate: dateOf(cursor.position.date), collaboratorId: { gt: cursor.position.collaboratorId } }
        ] } : {})
      },
      select: {
        id: true, workDate: true, kind: true, updatedAt: true, collaboratorId: true,
        collaborator: { select: { id: true, code: true, name: true, registrationNumber: true } },
        row: { select: { confirmedAt: true, week: { select: { weekStart: true, version: true } } } },
        projects: { orderBy: { projectId: 'asc' }, select: { project: { select: {
          id: true, code: true, name: true, clientName: true, clientCnpj: true
        } } } }
      },
      orderBy: [{ workDate: 'asc' }, { collaboratorId: 'asc' }], take: query.limit + 1
    });
    const pageRows = rows.slice(0, query.limit);
    const hasMore = rows.length > query.limit;
    const last = pageRows.at(-1);
    const snapshotAt = cursor?.snapshotAt || new Date(context.snapshotAt || new Date()).toISOString();
    const nextCursor = hasMore ? createSignedCursor({ key: context.cursorKey, payload: {
      version: 1, operationId: ALLOCATION_REVIEW_OPERATION, filters, snapshotAt,
      position: { date: dateKey(last.workDate), collaboratorId: last.collaboratorId, revision }
    } }) : null;
    return { items: pageRows.map(serializeDay), page: { limit: query.limit, hasMore, nextCursor, snapshotAt } };
  }, { isolationLevel: 'RepeatableRead' });
}
