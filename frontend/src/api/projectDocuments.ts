import { apiClient } from './client';

export type ProjectDocumentType = 'COMMERCIAL_PROPOSAL' | 'TECHNICAL_PROPOSAL' | 'PURCHASE_ORDER' | 'CONTRACT' | 'DRAWING' | 'SPECIFICATION' | 'CERTIFICATE' | 'CLIENT_REQUIREMENT' | 'TECHNICAL_EVIDENCE' | 'OTHER';
export type ProjectDocumentRequirementStage = 'HANDOVER' | 'MOBILIZATION' | 'CLOSEOUT';
export type ProjectDocumentAcceptanceMode = 'NONE' | 'INTERNAL' | 'CLIENT' | 'SIGNATURE';
export type ProjectDocumentAcceptanceStatus = 'NOT_REQUIRED' | 'PENDING' | 'ACCEPTED' | 'REJECTED';
export type ProjectDocumentSource = 'MANUAL' | 'CRM' | 'SYSTEM';
export const PROJECT_DOCUMENT_TYPE_OPTIONS: Array<{ key: ProjectDocumentType; label: string }> = [
  { key: 'COMMERCIAL_PROPOSAL', label: 'Proposta comercial' },
  { key: 'TECHNICAL_PROPOSAL', label: 'Proposta técnica' },
  { key: 'PURCHASE_ORDER', label: 'Pedido de compra' },
  { key: 'CONTRACT', label: 'Contrato' },
  { key: 'DRAWING', label: 'Desenho' },
  { key: 'SPECIFICATION', label: 'Especificação' },
  { key: 'CERTIFICATE', label: 'Certificado' },
  { key: 'CLIENT_REQUIREMENT', label: 'Requisito do cliente' },
  { key: 'TECHNICAL_EVIDENCE', label: 'Evidência técnica' },
  { key: 'OTHER', label: 'Outro' }
];

export interface ProjectDocumentVersion {
  id: string;
  sequence: number;
  versionLabel: string | null;
  source: ProjectDocumentSource;
  contentKind: 'MANAGED_FILE' | 'EXTERNAL_REFERENCE';
  originalFileName: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  sha256: string | null;
  externalId: string | null;
  externalUrl: string | null;
  sourceVersion: string | null;
  sourceUpdatedAt: string | null;
  lastSyncedAt: string | null;
  signature: null | {
    id: string;
    status: string;
    completedAt: string | null;
    openUrl: string;
    finalFileUrl: string | null;
  };
  acceptanceStatus: ProjectDocumentAcceptanceStatus;
  acceptanceOccurredOn: string | null;
  acceptanceReference: string | null;
  acceptanceNote: string | null;
  acceptanceRecordedAt: string | null;
  acceptanceRecordedBy: { id: string; name: string } | null;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
  downloadUrl: string | null;
}

export interface ProjectDocument {
  id: string;
  projectId: string;
  type: ProjectDocumentType;
  title: string;
  description: string | null;
  responsible: { id: string; name: string } | null;
  requirementStage: ProjectDocumentRequirementStage | null;
  acceptanceMode: ProjectDocumentAcceptanceMode;
  version: number;
  archivedAt: string | null;
  archivedBy: { id: string; name: string } | null;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
  updatedAt: string;
  updatedBy: { id: string; name: string } | null;
  currentVersion: ProjectDocumentVersion | null;
  versions?: ProjectDocumentVersion[];
  readiness: { ready: boolean; reasonCode: string; reason: string };
  permissions: {
    update: boolean;
    addVersion: boolean;
    recordAcceptance: boolean;
    prepareSignature: boolean;
    archive: boolean;
  };
}

export interface ProjectDocumentRequirementSummary {
  ready: boolean;
  readyCount: number;
  totalCount: number;
  blockers: Array<{ documentId: string; title: string; reasonCode: string; reason: string }>;
}

