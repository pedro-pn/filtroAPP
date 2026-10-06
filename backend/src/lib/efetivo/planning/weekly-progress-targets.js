import { computeProgressHistoryForProjects } from '../../acompanhamento/avanco.js';
import { deleteWeeklyProgressTarget, listWeeklyProgressTargets, saveWeeklyProgressTarget, weeklyTargetError, weeklyTargetReferenceDayHours } from '../../acompanhamento/weekly-progress-targets.js';
import { loadWeeklyServiceHistory } from '../../acompanhamento/weekly-service-history.js';
import { loadWeeklyAttendanceHistory } from '../../acompanhamento/weekly-attendance-history.js';
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
  const [targets, histories, defaultReferenceDayHours] = await Promise.all([
    listWeeklyProgressTargets(owner, { client }),
    (dependencies.loadHistory ?? computeProgressHistoryForProjects)([owner.projectId]),
    weeklyTargetReferenceDayHours(owner, { client })
  ]);
  const serviceHistory = dependencies.includeServices
    ? await (dependencies.loadServices ?? loadWeeklyServiceHistory)(owner, { client }) : undefined;
  const attendanceHistory = dependencies.includeServices && targets.some(target => target.definition?.metric === 'COLLABORATORS')
    ? await (dependencies.loadAttendance ?? loadWeeklyAttendanceHistory)(owner, { client }) : undefined;
  return { targets, defaultReferenceDayHours, progressHistory: histories.get(owner.projectId) ?? [], ...(serviceHistory ? { serviceHistory } : {}), ...(attendanceHistory ? { attendanceHistory } : {}) };
}

export async function saveMissionWeeklyProgressTarget(missionId, payload, context = {}, dependencies = {}) {
  const client = await resolvePlanningDatabase(dependencies.database);
  const owner = await missionOwner(client, missionId);
  return saveWeeklyProgressTarget(owner, payload, { client, userId: context.userId, userName: context.userName });
}

export async function deleteMissionWeeklyProgressTarget(missionId, payload, context = {}, dependencies = {}) {
  const client = await resolvePlanningDatabase(dependencies.database);
  const owner = await missionOwner(client, missionId);
  return deleteWeeklyProgressTarget(owner, payload, { client, userId: context.userId, userName: context.userName });
}
