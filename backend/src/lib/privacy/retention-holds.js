// Exceções (legal hold) da retenção LGPD: projetos e colaboradores listados em
// DataRetentionHold nunca são tocados pelo job de retenção. Só administradores
// (painel de Operações). O motivo fica nessa tabela própria, fora das respostas
// genéricas de projeto e colaborador.
import { z } from 'zod';

const KIND_BY_INPUT = { project: 'PROJECT', collaborator: 'COLLABORATOR' };

export const retentionHoldInputSchema = z.object({
  kind: z.enum(['project', 'collaborator']),
  code: z.string().trim().min(1).max(120),
  hold: z.boolean(),
  reason: z.string().trim().max(500).optional().nullable()
}).superRefine((value, ctx) => {
  if (value.hold && (!value.reason || value.reason.length < 3)) {
    ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Informe o motivo da exceção.' });
  }
});

function targetModel(prismaClient, kind) {
  return kind === 'PROJECT' ? prismaClient.project : prismaClient.collaborator;
}

export async function listRetentionHolds(prismaClient) {
  const holds = await prismaClient.dataRetentionHold.findMany({
    orderBy: { createdAt: 'asc' },
    select: { kind: true, targetId: true, reason: true, createdAt: true }
  });
  const result = { projects: [], collaborators: [] };
  for (const kind of ['PROJECT', 'COLLABORATOR']) {
    const ofKind = holds.filter(hold => hold.kind === kind);
    if (!ofKind.length) continue;
    const targets = await targetModel(prismaClient, kind).findMany({
      where: { id: { in: ofKind.map(hold => hold.targetId) } },
      select: { id: true, code: true, name: true }
    });
    const byId = new Map(targets.map(target => [target.id, target]));
    const items = ofKind.map(hold => ({
      id: hold.targetId,
      code: byId.get(hold.targetId)?.code || '—',
      name: byId.get(hold.targetId)?.name || '(removido)',
      reason: hold.reason,
      setAt: hold.createdAt
    }));
    if (kind === 'PROJECT') result.projects = items;
    else result.collaborators = items;
  }
  return result;
}

export async function setRetentionHold(prismaClient, input, { userId = null } = {}) {
  const parsed = retentionHoldInputSchema.parse(input);
  const kind = KIND_BY_INPUT[parsed.kind];
  const target = await targetModel(prismaClient, kind).findUnique({
    where: { code: parsed.code }, select: { id: true, code: true, name: true }
  });
  if (!target) return null;
  const key = { kind_targetId: { kind, targetId: target.id } };
  if (parsed.hold) {
    const hold = await prismaClient.dataRetentionHold.upsert({
      where: key,
      create: { kind, targetId: target.id, reason: parsed.reason, setByUserId: userId },
      update: { reason: parsed.reason, setByUserId: userId }
    });
    return { id: target.id, code: target.code, name: target.name, hold: true, reason: hold.reason, setAt: hold.createdAt };
  }
  await prismaClient.dataRetentionHold.deleteMany({ where: { kind, targetId: target.id } });
  return { id: target.id, code: target.code, name: target.name, hold: false, reason: null, setAt: null };
}
