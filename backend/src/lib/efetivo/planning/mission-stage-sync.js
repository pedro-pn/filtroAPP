import { recordEfetivoAudit } from './audit.js';
import { planningError } from './errors.js';
import { missionInclude, missionMovePendencies } from './mission-planning.js';
import { bumpPlanRevision } from './plan-context.js';

const WORKFLOW_TO_MISSION_STAGE = {
  READY_TO_MOBILIZE: 'STANDBY',
  MOBILIZATION: 'MOBILIZATION',
  EXECUTION: 'EXECUTION'
};

export function missionStageForProjectWorkflow(stage) {
  return WORKFLOW_TO_MISSION_STAGE[stage] || null;
}

export async function synchronizeOfficialMissionStage(tx, projectId, workflowStage, context = {}) {
  const targetStage = missionStageForProjectWorkflow(workflowStage);
  if (!targetStage) return null;
  const mission = await tx.efetivoMissionPlan.findFirst({
    where: {
      projectId,
      deletedAt: null,
      scheduleStatus: { not: 'CANCELLED' },
      plan: { kind: 'OFFICIAL', status: 'ACTIVE' }
    },
    include: { ...missionInclude, plan: true }
  });
  const missionRequired = ['MOBILIZATION', 'EXECUTION'].includes(targetStage);
  if (!mission) {
    if (!missionRequired) return null;
    throw planningError('Crie ou reative a programação oficial da equipe antes de avançar o projeto.', {
      code: 'PROJECT_WORKFLOW_OFFICIAL_MISSION_REQUIRED'
    });
  }
  if (missionRequired) {
    const pendencies = missionMovePendencies(mission);
    if (pendencies.length) {
      throw planningError(`Complete a programação oficial antes de avançar: ${pendencies.join(', ')}.`, {
        code: 'PROJECT_WORKFLOW_MISSION_INCOMPLETE',
        issues: pendencies.map(message => ({ message }))
      });
    }
  }
  if (mission.stage === targetStage) return mission;

  const [source, target] = await Promise.all([
    tx.efetivoMissionPlan.findMany({
      where: { planId: mission.planId, stage: mission.stage, deletedAt: null, id: { not: mission.id } },
      orderBy: { kanbanOrder: 'asc' },
      select: { id: true }
    }),
    tx.efetivoMissionPlan.findMany({
      where: { planId: mission.planId, stage: targetStage, deletedAt: null, id: { not: mission.id } },
      orderBy: { kanbanOrder: 'asc' },
      select: { id: true }
    })
  ]);
  await Promise.all([
    ...source.map((item, order) => tx.efetivoMissionPlan.update({ where: { id: item.id }, data: { kanbanOrder: order } })),
    ...target.map((item, order) => tx.efetivoMissionPlan.update({ where: { id: item.id }, data: { kanbanOrder: order } }))
  ]);
  const moved = await tx.efetivoMissionPlan.update({
    where: { id: mission.id },
    data: {
      stage: targetStage,
      kanbanOrder: target.length,
      version: { increment: 1 },
      updatedByUserId: context.actorUserId || null
    },
    include: missionInclude
  });
  await bumpPlanRevision(tx, mission.plan);
  await recordEfetivoAudit(tx, {
    planId: mission.planId,
    actorUserId: context.actorUserId,
    action: 'MISSION_STAGE_CHANGE',
    entityType: 'MISSION',
    entityId: mission.id,
    summary: `Etapa operacional sincronizada pelo fluxo do projeto: ${targetStage}.`,
    beforeData: { stage: mission.stage, order: mission.kanbanOrder },
    afterData: { stage: targetStage, order: target.length },
    evidence: context.evidence
  });
  return moved;
}
