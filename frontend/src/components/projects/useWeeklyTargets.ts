import { useQuery } from '@tanstack/react-query';

import { buildWeeklyProgressComparison } from '../../../../shared/modules/mission-weekly-progress.js';
import { listWeeklyProgressTargets, weeklyTargetPath, type WeeklyTargetOwner } from '../../api/weeklyProgressTargets';
import type { ProgressHistoryPoint } from '../../api/acompanhamentoComercial';

export const weeklyTargetsQueryKey = (owner: WeeklyTargetOwner, withHistory: boolean) => ['mission-weekly-targets', weeklyTargetPath(owner), withHistory] as const;

/** Metas, histórico e comparativo semanal; o mesmo cache serve o card, o painel e o cadastro. */
export function useWeeklyTargets(owner: WeeklyTargetOwner, progressHistory?: ProgressHistoryPoint[]) {
  const query = useQuery({
    queryKey: weeklyTargetsQueryKey(owner, progressHistory === undefined),
    queryFn: () => listWeeklyProgressTargets(owner, progressHistory === undefined),
    staleTime: 30_000
  });
  const targets = query.data?.targets ?? [];
  const serviceHistory = query.data?.serviceHistory ?? [];
  const rows = buildWeeklyProgressComparison({ targets, progressHistory: progressHistory ?? query.data?.progressHistory ?? [],
    serviceHistory, attendanceHistory: query.data?.attendanceHistory ?? [] });
  return { query, targets, rows, serviceHistory, journey: query.data?.journey ?? null };
}
