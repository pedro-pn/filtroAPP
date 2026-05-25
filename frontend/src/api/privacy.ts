import { apiClient } from './client';

export type DataSubjectRequestType =
  | 'CONFIRMATION'
  | 'ACCESS'
  | 'CORRECTION'
  | 'ANONYMIZATION'
  | 'BLOCKING'
  | 'DELETION'
  | 'PORTABILITY'
  | 'SHARING_INFO'
  | 'CONSENT_REVOCATION'
  | 'OPPOSITION'
  | 'OTHER';

export interface DataSubjectRequestPayload {
  type: DataSubjectRequestType;
  name: string;
  email: string;
  identifier?: string | null;
  details: string;
}

export interface DataSubjectRequestSummary {
  protocol?: string;
  type?: DataSubjectRequestType;
  status?: string;
  createdAt?: string;
  received?: boolean;
  duplicateWindowHours?: number;
}

export interface DataSubjectRequestAdminSummary extends DataSubjectRequestSummary {
  id: string;
  protocol: string;
  type: DataSubjectRequestType;
  status: string;
  createdAt: string;
  name: string;
  email: string;
  identifier?: string | null;
  details: string;
  source: string;
  responseNotes?: string | null;
  responseEmailStatus?: string | null;
  responseEmailSentAt?: string | null;
  responseEmailError?: string | null;
  identityVerifiedAt?: string | null;
  identityVerificationEvidence?: string | null;
  completionNotes?: string | null;
  updatedAt: string;
  completedAt?: string | null;
  requesterUser?: {
    id: string;
    username: string;
    name: string;
    email?: string | null;
  } | null;
  completedByUser?: {
    id: string;
    username: string;
    name: string;
    email?: string | null;
  } | null;
  identityVerifiedByUser?: {
    id: string;
    username: string;
    name: string;
    email?: string | null;
  } | null;
  responseAttempts?: Array<{
    id: string;
    responseKind: string;
    resolved: boolean;
    status: string;
    emailTo: string;
    emailSubject?: string | null;
    providerMessageId?: string | null;
    error?: string | null;
    sentAt?: string | null;
    createdAt: string;
    createdByUser?: {
      id: string;
      username: string;
      name: string;
      email?: string | null;
    } | null;
  }>;
}

export interface DataSubjectRequestListParams {
  status?: 'ALL' | 'OPEN' | 'IN_REVIEW' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';
  page?: number;
  pageSize?: number;
}

export interface DataSubjectRequestListResponse {
  requests: DataSubjectRequestAdminSummary[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  counts: {
    open: number;
    inReview: number;
    pending: number;
  };
}

export async function createDataSubjectRequest(payload: DataSubjectRequestPayload) {
  const response = await apiClient.post<{ request: DataSubjectRequestSummary }>('/privacy/requests', payload);
  return response.data.request;
}

export async function listDataSubjectRequests(params: DataSubjectRequestListParams = {}) {
  const response = await apiClient.get<DataSubjectRequestListResponse>('/privacy/requests', { params });
  return response.data;
}

export async function respondDataSubjectRequest(id: string, payload: { message: string; resolved: boolean; responseKind?: string }) {
  const response = await apiClient.post<{ request: DataSubjectRequestAdminSummary }>(`/privacy/requests/${id}/response`, payload);
  return response.data.request;
}

export async function verifyDataSubjectRequestIdentity(id: string, payload: { evidence: string }) {
  const response = await apiClient.patch<{ request: DataSubjectRequestAdminSummary }>(`/privacy/requests/${id}/identity-verification`, payload);
  return response.data.request;
}

export async function updateDataSubjectRequestStatus(id: string, payload: { resolved: boolean; offlineResponseEvidence?: string }) {
  const response = await apiClient.patch<{ request: DataSubjectRequestAdminSummary }>(`/privacy/requests/${id}/status`, payload);
  return response.data.request;
}

export async function exportMyData() {
  const response = await apiClient.get('/privacy/me/data-export');
  return response.data;
}

export async function requestMyDataDeletion() {
  const response = await apiClient.post<{ request: DataSubjectRequestSummary }>('/privacy/me/delete-request');
  return response.data.request;
}
