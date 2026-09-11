export const API_PROJECT_ACCESS_MODES: readonly ['ALL', 'SELECTED'];
export const API_ALLOWED_FORMATS: readonly ['JSON'];
export const API_CREDENTIAL_STATUSES: readonly ['SCHEDULED', 'ACTIVE', 'NEAR_EXPIRY', 'EXPIRED', 'REVOKED'];
export const NEVER_EXPIRES_CONFIRMATION: 'SEM EXPIRAÇÃO';

export type ApiProjectAccess = { mode: 'ALL' | 'SELECTED'; projectIds: string[] };
export type ApiCredentialLimits = { requestsPerMinute: number; requestsPerDay: number; rowsPerDay: number; maxPageSize: number };
export type CreateApiCredentialInput = {
  name: string; purpose: string; recipientName: string; recipientContact?: string | null; description?: string | null;
  startsAt: string; expiresAt: string | null; neverExpiresConfirmation?: string; scopeCodes: string[];
  projectAccess: ApiProjectAccess; allowedIpCidrs: string[]; allowedFormats: ['JSON']; limits: ApiCredentialLimits;
};
export type ApiCredentialPublic = Omit<CreateApiCredentialInput, 'neverExpiresConfirmation'> & {
  id: string; displayToken: string; effectiveStatus: 'SCHEDULED' | 'ACTIVE' | 'NEAR_EXPIRY' | 'EXPIRED' | 'REVOKED';
  lastUsedAt?: string | null; revokedAt?: string | null; revocationReason?: string | null; version: number;
  createdAt: string; updatedAt: string; rotatedFromId?: string | null; replacementId?: string | null; overlapEndsAt?: string | null;
  recentUsage?: { windowStart: string; requests: number; rows: number; bytes: number } | null;
};
export type ApiCredentialSchemas = Record<'create' | 'reduce' | 'rotate' | 'revoke' | 'playground' | 'projectAccess' | 'limits' | 'scopeCodes', any>;
export function makeApiCredentialSchemas(zod: any, options?: { globalMaxPageSize?: number; allowLocalDateTime?: boolean }): ApiCredentialSchemas;
