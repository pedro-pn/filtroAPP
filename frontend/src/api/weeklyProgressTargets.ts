import { apiClient } from './client';
import type { WeeklyProgressTarget, WeeklyTargetInput, WeeklyTargetDeleteInput, WeeklyServiceHistoryPoint, WeeklyAttendanceHistoryPoint } from '../../../shared/modules/mission-weekly-progress.js';
import type { ProgressHistoryPoint } from './acompanhamentoComercial';

export type WeeklyTargetOwner = { area: 'acompanhamento'; projectId: string; groupId?: never; missionId?: never }
  | { area: 'acompanhamento'; groupId: string; projectId?: never; missionId?: never }
  | { area: 'efetivo'; missionId: string; projectId?: never; groupId?: never };

export function weeklyTargetPath(owner: WeeklyTargetOwner) {
  if (owner.area === 'efetivo') return `/efetivo/planning/missions/${encodeURIComponent(owner.missionId)}/weekly-targets`;
  const resource = owner.groupId ? `grupos-missoes/${encodeURIComponent(owner.groupId)}` : `projetos/${encodeURIComponent(owner.projectId!)}`;
  return `/acompanhamento/comercial/${resource}/metas-semanais`;
}

export async function listWeeklyProgressTargets(owner: WeeklyTargetOwner, includeHistory = false) {
  return (await apiClient.get<{ targets: WeeklyProgressTarget[]; defaultReferenceDayHours?: number | null; progressHistory?: ProgressHistoryPoint[]; serviceHistory?: WeeklyServiceHistoryPoint[]; attendanceHistory?: WeeklyAttendanceHistoryPoint[] }>(weeklyTargetPath(owner), {
    params: { ...(includeHistory ? { history: 'true' } : {}), services: 'true' }
  })).data;
}

export async function saveWeeklyProgressTarget(owner: WeeklyTargetOwner, payload: WeeklyTargetInput) {
  return (await apiClient.put<WeeklyProgressTarget>(weeklyTargetPath(owner), payload)).data;
}

export async function deleteWeeklyProgressTarget(owner: WeeklyTargetOwner, payload: WeeklyTargetDeleteInput) {
  return (await apiClient.delete<WeeklyProgressTarget>(weeklyTargetPath(owner), { data: payload })).data;
}
