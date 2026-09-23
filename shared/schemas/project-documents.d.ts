export type ProjectDocumentType = 'COMMERCIAL_PROPOSAL' | 'TECHNICAL_PROPOSAL' | 'PURCHASE_ORDER' | 'CONTRACT' | 'DRAWING' | 'SPECIFICATION' | 'CERTIFICATE' | 'CLIENT_REQUIREMENT' | 'TECHNICAL_EVIDENCE' | 'OTHER';
export type ProjectDocumentRequirementStage = 'HANDOVER' | 'MOBILIZATION' | 'CLOSEOUT';
export type ProjectDocumentAcceptanceMode = 'NONE' | 'INTERNAL' | 'CLIENT' | 'SIGNATURE';
export type ProjectDocumentSource = 'MANUAL' | 'CRM' | 'SYSTEM';
export type ProjectDocumentContentKind = 'MANAGED_FILE' | 'EXTERNAL_REFERENCE';
export type ProjectDocumentAcceptanceStatus = 'NOT_REQUIRED' | 'PENDING' | 'ACCEPTED' | 'REJECTED';
export type ProjectDocumentCrmOutcome = 'CREATED' | 'CURRENT_UPDATED' | 'REPLAYED' | 'IGNORED_OLDER';

export const PROJECT_DOCUMENT_TYPES: ReadonlyArray<{ key: ProjectDocumentType; label: string }>;
export const PROJECT_DOCUMENT_REQUIREMENT_STAGES: ReadonlyArray<{ key: ProjectDocumentRequirementStage; label: string }>;
export const PROJECT_DOCUMENT_ACCEPTANCE_MODES: ReadonlyArray<{ key: ProjectDocumentAcceptanceMode; label: string }>;
export const PROJECT_DOCUMENT_SOURCES: readonly ProjectDocumentSource[];
export const PROJECT_DOCUMENT_CONTENT_KINDS: readonly ProjectDocumentContentKind[];
export const PROJECT_DOCUMENT_ACCEPTANCE_STATUSES: readonly ProjectDocumentAcceptanceStatus[];
export const PROJECT_DOCUMENT_CRM_OUTCOMES: readonly ProjectDocumentCrmOutcome[];
export const PROJECT_DOCUMENT_ALLOWED_EXTENSIONS: readonly string[];
export function makeProjectDocumentSchemas(z: typeof import('zod').z): {
  list: import('zod').ZodType<Record<string, unknown>>;
  create: import('zod').ZodType<Record<string, unknown>>;
  patch: import('zod').ZodType<Record<string, unknown>>;
  addVersion: import('zod').ZodType<Record<string, unknown>>;
  acceptance: import('zod').ZodType<Record<string, unknown>>;
  expected: import('zod').ZodType<Record<string, unknown>>;
  signature: import('zod').ZodType<Record<string, unknown>>;
  crm: import('zod').ZodType<Record<string, unknown>>;
  id: import('zod').ZodType<string>;
};
