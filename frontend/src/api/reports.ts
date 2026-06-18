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

export type ReportCountQuery = Pick<
  ReportFilters,
  'status' | 'statuses' | 'projectId' | 'createdByUserId' | 'mine' | 'reportType' | 'projectActive' | 'reviewQueue'
>;

// Serializa um filtro de contagem no mesmo formato (strings) que `GET /reports` recebe, para que
// o backend reaproveite exatamente a mesma construção de `where` da listagem.
function serializeCountQuery(query: ReportCountQuery) {
  return {
    ...(query.status !== undefined ? { status: query.status } : {}),
    ...(query.statuses?.length ? { statuses: query.statuses.join(',') } : {}),
    ...(query.projectId !== undefined ? { projectId: query.projectId } : {}),
    ...(query.createdByUserId !== undefined ? { createdByUserId: query.createdByUserId } : {}),
    ...(query.reportType !== undefined ? { reportType: query.reportType } : {}),
    ...(query.mine !== undefined ? { mine: String(query.mine) } : {}),
    ...(query.projectActive !== undefined ? { projectActive: String(query.projectActive) } : {}),
    ...(query.reviewQueue !== undefined ? { reviewQueue: String(query.reviewQueue) } : {})
  };
}

// P7 — um único round-trip para os totais de badges. Devolve os totais na mesma ordem das queries.
export async function fetchReportCounts(queries: ReportCountQuery[]) {
  const response = await apiClient.post<{ totals: number[] }>(rdoApiPath('/reports/counts'), {
    queries: queries.map(serializeCountQuery)
  });
  return response.data.totals;
}

export async function createServiceOnlyReports(payload: ServiceOnlyReportPayload) {
  const response = await apiClient.post<ReportSummary[]>(rdoApiPath('/reports/service-only'), payload);
  return response.data;
}

export type ManualReportSignatureMode = 'APPROVED' | 'SIGNED' | 'REQUIRES_SIGNATURE';

export interface ManualReportUploadPayload {
  projectId: string;
  reportType: ReportType;
  sequenceNumber?: number | null;
  reportDate: string;
  fileName?: string;
  serviceEquipment?: string;
  serviceSystem?: string;
  pdfDataUrl: string;
  signatureMode: ManualReportSignatureMode;
}

export type ManualReportPdfReplacePayload = Pick<ManualReportUploadPayload, 'fileName' | 'serviceEquipment' | 'serviceSystem' | 'pdfDataUrl' | 'signatureMode'>;

export async function uploadManualReport(payload: ManualReportUploadPayload) {
  const response = await apiClient.post<ReportSummary>(rdoApiPath('/reports/manual-upload'), payload);
  return response.data;
}

export async function replaceManualReportPdf(id: string, payload: ManualReportPdfReplacePayload) {
  const response = await apiClient.put<ReportSummary>(rdoApiPath(`/reports/${id}/manual-pdf`), payload);
  return response.data;
}

export async function updateReport(id: string, payload: Omit<ReportPayload, 'createdByUserId' | 'status'>) {
  const response = await apiClient.put<ReportSummary>(rdoApiPath(`/reports/${id}`), payload);
  return response.data;
}

export async function updateReportStatus(id: string, payload: { status: ReportStatus; reviewNotes?: string | null; acceptOvertime?: boolean }) {
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
