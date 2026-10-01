import { apiClient } from './client';
import type { WeeklyProgressTarget } from '../../../shared/modules/mission-weekly-progress.js';
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
  return (await apiClient.get<{ targets: WeeklyProgressTarget[]; progressHistory?: ProgressHistoryPoint[] }>(weeklyTargetPath(owner), {
    params: includeHistory ? { history: 'true' } : undefined
  })).data;
}

export async function saveWeeklyProgressTarget(owner: WeeklyTargetOwner, payload: { weekStartDate: string; plannedPctPoints: number; expectedRevision: number }) {
  return (await apiClient.put<WeeklyProgressTarget>(weeklyTargetPath(owner), payload)).data;
}
