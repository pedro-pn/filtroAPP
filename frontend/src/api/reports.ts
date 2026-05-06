import { apiClient } from './client';
import type { ReportPayload, ReportStatus, ReportSummary } from '../types/domain';

export interface ReportFilters {
  status?: string;
  projectId?: string;
  createdBy?: string;
  mine?: boolean;
}

export async function listReports(filters?: ReportFilters) {
  const params = {
    ...(filters ?? {}),
    ...(filters?.mine !== undefined ? { mine: String(filters.mine) } : {})
  };
  const response = await apiClient.get<ReportSummary[]>('/reports', {
    params
  });
  return response.data;
}

export async function getReport(id: string) {
  const response = await apiClient.get<ReportSummary>(`/reports/${id}`);
  return response.data;
}

export async function createReport(payload: ReportPayload) {
  const response = await apiClient.post<ReportSummary>('/reports', payload);
  return response.data;
}

export async function updateReport(id: string, payload: Omit<ReportPayload, 'createdByUserId' | 'status'>) {
  const response = await apiClient.put<ReportSummary>(`/reports/${id}`, payload);
  return response.data;
}

export async function updateReportStatus(id: string, payload: { status: ReportStatus; reviewNotes?: string | null }) {
  const response = await apiClient.patch<ReportSummary>(`/reports/${id}/status`, payload);
  return response.data;
}

export async function requestReportSignature(id: string, payload: { comment?: string | null }) {
  const response = await apiClient.post<{ ok: boolean; signUrl?: string; report: ReportSummary }>(
    `/reports/${id}/request-signature`,
    payload
  );
  return response.data;
}

export async function createClientReportReview(
  id: string,
  payload: { action: 'APPROVED' | 'REJECTED'; comment?: string | null }
) {
  const response = await apiClient.post<ReportSummary>(`/reports/${id}/client-review`, payload);
  return response.data;
}

export async function downloadReportsBatch(ids: string[], format: 'pdf' | 'docx') {
  const response = await apiClient.post<Blob>(
    '/reports/batch-download',
    { ids, format },
    { responseType: 'blob' }
  );
  return response.data;
}

export async function requestReportsBatchSignature(ids: string[], commentsById?: Record<string, string>) {
  const response = await apiClient.post<{ ok: boolean; signUrl?: string; reportIds: string[] }>(
    '/reports/batch-request-signature',
    { ids, commentsById }
  );
  return response.data;
}

export async function downloadReportPdf(id: string) {
  const response = await apiClient.get<Blob>(`/reports/${id}/pdf`, {
    responseType: 'blob'
  });
  return response.data;
}

export async function downloadReportDocx(id: string) {
  const response = await apiClient.get<Blob>(`/reports/${id}/docx`, {
    responseType: 'blob'
  });
  return response.data;
}

export async function deleteReport(id: string): Promise<void> {
  await apiClient.delete(`/reports/${id}`);
}

export async function deleteReportService(reportId: string, serviceId: string) {
  const response = await apiClient.delete<ReportSummary>(`/reports/${reportId}/services/${serviceId}`);
  return response.data;
}
