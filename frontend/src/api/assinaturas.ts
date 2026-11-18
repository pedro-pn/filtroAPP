import { ApiClientError, apiClient } from './client';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';
const BASE_PATH = '/assinaturas';

export type SignatureDocumentStatus = 'RASCUNHO' | 'AGUARDANDO_ASSINATURAS' | 'FINALIZANDO' | 'CONCLUIDO' | 'CANCELADO';
export type SignatureSignerStatus = 'PENDENTE' | 'VISUALIZADO' | 'ASSINADO' | 'EXPIRADO' | 'REVOGADO';

export interface SignatureField {
  id?: string;
  signerId: string;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  pageWidthPt?: number;
  pageHeightPt?: number;
  pageRotation?: number;
}

export interface SignatureSigner {
  id: string;
  name: string;
  email: string | null;
  position: number;
  status: SignatureSignerStatus;
  signedAt: string | null;
  viewedAt: string | null;
  tokenExpiresAt: string | null;
  emailStatus: string;
}

export interface SignatureDocumentCard {
  id: string;
  title: string;
  originalFileName: string;
  status: SignatureDocumentStatus;
  pageCount: number;
  signerCount: number;
  signedCount: number;
  progressLabel: string;
  hasExpiredInvites: boolean;
  isArchived: boolean;
  createdAt: string;
  completedAt: string | null;
}

export interface SignatureDocument extends SignatureDocumentCard {
  archivedAt: string | null;
  deletedAt: string | null;
  pageDimensions: Array<{ page: number; widthPt: number; heightPt: number; rotation: number }>;
  signers: SignatureSigner[];
  fields: SignatureField[];
  progress: { signed: number; total: number };
}

export interface SignatureDocumentList {
  items: SignatureDocumentCard[];
  nextCursor: string | null;
}

export interface SignatureAuditItem {
  id: string;
  action: string;
  description: string | null;
  signerId: string | null;
  actorUserId: string | null;
  createdAt: string;
}

export interface PublicSignatureInvite {
  status: 'ATIVO' | 'ASSINADO';
  expiresAt: string;
  document: {
    title: string;
    originalFileName: string;
    pageCount: number;
    status: SignatureDocumentStatus;
    sourceDocumentHash: string;
    requestedBy: string;
    progress: { signed: number; total: number };
  };
  signer: { name: string; status: SignatureSignerStatus; signedAt: string | null };
  fields: Omit<SignatureField, 'id' | 'signerId'>[];
  downloadAvailable: boolean;
}

