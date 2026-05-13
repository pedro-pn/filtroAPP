import { useQuery } from '@tanstack/react-query';

import { fetchProjectStats, listProjectSegments, type StatsParams } from '../api/statistics';

export function useProjectStats(params: StatsParams) {
  return useQuery({
    queryKey: ['projectStats', params],
    queryFn: () => fetchProjectStats(params),
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(params.from && params.to)
  });
}

export function useProjectSegments() {
  return useQuery({
    queryKey: ['projectSegments'],
    queryFn: listProjectSegments,
    staleTime: 10 * 60 * 1000
  });
}
