import { z } from 'zod';
import prisma from '../prisma.js';
import { dateOnlyKey, weekStartKey } from '../../../../shared/modules/mission-weekly-progress.js';

export const weeklyProgressTargetSchema = z.object({
  weekStartDate: z.string().refine(value => dateOnlyKey(value) === value && weekStartKey(value) === value, 'Informe a segunda-feira de uma semana válida.'),
  plannedPctPoints: z.number().min(0, 'A meta não pode ser negativa.').max(100, 'A meta deve ser de até 100 pontos percentuais.')
    .refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, 'Use no máximo duas casas decimais.'),
  expectedRevision: z.number().int().min(0).default(0)
});

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
    id: row.id, weekStartDate: dateOnlyKey(row.weekStartDate), plannedPctPoints: Number(row.plannedPctPoints), revision: row.revision,
    author: { id: row.createdByUserId ?? null, name: row.createdByName }, createdAt: row.createdAt
  };
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
  const weekStartDate = new Date(`${payload.weekStartDate}T00:00:00.000Z`);
  const latest = await client.missionWeeklyProgressTarget.findFirst({ where: { ...where, weekStartDate }, orderBy: { revision: 'desc' } });
  const conflict = () => weeklyTargetError('Esta meta foi alterada por outra pessoa. Confira o histórico atualizado e tente novamente.', 409);
  if ((latest?.revision ?? 0) !== payload.expectedRevision) throw conflict();
  if (latest && Number(latest.plannedPctPoints) === payload.plannedPctPoints) return toResponse(latest);
  try {
    const row = await client.missionWeeklyProgressTarget.create({ data: {
      ...where, weekStartDate, plannedPctPoints: payload.plannedPctPoints, revision: payload.expectedRevision + 1,
      createdByUserId: userId, createdByName: userName.trim()
    } });
    return toResponse(row);
  } catch (error) {
    if (error?.code === 'P2002') throw conflict();
    throw error;
  }
}
