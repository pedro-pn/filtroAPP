import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createClientReportReview,
  createReport,
  createServiceOnlyReports,
  deleteReport as deleteReportApi,
  deleteReportService,
  getReportAudit,
  getReport,
  listReports,
  requestReportSignature,
  updateReport,
  updateReportStatus,
  type ReportFilters
} from '../api/reports';
import { useAuth } from '../auth/AuthContext';
import type { ReportPayload, ReportStatus, ReportSummary, ServiceOnlyReportPayload } from '../types/domain';
import { queryKeys } from './queryKeys';

export function useReports(filters?: ReportFilters) {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.reports(filters, user?.id),
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

function updateReportCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  report: ReportSummary
) {
  queryClient.setQueryData(['report', report.id], report);
  queryClient.setQueriesData<ReportSummary[]>({ queryKey: ['reports'] }, current => {
    if (!current?.length) return current;
    let found = false;
    const next = current.map(item => {
      if (item.id !== report.id) return item;
      found = true;
      return report;
    });
    return found ? next : current;
  });
}

function removeReportFromCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  reportId: string
) {
  queryClient.removeQueries({ queryKey: ['report', reportId] });
  queryClient.setQueriesData<ReportSummary[]>({ queryKey: ['reports'] }, current => (
    current?.filter(report => report.id !== reportId) ?? current
  ));
}

export function useReportAudit(reportId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.reportAudit(reportId),
    queryFn: () => getReportAudit(reportId),
    enabled: enabled && !!reportId
  });
}

export function useReportMutations() {
  const queryClient = useQueryClient();
  const createMutation = useMutation({
    mutationFn: (payload: ReportPayload) => createReport(payload),
    onSuccess: report => {
      queryClient.setQueryData(['report', report.id], report);
      queryClient.invalidateQueries({ queryKey: ['reports'] });
    }
  });

  const createServiceOnlyMutation = useMutation({
    mutationFn: (payload: ServiceOnlyReportPayload) => createServiceOnlyReports(payload),
    onSuccess: reports => {
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      reports.forEach(report => queryClient.invalidateQueries({ queryKey: ['report', report.id] }));
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Omit<ReportPayload, 'createdByUserId' | 'status'> }) =>
      updateReport(id, payload),
    onSuccess: report => {
      updateReportCaches(queryClient, report);
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['report', report.id] });
    }
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: { status: ReportStatus; reviewNotes?: string | null } }) =>
      updateReportStatus(id, payload),
    onSuccess: report => {
      updateReportCaches(queryClient, report);
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['report', report.id] });
    }
  });

  const requestSignatureMutation = useMutation({
    mutationFn: ({
      id,
      comment,
      signerName,
      signatureImageDataUrl,
      privacyNoticeAccepted,
      privacyNoticeVersion
    }: {
      id: string;
      comment?: string | null;
      signerName: string;
      signatureImageDataUrl: string;
      privacyNoticeAccepted: true;
      privacyNoticeVersion: string;
    }) =>
      requestReportSignature(id, { comment, signerName, signatureImageDataUrl, privacyNoticeAccepted, privacyNoticeVersion }),
    onSuccess: data => {
      updateReportCaches(queryClient, data.report);
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['report', data.report.id] });
      queryClient.invalidateQueries({ queryKey: queryKeys.reportAudit(data.report.id) });
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
      updateReportCaches(queryClient, report);
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['report', report.id] });
    }
  });

  const deleteReport = useMutation({
    mutationFn: (id: string) => deleteReportApi(id),
    onSuccess: (_data, reportId) => {
      removeReportFromCaches(queryClient, reportId);
      queryClient.invalidateQueries({ queryKey: ['reports'] });
    }
  });

  const deleteService = useMutation({
    mutationFn: ({ reportId, serviceId }: { reportId: string; serviceId: string }) =>
      deleteReportService(reportId, serviceId),
    onSuccess: report => {
      updateReportCaches(queryClient, report);
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['report', report.id] });
    }
  });

  return {
    createReport: createMutation,
    createServiceOnlyReports: createServiceOnlyMutation,
    updateReport: updateMutation,
    updateStatus: updateStatusMutation,
    requestSignature: requestSignatureMutation,
    clientReview: clientReviewMutation,
    deleteReport,
    deleteService
  };
}
