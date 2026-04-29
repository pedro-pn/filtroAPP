import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createClientReportReview,
  createReport,
  getReport,
  listReports,
  requestReportsBatchSignature,
  requestReportSignature,
  updateReport,
  updateReportStatus,
  type ReportFilters
} from '../api/reports';
import type { ReportPayload, ReportStatus } from '../types/domain';
import { queryKeys } from './queryKeys';

export function useReports(filters?: ReportFilters) {
  return useQuery({
    queryKey: queryKeys.reports(filters),
    queryFn: () => listReports(filters)
  });
}

export function useReport(reportId: string, enabled = true) {
  return useQuery({
    queryKey: ['report', reportId],
    queryFn: () => getReport(reportId),
    enabled: enabled && !!reportId
  });
}

export function useReportMutations() {
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (payload: ReportPayload) => createReport(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reports'] })
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Omit<ReportPayload, 'createdByUserId' | 'status'> }) =>
      updateReport(id, payload),
    onSuccess: report => {
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['report', report.id] });
    }
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: { status: ReportStatus; reviewNotes?: string | null } }) =>
      updateReportStatus(id, payload),
    onSuccess: report => {
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['report', report.id] });
    }
  });

  const requestSignatureMutation = useMutation({
    mutationFn: ({ id, comment }: { id: string; comment?: string | null }) => requestReportSignature(id, { comment }),
    onSuccess: data => {
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['report', data.report.id] });
    }
  });

  const clientReviewMutation = useMutation({
    mutationFn: ({
      id,
      payload
    }: {
      id: string;
      payload: { action: 'APPROVED' | 'REJECTED'; comment?: string | null };
    }) => createClientReportReview(id, payload),
    onSuccess: report => {
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['report', report.id] });
    }
  });

  const batchSignatureMutation = useMutation({
    mutationFn: ({ ids, commentsById }: { ids: string[]; commentsById?: Record<string, string> }) =>
      requestReportsBatchSignature(ids, commentsById),
    onSuccess: data => {
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      data.reportIds.forEach(id => queryClient.invalidateQueries({ queryKey: ['report', id] }));
    }
  });

  return {
    createReport: createMutation,
    updateReport: updateMutation,
    updateStatus: updateStatusMutation,
    requestSignature: requestSignatureMutation,
    clientReview: clientReviewMutation,
    batchSignature: batchSignatureMutation
  };
}
