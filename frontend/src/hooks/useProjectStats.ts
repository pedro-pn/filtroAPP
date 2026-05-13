import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createProjectSegment, fetchProjectStats, listProjectSegments, type ClientSegmentPayload, type StatsParams } from '../api/statistics';

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

export function useProjectSegmentMutations() {
  const queryClient = useQueryClient();

  return {
    createSegment: useMutation({
      mutationFn: (payload: ClientSegmentPayload) => createProjectSegment(payload),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projectSegments'] })
    })
  };
}
