import { apiClient, rdoApiPath } from './client';

export type DatabookPhase = 'UNSPECIFIED' | 'BEFORE' | 'DURING' | 'AFTER';
export interface DatabookPhotoSelection { key: string; caption: string; tag: string; phase: DatabookPhase }
export interface DatabookProductSelection { itemId: string; documentId: string; revision: string; confirmed: boolean }
export interface DatabookInput {
  title: string; startDate: string; endDate: string; summary: string; productsReviewed: boolean;
  reportIds: string[]; photos: DatabookPhotoSelection[]; products: DatabookProductSelection[];
  documentVersionIds: string[]; previousId?: string;
}
export interface DatabookRecord {
  id: string; projectId: string; familyId: string; revision: number; title: string;
  startDate: string; endDate: string; status: 'PENDING' | 'RUNNING' | 'FAILED' | 'COMPLETED';
  progress: number; attempts: number; error: string | null; createdByName: string;
  createdAt: string; completedAt: string | null; options: DatabookInput; warnings: string[];
  pdfSha256: string | null; zipSha256: string | null;
}
export interface DatabookHistory {
  project: { id: string; code: string; name: string };
  permissions: { canRead: boolean; canGenerate: boolean };
  defaults: { startDate: string | null; endDate: string | null }; items: DatabookRecord[];
}
export interface DatabookReportSource {
  id: string; reportType: string; sequenceNumber: number | null; date: string; status: string;
  clientReleased: boolean; clientSigned: boolean; clientAccepted: boolean; pendingSignatures: number;
  clientSignaturesSigned?: number; clientSignaturesRequired?: number;
  description: string; services: Array<{ id: string; type: string; system: string; material: string; equipment: string; finalized: boolean | null }>;
}
export interface DatabookPhotoSource {
  key: string; reportId: string; reportServiceId: string | null; reportLabel: string;
  date: string; label: string; fileName: string; mimeType: string; service: string; system: string;
}
export interface DatabookProductSource {
  id: string; code: string; name: string; manufacturer: string | null; unitLabel: string;
  casNumber: string | null; unNumber: string | null;
  documents: Array<{ id: string; fileName: string; createdAt: string }>;
  movements: Array<{ id: string; date: string; quantity: number; lot: string; inPeriod: boolean }>;
}
export interface DatabookSources {
  reports: DatabookReportSource[]; photos: DatabookPhotoSource[]; products: DatabookProductSource[];
  documents: Array<{ id: string; title: string; type: string; versionId: string; versionLabel: string | null;
    fileName: string | null; contentKind: string; acceptanceStatus: string }>;
}
const base = (projectId: string) => rdoApiPath(`/projects/${encodeURIComponent(projectId)}/databooks`);
export async function listDatabooks(projectId: string) { return (await apiClient.get<DatabookHistory>(base(projectId))).data; }
export async function getDatabookSources(projectId: string, period: { startDate: string; endDate: string }) {
  return (await apiClient.get<DatabookSources>(`${base(projectId)}/sources`, { params: period })).data;
}
export async function createDatabook(projectId: string, input: DatabookInput) {
  return (await apiClient.post<DatabookRecord>(base(projectId), input)).data;
}
export async function retryDatabook(projectId: string, id: string) {
  return (await apiClient.post<DatabookRecord>(`${base(projectId)}/${encodeURIComponent(id)}/retry`, {})).data;
}
export async function downloadDatabook(projectId: string, id: string, kind: 'pdf' | 'zip') {
  return (await apiClient.get<Blob>(`${base(projectId)}/${encodeURIComponent(id)}/${kind}`, { responseType: 'blob' })).data;
}
export async function getDatabookPhoto(projectId: string, photo: DatabookPhotoSource, period: { startDate: string; endDate: string }) {
  return (await apiClient.get<Blob>(`${base(projectId)}/photos/${photo.key}`, { params: { ...period, reportId: photo.reportId }, responseType: 'blob' })).data;
}
export async function getDatabookStockDocument(projectId: string, id: string) {
  return (await apiClient.get<Blob>(`${base(projectId)}/stock-documents/${encodeURIComponent(id)}`, { responseType: 'blob' })).data;
}
