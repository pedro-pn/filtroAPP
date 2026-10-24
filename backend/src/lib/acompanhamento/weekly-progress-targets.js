import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import prisma from '../prisma.js';
import { dateOnlyKey, weekStartKey, weeklyTargetGoalMetric, weeklyTargetScenarioSettings, effectiveWeeklyProgressTarget, weeklyTargetCountingDays } from '../../../../shared/modules/mission-weekly-progress.js';

const preciseValue = z.number().min(0, 'A meta não pode ser negativa.').max(999999999.99)
  .refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 1e-5, 'Use no máximo duas casas decimais.');
const metricSchema = z.enum(['PCT_POINTS', 'M', 'L', 'UN', 'COLLABORATORS']);
const basisSchema = z.enum(['WEEK_TOTAL', 'PER_PRODUCTIVE_DAY', 'PER_WORKDAY']);
const referenceHoursSchema = preciseValue.pipe(z.number().min(0.01).max(24));
const workdaysSchema = z.array(z.number().int().min(0).max(6)).min(1).max(7);
const conditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ALWAYS') }).strict(),
  z.object({ kind: z.literal('SERVICE_COUNT'), count: z.number().int().min(1).max(4) }).strict(),
  z.object({ kind: z.literal('SERVICE_SET'), serviceTypes: z.array(z.enum(['LIMPEZA_QUIMICA', 'TESTE_PRESSAO', 'FLUSHING', 'FILTRAGEM'])).min(1).max(4) }).strict()
]);
const legacyDefinitionSchema = z.object({
  metric: metricSchema,
  basis: basisSchema.default('WEEK_TOTAL'),
  referenceDayHours: referenceHoursSchema.optional(),
  workdays: workdaysSchema.optional(),
  repeatWeekly: z.boolean().optional(),
  countingStartDay: z.number().int().min(0).max(6).optional(),
  countingEndDay: z.number().int().min(0).max(6).optional(),
  scenarios: z.array(z.object({
    name: z.string().trim().min(1).max(100),
    metric: metricSchema.optional(),
    basis: basisSchema.optional(),
    referenceDayHours: referenceHoursSchema.optional(),
    workdays: workdaysSchema.optional(),
    condition: conditionSchema,
    goals: z.array(z.object({
      serviceType: z.enum(['LIMPEZA_QUIMICA', 'TESTE_PRESSAO', 'FLUSHING', 'FILTRAGEM']).nullable().default(null),
      value: preciseValue
    }).strict()).min(1).max(100)
  }).strict()).min(1).max(20)
}).strict().superRefine((definition, ctx) => {
  const fail = message => ctx.addIssue({ code: 'custom', message });
  if ((definition.countingStartDay == null) !== (definition.countingEndDay == null)) fail('Informe o dia inicial e o dia final da contagem.');
  const conditions = new Set();
  for (const scenario of definition.scenarios) {
    const { condition, goals } = scenario;
    const { metric, basis, referenceDayHours, workdays } = weeklyTargetScenarioSettings(definition, scenario);
    if (metric === 'COLLABORATORS') {
      if (workdays && !workdays.some(day => weeklyTargetCountingDays(definition).includes(day))) fail('Selecione ao menos um dia de presença dentro do período de contagem.');
      if (basis !== 'PER_WORKDAY' || referenceDayHours != null || !workdays
        || new Set(workdays).size !== workdays.length || goals.length !== 1 || goals[0].serviceType != null
        || !Number.isInteger(goals[0].value) || goals[0].value < 1
        || (scenario.metric == null && (definition.scenarios.length !== 1 || condition.kind !== 'ALWAYS'))) {
        fail('Defina uma quantidade inteira positiva de colaboradores por dia, os dias de trabalho e uma meta geral, sem vínculo com serviços ou horas produtivas.');
      }
    } else if (basis === 'PER_WORKDAY' || workdays != null) {
      fail('Os dias de trabalho e a base diária de presença são exclusivos da meta de colaboradores.');
    }
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
    if (basis === 'WEEK_TOTAL' && referenceDayHours != null) fail('A jornada de referência é usada em metas por colaborador/dia.');
    if (basis === 'WEEK_TOTAL' && goals.some(goal => weeklyTargetGoalMetric(metric, goal, condition) === 'UN' && !Number.isInteger(goal.value))) fail('Metas totais de unidades de sistema devem ser inteiras.');
    if (metric === 'PCT_POINTS' && (goals.length !== 1 || ids.some(Boolean) || goals.some(goal => goal.value > 100) || basis !== 'WEEK_TOTAL'
      || (scenario.metric == null && (definition.scenarios.length !== 1 || condition.kind !== 'ALWAYS')))) {
      fail('Avanço percentual usa uma meta geral de 0 a 100 p.p., para a missão inteira.');
    }
  }
});

