import type { ApiCredentialPublic, CreateApiCredentialInput, ApiCredentialLimits, ApiProjectAccess } from './api-credentials.js';
export type ReductionFormValues = { expectedVersion: number; reason: string; scopeCodes: string[]; projectAccess: ApiProjectAccess; allowedIpCidrs: string[]; limits: ApiCredentialLimits; expiresAt?: string };
export function localCredentialDate(value?: string | Date | null): string;
export function reductionDefaults(credential: ApiCredentialPublic): ReductionFormValues;
export function buildReductionPayload(values: ReductionFormValues): Omit<ReductionFormValues, 'expiresAt'> & { expiresAt?: string };
export function makeReductionFormSchema(z: any, credential: ApiCredentialPublic, scopes?: Array<{ code: string; requiredScopes: string[] }>): any;
export function rotationDefaults(credential: ApiCredentialPublic, now?: Date): CreateApiCredentialInput;
export function makeActionConfirmationSchema(z: any, action: 'rotate' | 'revoke'): any;
