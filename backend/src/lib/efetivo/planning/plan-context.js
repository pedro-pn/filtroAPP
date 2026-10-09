import { conflictError, notFound } from './errors.js';
import { invalidateCollaboratorDerivedCaches } from '../../cache/invalidation.js';

export async function resolvePlanningDatabase(database) {
  return database || (await import('../../prisma.js')).default;
}

export async function runPlanningTransaction(database, callback, { required = false } = {}) {
  if (required && typeof database?.$transaction !== 'function') throw new Error('O planejamento exige suporte transacional do banco de dados.');
  const result = await (typeof database?.$transaction === 'function' ? database.$transaction(callback) : callback(database));
  // Cronograma, equipe e cargos também alimentam os cards e os custos do Acompanhamento.
  // Limpa somente depois do commit, para o próximo GET refletir a gravação concluída.
  invalidateCollaboratorDerivedCaches();
  return result;
}

export async function lockPlan(tx, planId) {
  if (typeof tx?.$queryRawUnsafe === 'function') {
    await tx.$queryRawUnsafe('SELECT "id" FROM "EfetivoPlan" WHERE "id" = $1 FOR UPDATE', planId);
  }
}

export async function lockOfficialPlanningState(tx) {
  if (typeof tx?.$executeRawUnsafe === 'function') {
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      'efetivo-planning-official'
    );
  }
}

export async function getActiveOfficialPlan(database, { create = true, actorUserId = null } = {}) {
  let plan = await database.efetivoPlan.findFirst({
    where: { kind: 'OFFICIAL', status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' }
  });
  if (!plan && create) {
    const calendarState = await database.workforceCalendarState.findUnique({ where: { id: 'global' } });
    try {
      plan = await database.efetivoPlan.create({
        data: {
          kind: 'OFFICIAL',
          status: 'ACTIVE',
          name: 'Planejamento oficial',
          baseCalendarRevision: calendarState?.revision || 1,
          createdByUserId: actorUserId
        }
      });
    } catch (error) {
      if (error?.code !== 'P2002') throw error;
      plan = await database.efetivoPlan.findFirst({ where: { kind: 'OFFICIAL', status: 'ACTIVE' } });
    }
  }
  return plan;
}

export async function requireEditablePlan(tx, planId, { actorUserId = null } = {}) {
  if (!planId) await lockOfficialPlanningState(tx);
  const plan = planId
    ? await tx.efetivoPlan.findUnique({ where: { id: planId } })
    : await getActiveOfficialPlan(tx, { actorUserId });
  if (!plan) throw notFound('Plano do Efetivo não encontrado.');
  await lockPlan(tx, plan.id);
  const current = await tx.efetivoPlan.findUnique({ where: { id: plan.id } }) || plan;
  const editable = (current.kind === 'OFFICIAL' && current.status === 'ACTIVE')
    || (current.kind === 'SCENARIO' && current.status === 'DRAFT');
  if (!editable) throw conflictError('Este plano está em estado somente leitura.', [], 'PLAN_READ_ONLY');
  return current;
}

export async function bumpPlanRevision(tx, plan) {
  return tx.efetivoPlan.update({ where: { id: plan.id }, data: { revision: { increment: 1 } } });
}

export function requestEvidence(req) {
  return {
    ipAddress: req?.ip || req?.socket?.remoteAddress || null,
    userAgent: String(req?.get?.('user-agent') || req?.headers?.['user-agent'] || '').slice(0, 500) || null
  };
}
