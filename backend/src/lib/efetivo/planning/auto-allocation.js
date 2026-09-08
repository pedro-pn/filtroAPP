import { allocateCollaboratorInTransaction, listEligibleCollaborators } from './allocations.js';
import { recordEfetivoAudit } from './audit.js';
import { notFound } from './errors.js';
import { bumpPlanRevision, requireEditablePlan, resolvePlanningDatabase, runPlanningTransaction } from './plan-context.js';

export function rankAutoAllocationCandidates(candidates = []) {
  return [...candidates].sort((left, right) => {
    const admission = String(left.admissionDate || '').localeCompare(String(right.admissionDate || ''));
    return admission || String(left.name || '').localeCompare(String(right.name || ''), 'pt-BR') || String(left.id || '').localeCompare(String(right.id || ''));
  });
}

export async function autoAllocateMission(missionId, context = {}, dependencies = {}) {
  const database = await resolvePlanningDatabase(dependencies.database);
  return runPlanningTransaction(database, async tx => {
    const mission = await tx.efetivoMissionPlan.findUnique({
      where: { id: missionId },
      include: {
        plan: true,
        cycles: { orderBy: { mobilizationDate: 'asc' } },
        demands: { include: { jobRole: true } },
        allocations: { where: { deletedAt: null }, include: { cycles: { orderBy: { mobilizationDate: 'asc' } } } }
      }
    });
    if (!mission || mission.deletedAt) throw notFound('Missão operacional não encontrada.');
    const plan = await requireEditablePlan(tx, mission.planId, { actorUserId: context.actorUserId });
    const created = [];
    const remainingDeficits = [];
    const demands = [...mission.demands].sort((left, right) => left.jobRole.name.localeCompare(right.jobRole.name, 'pt-BR'));
    for (const demand of demands) {
      const already = mission.allocations.filter(item => !item.deletedAt && item.jobRoleId === demand.jobRoleId).length;
      const needed = Math.max(0, demand.requiredCount - already);
      const eligible = await listEligibleCollaborators(mission.id, demand.jobRoleId, { database: tx });
      const allocatedIds = new Set(mission.allocations.filter(item => !item.deletedAt).map(item => item.collaboratorId));
      // A alocação automática não pode assumir uma sobreposição que exige decisão humana.
      const candidates = rankAutoAllocationCandidates(eligible.filter(item => (
        !allocatedIds.has(item.id) && !item.requiresMissionOverlapConfirmation
      ))).slice(0, needed);
      for (const collaborator of candidates) {
        const allocation = await allocateCollaboratorInTransaction(tx, mission, {
          collaboratorId: collaborator.id,
          jobRoleId: demand.jobRoleId
        }, context, 'AUTOMATIC');
        created.push(allocation);
        allocatedIds.add(collaborator.id);
      }
      const remaining = needed - candidates.length;
      if (remaining > 0) remainingDeficits.push({ jobRoleId: demand.jobRoleId, jobRoleName: demand.jobRole.name, deficit: remaining });
    }
    if (created.length) {
      await bumpPlanRevision(tx, plan);
      await recordEfetivoAudit(tx, {
        planId: plan.id, actorUserId: context.actorUserId, action: 'AUTO_ALLOCATION', entityType: 'MISSION', entityId: mission.id,
        summary: `${created.length} alocação(ões) automática(s) criada(s).`, afterData: { allocationIds: created.map(item => item.id), remainingDeficits }, evidence: context.evidence
      });
    }
    return { created, remainingDeficits };
  });
}
