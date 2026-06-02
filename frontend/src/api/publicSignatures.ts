import { apiClient } from './client';
import type { ReportSummary } from '../types/domain';

export interface PublicSignatureReportPayload {
  signatureId?: string;
  status: 'ACTIVE' | 'SIGNED' | 'REJECTED' | 'INVALIDATED' | 'EXPIRED' | 'UNAVAILABLE' | 'INVALID';
  expiresAt?: string | null;
  signer: {
    name: string;
    declaredName?: string | null;
    email: string;
    status: string;
    signedAt?: string | null;
    rejectedAt?: string | null;
  };
  report: {
    id: string;
    reportType: string;
    sequenceNumber?: number | null;
    reportDate?: string | null;
    status: string;
    sourceDocumentHash: string;
    project: {
      code: string;
      name: string;
      clientName: string;
    };
  };
}

export interface PublicSignaturePayload {
  status: 'ACTIVE' | 'SIGNED' | 'REJECTED' | 'INVALIDATED' | 'EXPIRED' | 'UNAVAILABLE' | 'INVALID';
  expiresAt?: string | null;
  signer?: {
    signatureId?: string;
    name: string;
    declaredName?: string | null;
    email: string;
    status: string;
    signedAt?: string | null;
    rejectedAt?: string | null;
  };
  report?: {
    id: string;
    reportType: string;
    sequenceNumber?: number | null;
    reportDate?: string | null;
    status: string;
    sourceDocumentHash: string;
    project: {
      code: string;
      name: string;
      clientName: string;
    };
  };
  batch?: {
    pendingCount: number;
    project: {
      code: string;
      name: string;
      clientName: string;
    };
    reports: PublicSignatureReportPayload[];
  };
}

export async function getPublicSignature(token: string) {
  const response = await apiClient.get<PublicSignaturePayload>(`/reports/public-sign/${encodeURIComponent(token)}`);
  return response.data;
}

export interface PublicSignatureConfirmPayload {
  signatureId?: string;
  signerName: string;
  signatureImageDataUrl: string;
  privacyNoticeAccepted: true;
  privacyNoticeVersion: string;
}

export async function confirmPublicSignature(token: string, payload: PublicSignatureConfirmPayload) {
  const response = await apiClient.post<{ success: boolean; completed: boolean; report: ReportSummary }>(
    `/reports/public-sign/${encodeURIComponent(token)}/confirm`,
    payload
  );
  return response.data;
}

export async function rejectPublicSignature(token: string, comment: string, signatureId?: string) {
  const response = await apiClient.post<{ success: boolean; report: ReportSummary }>(
    `/reports/public-sign/${encodeURIComponent(token)}/reject`,
    { comment, signatureId }
  );
  return response.data;
}

export function publicSignaturePdfUrl(token: string, signatureId?: string) {
  const baseUrl = String(apiClient.defaults.baseURL || '/api').replace(/\/+$/, '');
  const url = `${baseUrl}/reports/public-sign/${encodeURIComponent(token)}/pdf`;
  return signatureId ? `${url}?signatureId=${encodeURIComponent(signatureId)}` : url;
}
