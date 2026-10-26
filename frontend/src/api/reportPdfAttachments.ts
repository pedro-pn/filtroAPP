import { apiClient, rdoApiPath } from './client';

export interface ReportPdfAttachment {
  id: string;
  fileName: string;
  sizeBytes: number;
  pageCount: number;
  position: number;
  createdAt: string;
}

function attachmentPath(reportId: string, attachmentId?: string) {
  return rdoApiPath(`/reports/${reportId}/pdf-attachments${attachmentId ? `/${attachmentId}` : ''}`);
}

export async function listReportPdfAttachments(reportId: string, signal?: AbortSignal) {
  return (await apiClient.get<ReportPdfAttachment[]>(attachmentPath(reportId), { signal })).data;
}

export async function attachReportPdf(reportId: string, fileName: string, pdfDataUrl: string) {
  return (await apiClient.post<ReportPdfAttachment>(attachmentPath(reportId), { fileName, pdfDataUrl })).data;
}

export async function deleteReportPdfAttachment(reportId: string, attachmentId: string) {
  await apiClient.delete(attachmentPath(reportId, attachmentId));
}

export async function reorderReportPdfAttachments(reportId: string, ids: string[]) {
  return (await apiClient.patch<ReportPdfAttachment[]>(`${attachmentPath(reportId)}/order`, { ids })).data;
}

export function reportPdfAttachmentUrl(reportId: string, attachmentId: string) {
  return apiClient.getUri({ url: `${attachmentPath(reportId, attachmentId)}/pdf` });
}

export async function downloadReportPdfAttachment(reportId: string, attachmentId: string) {
  return (await apiClient.get<Blob>(`${attachmentPath(reportId, attachmentId)}/pdf`, { responseType: 'blob' })).data;
}
