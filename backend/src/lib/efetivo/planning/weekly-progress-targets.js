import { computeProgressHistoryForProjects } from '../../acompanhamento/avanco.js';
import { listWeeklyProgressTargets, saveWeeklyProgressTarget, weeklyTargetError } from '../../acompanhamento/weekly-progress-targets.js';
import { efetivoProjectWhere } from '../project-visibility.js';
import { resolvePlanningDatabase } from './plan-context.js';

async function missionOwner(client, missionId) {
  const mission = await client.efetivoMissionPlan.findFirst({
    where: { id: missionId, deletedAt: null, project: efetivoProjectWhere(), plan: { kind: 'OFFICIAL', status: 'ACTIVE' } },
    select: { projectId: true }
  });
  if (!mission) throw weeklyTargetError('Missão oficial não encontrada.', 404);
  return { projectId: mission.projectId };
}

export async function getMissionWeeklyProgressTargets(missionId, dependencies = {}) {
  const client = await resolvePlanningDatabase(dependencies.database);
  const owner = await missionOwner(client, missionId);
  const [targets, histories] = await Promise.all([
    listWeeklyProgressTargets(owner, { client }),
    (dependencies.loadHistory ?? computeProgressHistoryForProjects)([owner.projectId])
  ]);
  return { targets, progressHistory: histories.get(owner.projectId) ?? [] };
}

export async function saveMissionWeeklyProgressTarget(missionId, payload, context = {}, dependencies = {}) {
  const client = await resolvePlanningDatabase(dependencies.database);
  const owner = await missionOwner(client, missionId);
  return saveWeeklyProgressTarget(owner, payload, { client, userId: context.userId, userName: context.userName });
}
