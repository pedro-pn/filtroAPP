import { apiClient } from './client';
import type { ReportSummary } from '../types/domain';

export interface PublicSignatureReportPayload {
  signatureId?: string;
  status: 'ACTIVE' | 'SIGNED' | 'REJECTED' | 'INVALIDATED' | 'EXPIRED' | 'UNAVAILABLE' | 'INVALID';
  expiresAt?: string | null;
  signer: {
    name: string;
    prefillName?: boolean;
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
    prefillName?: boolean;
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

export type PublicReportPayload = Pick<PublicSignaturePayload, 'status' | 'expiresAt'> & {
  report?: Omit<NonNullable<PublicSignaturePayload['report']>, 'sourceDocumentHash'>;
};

export async function getPublicReport(token: string) {
  const response = await apiClient.get<PublicReportPayload>(`/reports/public-view/${encodeURIComponent(token)}`);
  return response.data;
}

export function publicReportPdfUrl(token: string) {
  const baseUrl = String(apiClient.defaults.baseURL || '/api').replace(/\/+$/, '');
  return `${baseUrl}/reports/public-view/${encodeURIComponent(token)}/pdf`;
}

export interface PublicSignatureConfirmPayload {
  signatureId?: string;
  signerName: string;
  signatureImageDataUrl: string;
  privacyNoticeAccepted: true;
  privacyNoticeVersion: string;
}

export interface PublicSignatureEmailDelivery {
  status: 'queued' | 'sent' | 'failed' | 'skipped';
  reportCount?: number;
}

export async function confirmPublicSignature(token: string, payload: PublicSignatureConfirmPayload) {
  const response = await apiClient.post<{ success: boolean; completed: boolean; report: ReportSummary; emailDelivery: PublicSignatureEmailDelivery }>(
    `/reports/public-sign/${encodeURIComponent(token)}/confirm`,
    payload
  );
  return response.data;
}

export interface PublicSignatureBatchConfirmPayload extends Omit<PublicSignatureConfirmPayload, 'signatureId'> {
  signatureIds: string[];
}

export interface PublicSignatureBatchResult {
  signatureId: string;
  success: boolean;
  completed?: boolean;
  error?: string;
}

export async function confirmPublicSignatureBatch(token: string, payload: PublicSignatureBatchConfirmPayload) {
  const results: PublicSignatureBatchResult[] = [];
  const emailDeliveries: PublicSignatureEmailDelivery[] = [];
  for (let offset = 0; offset < payload.signatureIds.length; offset += 100) {
    try {
      const response = await apiClient.post<{ results: PublicSignatureBatchResult[]; emailDelivery: PublicSignatureEmailDelivery }>(
        `/reports/public-sign/${encodeURIComponent(token)}/confirm-batch`,
        { ...payload, signatureIds: payload.signatureIds.slice(offset, offset + 100) }
      );
      results.push(...response.data.results);
      emailDeliveries.push(response.data.emailDelivery);
    } catch (error) {
      if (!results.length) throw error;
      results.push(...payload.signatureIds.slice(offset).map(signatureId => ({
        signatureId, success: false,
        error: error instanceof Error ? error.message : 'Não foi possível confirmar a assinatura.'
      })));
      break;
    }
  }
  return { results, emailDeliveries };
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

export function publicSignatureZipUrl(token: string) {
  const baseUrl = String(apiClient.defaults.baseURL || '/api').replace(/\/+$/, '');
  return `${baseUrl}/reports/public-sign/${encodeURIComponent(token)}/zip`;
}
