import { apiClient, epiApiPath } from './client';
import type { Collaborator } from '../types/domain';

export interface EpiCatalogItem {
  id: string;
  name: string;
  ca: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EpiRecord {
  id: string;
  collaboratorId: string;
  catalogItemId?: string | null;
  epiName: string;
  ca: string;
  quantity: number;
  lendDate: string;
  devolutionDate?: string | null;
  signatureRequestId?: string | null;
  signatureImageDataUrl?: string | null;
  signatureSignerName?: string | null;
  signedAt?: string | null;
  pendingReturn?: boolean;
  returnSourceRecordId?: string | null;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  catalogItem?: EpiCatalogItem | null;
  signatureRequest?: {
    id: string;
    status: string;
    expiresAt: string;
    signedAt?: string | null;
  } | null;
}

export interface EpiCollaborator extends Collaborator {
  epiRecords: EpiRecord[];
}

export interface EpiRecordPayload {
  catalogItemId?: string | null;
  epiName: string;
  ca?: string | null;
  quantity: number;
  lendDate: string;
  devolutionDate?: string | null;
}

export interface EpiPublicSignaturePayload {
  status: 'ACTIVE' | 'SIGNED' | 'EXPIRED' | 'INVALID';
  expiresAt?: string | null;
  signedAt?: string | null;
  collaborator?: {
    id: string;
    name: string;
    role?: string | null;
    cpf?: string | null;
    registrationNumber?: string | null;
    admissionDate?: string | null;
  } | null;
  records: EpiRecord[];
}

export async function listEpiCollaborators() {
  const { data } = await apiClient.get<EpiCollaborator[]>(epiApiPath('/collaborators'));
  return data;
}

export async function updateEpiCollaboratorProfile(id: string, payload: { cpf?: string | null; registrationNumber?: string | null; admissionDate?: string | null }) {
  const { data } = await apiClient.put<EpiCollaborator>(epiApiPath(`/collaborators/${id}/profile`), payload);
  return data;
}

export async function listEpiCatalog() {
  const { data } = await apiClient.get<EpiCatalogItem[]>(epiApiPath('/catalog'));
  return data;
}

export async function createEpiCatalogItem(payload: { name: string; ca?: string | null; isActive?: boolean }) {
  const { data } = await apiClient.post<EpiCatalogItem>(epiApiPath('/catalog'), payload);
  return data;
}

export async function updateEpiCatalogItem(id: string, payload: Partial<{ name: string; ca: string; isActive: boolean }>) {
  const { data } = await apiClient.put<EpiCatalogItem>(epiApiPath(`/catalog/${id}`), payload);
  return data;
}

export async function removeEpiCatalogItem(id: string) {
  await apiClient.delete(epiApiPath(`/catalog/${id}`));
}

export async function createEpiRecord(collaboratorId: string, payload: EpiRecordPayload) {
  const { data } = await apiClient.post<EpiRecord>(epiApiPath(`/collaborators/${collaboratorId}/records`), payload);
  return data;
}

export async function updateEpiRecord(id: string, payload: Partial<EpiRecordPayload>) {
  const { data } = await apiClient.put<EpiRecord | { record: EpiRecord; token: string; signUrl: string }>(epiApiPath(`/records/${id}`), payload);
  return data;
}

export async function removeEpiRecord(id: string) {
  await apiClient.delete(epiApiPath(`/records/${id}`));
}

export async function archiveEpiRecords(collaboratorId: string, recordIds: string[], archived = true) {
  const { data } = await apiClient.post<EpiCollaborator>(
    epiApiPath(`/collaborators/${collaboratorId}/records/archive`),
    { recordIds, archived }
  );
  return data;
}

export async function requestEpiSignature(collaboratorId: string, recordIds: string[]) {
  const { data } = await apiClient.post<{ signUrl: string; token: string }>(
    epiApiPath(`/collaborators/${collaboratorId}/signature-requests`),
    { recordIds }
  );
  return data;
}

export async function downloadEpiCollaboratorPdf(collaboratorId: string, options: { archived?: boolean } = {}) {
  const { data } = await apiClient.get<Blob>(epiApiPath(`/collaborators/${collaboratorId}/pdf`), {
    params: options.archived ? { archived: 'true' } : undefined,
    responseType: 'blob'
  });
  return data;
}

export async function getEpiPublicSignature(token: string) {
  const { data } = await apiClient.get<EpiPublicSignaturePayload>(epiApiPath(`/public-sign/${encodeURIComponent(token)}`));
  return data;
}

export async function confirmEpiPublicSignature(token: string, payload: { signerName: string; signatureImageDataUrl: string }) {
  const { data } = await apiClient.post<{ success: boolean }>(epiApiPath(`/public-sign/${encodeURIComponent(token)}/confirm`), payload);
  return data;
}

export function epiPublicSignaturePdfUrl(token: string) {
  const baseUrl = String(apiClient.defaults.baseURL || '/api').replace(/\/+$/, '');
  return `${baseUrl}${epiApiPath(`/public-sign/${encodeURIComponent(token)}/pdf`)}`;
}