export interface ProjectOperationalDocument {
  id: string;
  kind: 'RDO' | 'TECHNICAL_REPORT';
  title: string;
  status: string;
  issuedAt: string | null;
  acceptedAt: string | null;
  sourceRoute: string;
  downloadUrl: string;
}

export interface ProjectDocumentsResponse {
  documents: ProjectDocument[];
  requirements: Record<ProjectDocumentRequirementStage, ProjectDocumentRequirementSummary>;
  operationalDocuments: ProjectOperationalDocument[];
  projectReadOnly: boolean;
  allowedTypes: ProjectDocumentType[];
}

export interface ProjectDocumentCreateInput {
  type: ProjectDocumentType;
  title: string;
  description?: string | null;
  responsibleUserId?: string | null;
  requirementStage?: ProjectDocumentRequirementStage | null;
  acceptanceMode: ProjectDocumentAcceptanceMode;
  initialVersion?: { versionLabel?: string | null; fileName: string; dataUrl: string };
}

export interface ProjectDocumentUpdateInput {
  expectedVersion: number;
  type?: ProjectDocumentType;
  title?: string;
  description?: string | null;
  responsibleUserId?: string | null;
  requirementStage?: ProjectDocumentRequirementStage | null;
  acceptanceMode?: ProjectDocumentAcceptanceMode;
}

const base = '/efetivo/project-workflow';
const documentBase = (projectId: string) => `${base}/${encodeURIComponent(projectId)}/documents`;
const documentPath = (projectId: string, documentId: string) => `${documentBase(projectId)}/${encodeURIComponent(documentId)}`;

export const projectDocumentsQueryKey = (projectId: string) => ['project-documents', projectId] as const;

export async function listProjectDocuments(projectId: string, includeArchived = false) {
  return (await apiClient.get<ProjectDocumentsResponse>(documentBase(projectId), {
    params: { includeArchived, includeHistory: true }
  })).data;
}

export async function createProjectDocument(projectId: string, input: ProjectDocumentCreateInput) {
  return (await apiClient.post<{ document: ProjectDocument; workflowVersion: number | null; authorizationInvalidated: boolean }>(documentBase(projectId), input)).data;
}

export async function updateProjectDocument(projectId: string, documentId: string, input: ProjectDocumentUpdateInput) {
  return (await apiClient.patch<{ document: ProjectDocument; workflowVersion: number | null; authorizationInvalidated: boolean }>(documentPath(projectId, documentId), input)).data;
}

export async function addProjectDocumentVersion(projectId: string, documentId: string, input: { expectedVersion: number; versionLabel?: string | null; fileName: string; dataUrl: string }) {
  return (await apiClient.post<{ document: ProjectDocument; workflowVersion: number | null; authorizationInvalidated: boolean }>(`${documentPath(projectId, documentId)}/versions`, input)).data;
}

export async function recordProjectDocumentAcceptance(projectId: string, documentId: string, input: { expectedVersion: number; versionId: string; status: 'ACCEPTED' | 'REJECTED'; occurredOn: string; reference?: string | null; note?: string | null }) {
  return (await apiClient.post<{ document: ProjectDocument; workflowVersion: number | null; authorizationInvalidated: boolean }>(`${documentPath(projectId, documentId)}/acceptance`, input)).data;
}

export async function prepareProjectDocumentSignature(projectId: string, documentId: string, input: { expectedVersion: number; versionId: string }) {
  return (await apiClient.post<{ signatureDocumentId: string; status: string; openUrl: string }>(`${documentPath(projectId, documentId)}/signature`, input)).data;
}

export async function archiveProjectDocument(projectId: string, documentId: string, expectedVersion: number) {
  return (await apiClient.post(`${documentPath(projectId, documentId)}/archive`, { expectedVersion })).data;
}

export async function restoreProjectDocument(projectId: string, documentId: string, expectedVersion: number) {
  return (await apiClient.post(`${documentPath(projectId, documentId)}/restore`, { expectedVersion })).data;
}

export async function fetchProjectDocumentFile(url: string) {
  return (await apiClient.get<Blob>(url, { responseType: 'blob' })).data;
}
