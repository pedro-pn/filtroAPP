export type IntegrationPageMeta = { nextCursor: string | null; limit: number; hasMore: boolean; snapshotAt: string };
export type IntegrationEnvelope<T> = { items: T[]; page: IntegrationPageMeta; generatedAt: string; schemaVersion: '1.0'; requestId: string };
export type IntegrationError = { code: string; message: string; requestId: string; fields?: Array<{ path: string; message: string }> };
export const INTEGRATION_REPORT_TYPES: readonly ['RDO', 'RDO_MAINTENANCE', 'RDO_PRODUCTION', 'RTP', 'RLQ', 'RCPU', 'RLM', 'RLF', 'RLI'];
export type QualityRecordsQuery = {
  limit?: number; cursor?: string; updatedSince?: string; updatedUntil?: string; snapshotAt?: string; projectId?: string; projectCode?: string; natureId?: string;
  eventDateFrom?: string; eventDateTo?: string;
  status?: string[]; type?: string[]; includeDeleted?: boolean;
};
export function makeIntegrationApiSchemas(zod: any, options?: { globalMaxPageSize?: number }): Record<string, any>;
export function makeOperationalReadQuerySchema(zod: any, options?: { maxPageSize?: number }): any;
