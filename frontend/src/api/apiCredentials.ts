import type {
  ApiCredentialPublic,
  CreateApiCredentialInput
} from '../../../shared/schemas/api-credentials.js';
import { adminApiPath, apiClient } from './client';
import type { ApiOperationOption } from '../components/admin/api-tokens/apiOperations';

export interface ApiScopeDefinition {
  code: string;
  label: string;
  domain: string;
  description: string;
  sensitivity: string;
  availability: 'AVAILABLE' | 'PLANNED' | 'SENSITIVE' | 'RESERVED' | 'PROHIBITED';
  requiredScopes: string[];
  operations: string[];
  exposedFields: string[];
  excludedFields: string[];
  models: string[];
  endpointFamilies?: string[];
}

export interface ApiDataDomain {
  code: string;
  label: string;
  models: Array<{ model: string; availability: ApiScopeDefinition['availability'] }>;
  candidateScopes: string[];
  endpointFamilies: string[];
  includedFields: string[];
  excludedFields: string[];
}

export interface CursorPage<T> {
  items: T[];
  page: { nextCursor: string | null; limit: number; hasMore: boolean };
}

export interface IssuedApiCredential {
  credential: ApiCredentialPublic;
  token: string;
  tokenShownOnce: true;
}

export async function listApiScopes() {
  const response = await apiClient.get<{ items: ApiScopeDefinition[]; domains: ApiDataDomain[]; operations: ApiOperationOption[]; version: string }>(adminApiPath('/api-scopes'));
  return response.data;
}

export async function listApiCredentials(params: Record<string, string | number | undefined> = {}) {
  const response = await apiClient.get<CursorPage<ApiCredentialPublic>>(adminApiPath('/api-credentials'), { params });
  return response.data;
}

export async function getApiCredential(id: string) {
  const response = await apiClient.get<ApiCredentialPublic>(adminApiPath(`/api-credentials/${encodeURIComponent(id)}`));
  return response.data;
}

// A resposta contém o único exemplar do segredo. O chamador deve mantê-la apenas
// em estado local efêmero; esta função não usa queryClient nem storage.
export async function createApiCredential(payload: CreateApiCredentialInput, idempotencyKey: string) {
  const response = await apiClient.post<IssuedApiCredential>(adminApiPath('/api-credentials'), payload, {
    headers: { 'Idempotency-Key': idempotencyKey }
  });
  return response.data;
}

export async function reduceApiCredential(id: string, payload: Record<string, unknown>) {
  const response = await apiClient.patch<ApiCredentialPublic>(adminApiPath(`/api-credentials/${encodeURIComponent(id)}`), payload);
  return response.data;
}

export interface ApiPlaygroundInput {
  operationId: string;
  pathParams: Record<string, string>;
  query: Record<string, string | number | boolean | string[]>;
}

export interface ApiPlaygroundResult {
  request: { method: 'GET'; path: string; authorization: string; curl: string } | null;
  response: { status: number | null; durationMs: number; requestId: string | null; truncated: boolean; body: unknown };
}

export async function testApiCredential(id: string, payload: ApiPlaygroundInput) {
  const response = await apiClient.post<ApiPlaygroundResult>(adminApiPath(`/api-credentials/${encodeURIComponent(id)}/test`), payload);
  return response.data;
}

export async function rotateApiCredential(id: string, payload: Record<string, unknown>, idempotencyKey: string) {
  const response = await apiClient.post<IssuedApiCredential>(adminApiPath(`/api-credentials/${encodeURIComponent(id)}/rotate`), payload, {
    headers: { 'Idempotency-Key': idempotencyKey }
  });
  return response.data;
}

export async function revokeApiCredential(id: string, payload: { expectedVersion: number; reason: string }, idempotencyKey: string) {
  const response = await apiClient.post<ApiCredentialPublic>(adminApiPath(`/api-credentials/${encodeURIComponent(id)}/revoke`), payload, {
    headers: { 'Idempotency-Key': idempotencyKey }
  });
  return response.data;
}

export interface ApiCredentialEvent {
  id: string; type: string; reason: string | null; summary: Record<string, unknown>; requestId: string | null;
  actor: { id: string; name: string } | null; createdAt: string;
}

export interface ApiCredentialUsage {
  from: string; to: string; requests: number; rows: number; bytes: number;
  byStatus: Record<string, number>; byOperation: Record<string, number>;
}

export async function listApiCredentialEvents(id: string, cursor?: string) {
  const response = await apiClient.get<CursorPage<ApiCredentialEvent>>(adminApiPath(`/api-credentials/${encodeURIComponent(id)}/events`), { params: { cursor } });
  return response.data;
}

export async function getApiCredentialUsage(id: string, from: string, to: string) {
  const response = await apiClient.get<ApiCredentialUsage>(adminApiPath(`/api-credentials/${encodeURIComponent(id)}/usage`), { params: { from, to } });
  return response.data;
}