export function assinaturaApiPath(path: string) {
  return `${BASE_PATH}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function listSignatureDocuments(params?: Record<string, string | number | boolean | undefined>) {
  const response = await apiClient.get<SignatureDocumentList>(assinaturaApiPath('/documentos'), { params });
  return response.data;
}

export async function getSignatureDocument(id: string) {
  const response = await apiClient.get<SignatureDocument>(assinaturaApiPath(`/documentos/${id}`));
  return response.data;
}

export async function createSignatureDocument(payload: { fileName: string; pdfDataUrl: string; title?: string }) {
  const response = await apiClient.post<SignatureDocument>(assinaturaApiPath('/documentos'), payload);
  return response.data;
}

export async function replaceDocumentSigners(id: string, signers: Array<Pick<SignatureSigner, 'name' | 'email' | 'position'> & { id?: string }>) {
  const response = await apiClient.put<SignatureDocument>(assinaturaApiPath(`/documentos/${id}/assinantes`), signers);
  return response.data;
}

export async function replaceDocumentFields(id: string, fields: SignatureField[]) {
  const payload = fields.map(({ signerId, pageNumber, x, y, width, height }) => ({ signerId, pageNumber, x, y, width, height }));
  const response = await apiClient.put<SignatureDocument>(assinaturaApiPath(`/documentos/${id}/campos`), payload);
  return response.data;
}

export async function publishSignatureDocument(id: string, payload: { expiresInDays: number } | { expiresAt: string }) {
  const response = await apiClient.post(assinaturaApiPath(`/documentos/${id}/publicar`), payload);
  return response.data;
}

export async function unpublishSignatureDocument(id: string) {
  const response = await apiClient.post<SignatureDocument>(assinaturaApiPath(`/documentos/${id}/despublicar`));
  return response.data;
}

export async function recoverSignatureInviteLink(documentId: string, signerId: string) {
  const response = await apiClient.get<{ url: string; expiresAt: string }>(assinaturaApiPath(`/documentos/${documentId}/assinantes/${signerId}/link`));
  return response.data;
}

export async function renewSignatureInvite(documentId: string, signerId: string, expiresInDays = 15) {
  const response = await apiClient.post<{ url: string; expiresAt: string }>(assinaturaApiPath(`/documentos/${documentId}/assinantes/${signerId}/renovar`), { expiresInDays });
  return response.data;
}

export async function revokeSignatureInvite(documentId: string, signerId: string) {
  const response = await apiClient.post(assinaturaApiPath(`/documentos/${documentId}/assinantes/${signerId}/revogar`));
  return response.data;
}

export async function resendSignatureInviteEmail(documentId: string, signerId: string) {
  const response = await apiClient.post(assinaturaApiPath(`/documentos/${documentId}/assinantes/${signerId}/reenviar-email`));
  return response.data;
}

export async function listSignatureAudit(documentId: string, cursor?: string) {
  const response = await apiClient.get<{ items: SignatureAuditItem[]; nextCursor: string | null }>(assinaturaApiPath(`/documentos/${documentId}/auditoria`), { params: { cursor } });
  return response.data;
}

export async function cancelSignatureDocument(id: string, reason?: string) {
  const response = await apiClient.post(assinaturaApiPath(`/documentos/${id}/cancelar`), reason ? { reason } : {});
  return response.data;
}

export async function archiveSignatureDocument(id: string) {
  const response = await apiClient.post(assinaturaApiPath(`/documentos/${id}/arquivar`));
  return response.data;
}

export async function restoreArchivedSignatureDocument(id: string) {
  const response = await apiClient.post(assinaturaApiPath(`/documentos/${id}/restaurar`));
  return response.data;
}

export async function deleteSignatureDocument(id: string) {
  await apiClient.delete(assinaturaApiPath(`/documentos/${id}`));
}

export async function restoreDeletedSignatureDocument(id: string) {
  const response = await apiClient.post(assinaturaApiPath(`/documentos/${id}/restaurar-excluido`));
  return response.data;
}

export async function downloadSignaturePdf(id: string, final = false) {
  const response = await apiClient.get<Blob>(assinaturaApiPath(`/documentos/${id}/${final ? 'pdf-final' : 'pdf'}`), { responseType: 'blob' });
  return response.data;
}

export async function downloadSignaturePage(id: string, pageNumber: number) {
  const response = await apiClient.get<Blob>(assinaturaApiPath(`/documentos/${id}/paginas/${pageNumber}.png`), { responseType: 'blob' });
  return response.data;
}

async function publicRequest(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`${API_BASE_URL}${assinaturaApiPath(path)}`, {
    ...init,
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
      'X-Signature-Token': token
    }
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string; code?: string } | null;
    throw new ApiClientError(payload?.error || 'Não foi possível carregar o convite.', response.status, { code: payload?.code });
  }
  return response;
}

export async function getPublicSignatureInvite(token: string) {
  const response = await publicRequest('/publico', token);
  return response.json() as Promise<PublicSignatureInvite>;
}

export async function confirmPublicSignature(token: string, payload: {
  signerName: string;
  signatureImageDataUrl: string;
  privacyNoticeAccepted: boolean;
  privacyNoticeVersion: string;
}) {
  const response = await publicRequest('/publico/assinar', token, { method: 'POST', body: JSON.stringify(payload) });
  return response.json() as Promise<{ success: true; documentStatus: SignatureDocumentStatus; downloadAvailable: boolean }>;
}

export async function publicSignaturePdf(token: string) {
  return (await publicRequest('/publico/pdf', token)).blob();
}

export async function publicSignaturePage(token: string, pageNumber: number) {
  return (await publicRequest(`/publico/paginas/${pageNumber}.png`, token)).blob();
}
