import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import prisma from '../prisma.js';
import { dateOnlyKey, weekStartKey, weeklyTargetGoalMetric } from '../../../../shared/modules/mission-weekly-progress.js';

const preciseValue = z.number().min(0, 'A meta não pode ser negativa.').max(999999999.99)
  .refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 1e-5, 'Use no máximo duas casas decimais.');
const conditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ALWAYS') }).strict(),
  z.object({ kind: z.literal('SERVICE_COUNT'), count: z.number().int().min(1).max(4) }).strict(),
  z.object({ kind: z.literal('SERVICE_SET'), serviceTypes: z.array(z.enum(['LIMPEZA_QUIMICA', 'TESTE_PRESSAO', 'FLUSHING', 'FILTRAGEM'])).min(1).max(4) }).strict()
]);
export const weeklyTargetDefinitionSchema = z.object({
  metric: z.enum(['PCT_POINTS', 'M', 'L', 'UN']),
  basis: z.enum(['WEEK_TOTAL', 'PER_PRODUCTIVE_DAY']).default('WEEK_TOTAL'),
  referenceDayHours: preciseValue.pipe(z.number().min(0.01).max(24)).optional(),
  scenarios: z.array(z.object({
    name: z.string().trim().min(1).max(100),
    condition: conditionSchema,
    goals: z.array(z.object({
      serviceType: z.enum(['LIMPEZA_QUIMICA', 'TESTE_PRESSAO', 'FLUSHING', 'FILTRAGEM']).nullable().default(null),
      value: preciseValue
    }).strict()).min(1).max(100)
  }).strict()).min(1).max(20)
}).strict().superRefine((definition, ctx) => {
  const fail = message => ctx.addIssue({ code: 'custom', message });
  const conditions = new Set();
  for (const scenario of definition.scenarios) {
    const { condition, goals } = scenario;
    const ids = goals.map(goal => goal.serviceType);
    if (new Set(ids).size !== ids.length) fail('Não repita um tipo de serviço no mesmo cenário.');
    if (ids.includes(null) && goals.length > 1) fail('Escolha uma meta geral ou metas por tipo de serviço no cenário.');
    if (condition.kind === 'SERVICE_COUNT' && ids.some(Boolean)) fail('Para uma quantidade de tipos de serviço, use uma meta geral. Para valores individuais, escolha a combinação de serviços.');
    if (condition.kind === 'SERVICE_SET') {
      if (new Set(condition.serviceTypes).size !== condition.serviceTypes.length) fail('Não repita tipos de serviço na condição.');
      if (ids.some(Boolean) && (ids.length !== condition.serviceTypes.length || ids.some(id => !condition.serviceTypes.includes(id)))) {
        fail('Defina uma meta para cada tipo de serviço da combinação.');
      }
    }
    const key = condition.kind === 'SERVICE_SET' ? `SET:${[...condition.serviceTypes].sort().join(',')}`
      : condition.kind === 'SERVICE_COUNT' ? `COUNT:${condition.count}` : 'ALWAYS';
    if (conditions.has(key)) fail('Cada condição deve ter apenas um cenário.');
    conditions.add(key);
    if (definition.basis === 'WEEK_TOTAL' && definition.referenceDayHours != null) fail('A jornada de referência é usada em metas por colaborador/dia.');
    if (definition.basis === 'WEEK_TOTAL' && goals.some(goal => weeklyTargetGoalMetric(definition.metric, goal, condition) === 'UN' && !Number.isInteger(goal.value))) fail('Metas totais de unidades de sistema devem ser inteiras.');
    if (definition.metric === 'PCT_POINTS' && (definition.scenarios.length !== 1 || condition.kind !== 'ALWAYS'
      || ids.some(Boolean) || goals.some(goal => goal.value > 100) || definition.basis !== 'WEEK_TOTAL')) {
      fail('Avanço percentual usa uma única meta geral de 0 a 100 p.p., para a missão inteira.');
    }
  }
});

export const weeklyProgressTargetSchema = z.object({
  weekStartDate: z.string().refine(value => dateOnlyKey(value) === value && weekStartKey(value) === value, 'Informe a segunda-feira de uma semana válida.'),
  plannedPctPoints: z.number().min(0, 'A meta não pode ser negativa.').max(100, 'A meta deve ser de até 100 pontos percentuais.')
    .refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, 'Use no máximo duas casas decimais.').optional(),
  definition: weeklyTargetDefinitionSchema.optional(),
  expectedRevision: z.number().int().min(0).default(0)
}).strict().refine(value => (value.plannedPctPoints !== undefined) !== (value.definition !== undefined),
  'Informe uma meta percentual ou uma definição de cenários.');

export const deleteWeeklyProgressTargetSchema = z.object({
  weekStartDate: weeklyProgressTargetSchema.shape.weekStartDate,
  expectedRevision: z.number().int().min(1)
}).strict();

export function weeklyTargetError(message, status) {
  return Object.assign(new Error(message), { status });
}

function ownerWhere({ projectId, groupId }) {
  if (Boolean(projectId) === Boolean(groupId)) throw weeklyTargetError('Identifique uma missão ou um agrupamento.', 400);
  return projectId ? { projectId } : { groupId };
}

async function assertOwner(client, owner, writing = false) {
  const where = ownerWhere(owner);
  const row = owner.projectId
    ? await client.project.findFirst({ where: { id: owner.projectId, deletedAt: null }, select: { id: true } })
    : await client.acompanhamentoMissionGroup.findFirst({ where: { id: owner.groupId, ...(writing ? { status: 'ACTIVE' } : {}) }, select: { id: true } });
  if (!row) throw weeklyTargetError('Missão não encontrada.', 404);
  return where;
}