const serviceTypeSchema = z.enum(['LIMPEZA_QUIMICA', 'TESTE_PRESSAO', 'FLUSHING', 'FILTRAGEM']);
const positiveValue = preciseValue.refine(value => value > 0, 'Informe um valor maior que zero.');
const goalListSchema = z.object({
  version: z.literal(2),
  logic: z.enum(['ALL', 'ANY']).default('ALL'),
  repeatWeekly: z.boolean().optional(),
  countingStartDay: z.number().int().min(0).max(6).optional(),
  countingEndDay: z.number().int().min(0).max(6).optional(),
  goals: z.array(z.discriminatedUnion('kind', [
    // serviceType null = qualquer serviço: soma a medida de todos os serviços da semana.
    z.object({ kind: z.literal('SERVICE'), serviceType: serviceTypeSchema.nullable(), metric: z.enum(['M', 'L', 'UN']),
      basis: z.enum(['WEEK_TOTAL', 'PER_PRODUCTIVE_DAY']), value: positiveValue }).strict(),
    z.object({ kind: z.literal('PROGRESS'), value: positiveValue.pipe(z.number().max(100, 'O avanço semanal deve ser de até 100 p.p.')) }).strict(),
    z.object({ kind: z.literal('ATTENDANCE'), value: z.number().int('Informe um número inteiro de colaboradores.').min(1), workdays: workdaysSchema }).strict()
  ])).min(1, 'Adicione ao menos uma meta.').max(6, 'Use no máximo 6 metas.')
}).strict().superRefine((definition, ctx) => {
  const fail = message => ctx.addIssue({ code: 'custom', message });
  if ((definition.countingStartDay == null) !== (definition.countingEndDay == null)) fail('Informe o dia inicial e o dia final da contagem.');
  const services = definition.goals.filter(goal => goal.kind === 'SERVICE');
  if (new Set(services.map(goal => goal.serviceType)).size !== services.length) fail('Use uma linha por tipo de serviço (e uma só para qualquer serviço).');
  for (const kind of ['PROGRESS', 'ATTENDANCE']) if (definition.goals.filter(goal => goal.kind === kind).length > 1) fail('Use apenas uma meta de avanço e uma de equipe mínima.');
  for (const goal of services) {
    if (goal.serviceType && (goal.serviceType === 'FILTRAGEM') !== (goal.metric === 'L')) fail('Filtragem usa litros; os demais serviços usam metros ou unidades.');
    if (goal.metric === 'UN' && goal.basis === 'WEEK_TOTAL' && !Number.isInteger(goal.value)) fail('Metas totais de unidades de sistema devem ser inteiras.');
  }
  const attendance = definition.goals.find(goal => goal.kind === 'ATTENDANCE');
  if (attendance && (new Set(attendance.workdays).size !== attendance.workdays.length
    || !attendance.workdays.some(day => weeklyTargetCountingDays(definition).includes(day)))) fail('Os dias de trabalho do projeto precisam estar dentro do período de contagem.');
});

// Metas antigas (cenários) continuam válidas; as novas usam a lista de metas.
export const weeklyTargetDefinitionSchema = z.unknown().transform((value, ctx) => {
  const parsed = (value?.version === 2 ? goalListSchema : legacyDefinitionSchema).safeParse(value);
  if (parsed.success) return parsed.data;
  for (const issue of parsed.error.issues) ctx.addIssue({ ...issue, code: 'custom', message: issue.message });
  return z.NEVER;
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
  expectedRevision: z.number().int().min(0)
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

export const weeklyTargetsNeedAttendance = targets => targets.some(target => target.definition?.metric === 'COLLABORATORS'
  || target.definition?.scenarios?.some(scenario => scenario.metric === 'COLLABORATORS')
  || target.definition?.goals?.some(goal => goal.kind === 'ATTENDANCE'));

// Dias de trabalho da meta de equipe mínima: segunda a sexta, mais sábado e domingo
// quando alguma missão (ou membro do agrupamento) os inclui no cadastro do projeto.
export async function weeklyTargetWorkdays(owner, { client = prisma } = {}) {
  const projectIds = await weeklyTargetProjectIds(owner, client);
  const projects = projectIds.length ? await client.project.findMany({
    where: { id: { in: projectIds }, deletedAt: null }, select: { includesSaturday: true, includesSunday: true }
  }) : [];
  return [1, 2, 3, 4, 5, ...(projects.some(project => project.includesSaturday) ? [6] : []), ...(projects.some(project => project.includesSunday) ? [0] : [])];
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
  if (!latest) {
    const inherited = effectiveWeeklyProgressTarget(await listWeeklyProgressTargets(owner, { client }), payload.weekStartDate);
    if (!inherited) throw weeklyTargetError('Meta não encontrada.', 404);
  }
  const conflict = () => weeklyTargetError('Esta meta foi alterada por outra pessoa. Confira o histórico atualizado e tente novamente.', 409);
  if ((latest?.revision ?? 0) !== payload.expectedRevision) throw conflict();
  if (latest?.isDeleted) throw weeklyTargetError('Esta meta já foi excluída.', 404);
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
