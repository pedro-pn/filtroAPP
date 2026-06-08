import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createProjectSegment,
  fetchAllocationReport,
  fetchProjectStats,
  fetchStatsOverview,
  listAllocationReportRecipients,
  listProjectSegments,
  removeAllocationReportRecipient,
  saveAllocationReportRecipient,
  sendAllocationReportNow,
  updateAllocationReportRecipient,
  type AllocationReportRecipientPayload,
  type ClientSegmentPayload,
  type StatsParams
} from '../api/statistics';

export function useProjectStats(params: StatsParams, enabled = true) {
  return useQuery({
    queryKey: ['projectStats', params],
    queryFn: () => fetchProjectStats(params),
    staleTime: 5 * 60 * 1000,
    enabled: enabled && Boolean(params.from && params.to)
  });
}

export function useProjectSegments() {
  return useQuery({
    queryKey: ['projectSegments'],
    queryFn: listProjectSegments,
    staleTime: 10 * 60 * 1000
  });
}

export function useStatsOverview() {
  return useQuery({
    queryKey: ['statsOverview'],
    queryFn: fetchStatsOverview,
    staleTime: 5 * 60 * 1000
  });
}

export function useAllocationReport(yearMonth: string) {
  return useQuery({
    queryKey: ['allocationReport', yearMonth],
    queryFn: () => fetchAllocationReport(yearMonth),
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(yearMonth)
  });
}

export function useAllocationReportRecipients() {
  return useQuery({
    queryKey: ['allocationReportRecipients'],
    queryFn: listAllocationReportRecipients,
    staleTime: 5 * 60 * 1000
  });
}

export function useProjectSegmentMutations() {
  const queryClient = useQueryClient();

  return {
    createSegment: useMutation({
      mutationFn: (payload: ClientSegmentPayload) => createProjectSegment(payload),
      onSuccess: () => Promise.all([
        queryClient.invalidateQueries({ queryKey: ['projectSegments'] }),
        queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
      ])
    })
  };
}

export function useAllocationReportRecipientMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['allocationReportRecipients'] });

  return {
    saveRecipient: useMutation({
      mutationFn: (payload: AllocationReportRecipientPayload) => saveAllocationReportRecipient(payload),
      onSuccess: invalidate
    }),
    updateRecipient: useMutation({
      mutationFn: ({ id, payload }: { id: string; payload: Partial<AllocationReportRecipientPayload> }) => updateAllocationReportRecipient(id, payload),
      onSuccess: invalidate
    }),
    removeRecipient: useMutation({
      mutationFn: (id: string) => removeAllocationReportRecipient(id),
      onSuccess: invalidate
    }),
    sendNow: useMutation({
      mutationFn: (yearMonth: string) => sendAllocationReportNow(yearMonth)
    })
  };
}
