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
  listReportsPage,
  requestReportSignature,
  updateReport,
  updateReportStatus,
  type PaginatedReports,
  type ReportFilters,
  type ReportPageFilters
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

export function useReportsPage(filters: ReportPageFilters) {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.reportPage(filters, user?.id),
    queryFn: () => listReportsPage(filters)
  });
}

export function useReport(reportId: string, enabled = true) {
  return useQuery({
    queryKey: ['report', reportId],
    queryFn: () => getReport(reportId),
    enabled: enabled && !!reportId
  });
}

function isPaginatedReports(value: ReportSummary[] | PaginatedReports | undefined): value is PaginatedReports {
  return !!value && !Array.isArray(value) && Array.isArray(value.items) && !!value.pagination;
}

function updateReportCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  report: ReportSummary
) {
  queryClient.setQueryData(['report', report.id], report);
  queryClient.setQueriesData<ReportSummary[] | PaginatedReports>({ queryKey: ['reports'] }, current => {
    const list = Array.isArray(current) ? current : isPaginatedReports(current) ? current.items : undefined;
    if (!list?.length) return current;
    let found = false;
    const nextItems = list.map(item => {
      if (item.id !== report.id) return item;
      found = true;
      return report;
    });
    if (!found) return current;
    if (Array.isArray(current)) return nextItems;
    if (!isPaginatedReports(current)) return current;
    return { ...current, items: nextItems };
  });
}

function removeReportFromCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  reportId: string
) {
  queryClient.removeQueries({ queryKey: ['report', reportId] });
  queryClient.setQueriesData<ReportSummary[] | PaginatedReports>({ queryKey: ['reports'] }, current => {
    const list = Array.isArray(current) ? current : isPaginatedReports(current) ? current.items : undefined;
    if (!list?.length) return current;
    const nextItems = list.filter(report => report.id !== reportId);
    if (nextItems.length === list.length) return current;
    if (Array.isArray(current)) return nextItems;
    if (!isPaginatedReports(current)) return current;
    const total = Math.max(0, current.pagination.total - 1);
    return {
      ...current,
      items: nextItems,
      pagination: {
        ...current.pagination,
        total,
        totalPages: Math.max(1, Math.ceil(total / current.pagination.pageSize))
      }
    };
  });
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
