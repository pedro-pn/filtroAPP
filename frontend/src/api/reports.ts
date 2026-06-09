import { apiClient, rdoApiPath } from './client';
import type { ReportAuditLog, ReportPayload, ReportStatus, ReportSummary, ReportType, ServiceOnlyReportPayload } from '../types/domain';

export interface ReportFilters {
  status?: string;
  statuses?: string[];
  projectId?: string;
  createdBy?: string;
  createdByUserId?: string;
  mine?: boolean;
  reportType?: ReportType | string;
  summary?: boolean;
  projectActive?: boolean;
  search?: string;
  reviewQueue?: boolean;
  reportSort?: 'asc' | 'desc';
  projectSort?: 'asc' | 'desc';
}

export interface ReportPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ReportGroupTotal {
  projectId: string;
  reportType: ReportType | string;
  total: number;
}

export interface PaginatedReports {
  items: ReportSummary[];
  pagination: ReportPagination;
  groups?: ReportGroupTotal[];
  meta?: {
    projectTotal?: number;
  };
}

export interface ReportPageFilters extends ReportFilters {
  page?: number;
  pageSize?: number;
  summary?: boolean;
}

export async function listReports(filters?: ReportFilters) {
  const params = {
    ...(filters ?? {}),
    ...(filters?.statuses?.length ? { statuses: filters.statuses.join(',') } : {}),
    ...(filters?.mine !== undefined ? { mine: String(filters.mine) } : {}),
    ...(filters?.summary !== undefined ? { summary: String(filters.summary) } : {}),
    ...(filters?.projectActive !== undefined ? { projectActive: String(filters.projectActive) } : {}),
    ...(filters?.reviewQueue !== undefined ? { reviewQueue: String(filters.reviewQueue) } : {})
  };
  const response = await apiClient.get<ReportSummary[]>(rdoApiPath('/reports'), {
    params
  });
  return response.data;
}

export async function getReport(id: string) {
  const response = await apiClient.get<ReportSummary>(rdoApiPath(`/reports/${id}`));
  return response.data;
}

export async function createReport(payload: ReportPayload) {
  const response = await apiClient.post<ReportSummary>(rdoApiPath('/reports'), payload);
  return response.data;
}

export async function listReportsPage(filters?: ReportPageFilters) {
  const params = {
    ...(filters ?? {}),
    ...(filters?.statuses?.length ? { statuses: filters.statuses.join(',') } : {}),
    ...(filters?.mine !== undefined ? { mine: String(filters.mine) } : {}),
    ...(filters?.summary !== undefined ? { summary: String(filters.summary) } : {}),
    ...(filters?.projectActive !== undefined ? { projectActive: String(filters.projectActive) } : {}),
    ...(filters?.reviewQueue !== undefined ? { reviewQueue: String(filters.reviewQueue) } : {})
  };
  const response = await apiClient.get<PaginatedReports>(rdoApiPath('/reports'), {
    params
  });
  return response.data;
}

export async function createServiceOnlyReports(payload: ServiceOnlyReportPayload) {
  const response = await apiClient.post<ReportSummary[]>(rdoApiPath('/reports/service-only'), payload);
  return response.data;
}

export async function updateReport(id: string, payload: Omit<ReportPayload, 'createdByUserId' | 'status'>) {
  const response = await apiClient.put<ReportSummary>(rdoApiPath(`/reports/${id}`), payload);
  return response.data;
}

export async function updateReportStatus(id: string, payload: { status: ReportStatus; reviewNotes?: string | null }) {
  const response = await apiClient.patch<ReportSummary>(rdoApiPath(`/reports/${id}/status`), payload);
  return response.data;
}

export async function updateReportSequence(id: string, payload: { sequenceNumber: number }) {
  const response = await apiClient.patch<ReportSummary>(rdoApiPath(`/reports/${id}/sequence`), payload);
  return response.data;
}

export interface ReleasedServiceReportNotification {
  id: string;
  projectId: string;
  reportType: ReportType;
  sequenceNumber?: number | null;
  reportDate?: string | null;
  project?: {
    id?: string;
    code?: string | null;
    name?: string | null;
  } | null;
}

export interface RequestReportSignatureResponse {
  ok: boolean;
  signed?: boolean;
  completed?: boolean;
  report: ReportSummary;
  releasedServiceReports?: ReleasedServiceReportNotification[];
}

export async function requestReportSignature(
  id: string,
  payload: {
    comment?: string | null;
    signerName: string;
    signatureImageDataUrl: string;
    privacyNoticeAccepted: true;
    privacyNoticeVersion: string;
  }
) {
  const response = await apiClient.post<RequestReportSignatureResponse>(
    rdoApiPath(`/reports/${id}/request-signature`),
    payload
  );
  return response.data;
}

export async function getReportAudit(id: string) {
  const response = await apiClient.get<ReportAuditLog[]>(rdoApiPath(`/reports/${id}/audit`));
  return response.data;
}

export async function createClientReportReview(
  id: string,
  payload: { action: 'APPROVED' | 'REJECTED'; comment?: string | null }
) {
  const response = await apiClient.post<ReportSummary>(rdoApiPath(`/reports/${id}/client-review`), payload);
  return response.data;
}

export async function downloadReportsBatch(ids: string[], format: 'pdf' | 'docx') {
  const response = await apiClient.post<Blob>(
    rdoApiPath('/reports/batch-download'),
    { ids, format },
    { responseType: 'blob' }
  );
  return response.data;
}

export async function downloadReportPdf(id: string) {
  const response = await apiClient.get<Blob>(rdoApiPath(`/reports/${id}/pdf`), {
    params: { _ts: Date.now() },
    responseType: 'blob'
  });
  return response.data;
}

export async function downloadReportDocx(id: string) {
  const response = await apiClient.get<Blob>(rdoApiPath(`/reports/${id}/docx`), {
    params: { _ts: Date.now() },
    responseType: 'blob'
  });
  return response.data;
}

export async function deleteReport(id: string): Promise<void> {
  await apiClient.delete(rdoApiPath(`/reports/${id}`));
}

export async function deleteReportService(reportId: string, serviceId: string) {
  const response = await apiClient.delete<ReportSummary>(rdoApiPath(`/reports/${reportId}/services/${serviceId}`));
  return response.data;
}