function toResponse(row) {
  return {
    id: row.id, weekStartDate: dateOnlyKey(row.weekStartDate), plannedPctPoints: row.plannedPctPoints == null ? null : Number(row.plannedPctPoints),
    ...(row.definition ? { definition: row.definition } : {}), ...(row.isDeleted ? { isDeleted: true } : {}), revision: row.revision,
    author: { id: row.createdByUserId ?? null, name: row.createdByName }, createdAt: row.createdAt
  };
}

export async function weeklyTargetProjectIds(owner, client = prisma) {
  await assertOwner(client, owner);
  if (owner.projectId) return [owner.projectId];
  const members = await client.acompanhamentoMissionGroupMember.findMany({
    where: { groupId: owner.groupId, project: { deletedAt: null } }, select: { projectId: true }
  });
  return members.map(member => member.projectId);
}

// O padrão vem sempre da jornada semanal cadastrada, independente da data da
// meta. Jornadas diferentes dentro de um agrupamento exigem escolha explícita.
export async function weeklyTargetReferenceDayHours(owner, { client = prisma } = {}) {
  const projectIds = await weeklyTargetProjectIds(owner, client);
  if (!projectIds.length) return null;
  const projects = await client.project.findMany({
    where: { id: { in: projectIds }, deletedAt: null }, select: { workdayHours: true }
  });
  const hours = projects.map(project => {
    const match = String(project.workdayHours ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match || +match[2] >= 60) return null;
    const value = Math.round((+match[1] + +match[2] / 60) * 100) / 100;
    return value > 0 && value <= 24 ? value : null;
  });
  return projects.length === projectIds.length && hours.every(value => value != null && value === hours[0]) ? hours[0] : null;
}

export async function listWeeklyProgressTargets(owner, { client = prisma } = {}) {
  const where = await assertOwner(client, owner);
  const rows = await client.missionWeeklyProgressTarget.findMany({ where, orderBy: [{ weekStartDate: 'desc' }, { revision: 'desc' }] });
  return rows.map(toResponse);
}

// Cada edição acrescenta uma revisão; nunca sobrescreve metas de semanas anteriores.
// A restrição única também impede duas gravações concorrentes da mesma revisão.
export async function saveWeeklyProgressTarget(owner, input, { client = prisma, userId, userName } = {}) {
  const payload = weeklyProgressTargetSchema.parse(input);
  if (!userId || !String(userName ?? '').trim()) throw weeklyTargetError('Responsável pela meta não identificado.', 400);
  const where = await assertOwner(client, owner, true);
  const definition = payload.definition ?? null;
  const weekStartDate = new Date(`${payload.weekStartDate}T00:00:00.000Z`);
  const latest = await client.missionWeeklyProgressTarget.findFirst({ where: { ...where, weekStartDate }, orderBy: { revision: 'desc' } });
  const conflict = () => weeklyTargetError('Esta meta foi alterada por outra pessoa. Confira o histórico atualizado e tente novamente.', 409);
  if ((latest?.revision ?? 0) !== payload.expectedRevision) throw conflict();
  if (latest && !latest.isDeleted && (definition
    ? isDeepStrictEqual(latest.definition, definition)
    : !latest.definition && Number(latest.plannedPctPoints) === payload.plannedPctPoints)) return toResponse(latest);
  try {
    const row = await client.missionWeeklyProgressTarget.create({ data: {
      ...where, weekStartDate, plannedPctPoints: payload.plannedPctPoints ?? null, ...(definition ? { definition } : {}), revision: payload.expectedRevision + 1,
      createdByUserId: userId, createdByName: userName.trim()
    } });
    return toResponse(row);
  } catch (error) {
    if (error?.code === 'P2002') throw conflict();
    throw error;
  }
}

// A exclusão é uma nova revisão sem valor. Assim o histórico e a restrição
// única protegem também exclusões concorrentes com uma edição da mesma meta.
export async function deleteWeeklyProgressTarget(owner, input, { client = prisma, userId, userName } = {}) {
  const payload = deleteWeeklyProgressTargetSchema.parse(input);
  if (!userId || !String(userName ?? '').trim()) throw weeklyTargetError('Responsável pela meta não identificado.', 400);
  const where = await assertOwner(client, owner, true);
  const weekStartDate = new Date(`${payload.weekStartDate}T00:00:00.000Z`);
  const latest = await client.missionWeeklyProgressTarget.findFirst({ where: { ...where, weekStartDate }, orderBy: { revision: 'desc' } });
  if (!latest) throw weeklyTargetError('Meta não encontrada.', 404);
  const conflict = () => weeklyTargetError('Esta meta foi alterada por outra pessoa. Confira o histórico atualizado e tente novamente.', 409);
  if (latest.revision !== payload.expectedRevision) throw conflict();
  if (latest.isDeleted) throw weeklyTargetError('Esta meta já foi excluída.', 404);
  try {
    return toResponse(await client.missionWeeklyProgressTarget.create({ data: {
      ...where, weekStartDate, plannedPctPoints: null, isDeleted: true, revision: payload.expectedRevision + 1,
      createdByUserId: userId, createdByName: userName.trim()
    } }));
  } catch (error) {
    if (error?.code === 'P2002') throw conflict();
    throw error;
  }
}
