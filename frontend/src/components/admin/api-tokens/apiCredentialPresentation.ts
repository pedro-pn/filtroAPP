import type { ApiCredentialPublic } from '../../../../../shared/schemas/api-credentials.js';

export const apiCredentialStatusLabels: Record<ApiCredentialPublic['effectiveStatus'], string> = {
  SCHEDULED: 'Agendado', ACTIVE: 'Ativo', NEAR_EXPIRY: 'Vence em breve', EXPIRED: 'Expirado', REVOKED: 'Revogado'
};

export const apiCredentialStatusTones: Record<ApiCredentialPublic['effectiveStatus'], 'success' | 'warning' | 'danger' | 'neutral'> = {
  SCHEDULED: 'neutral', ACTIVE: 'success', NEAR_EXPIRY: 'warning', EXPIRED: 'danger', REVOKED: 'danger'
};

export function apiCredentialDateLabel(value?: string | null) {
  return value ? new Date(value).toLocaleString('pt-BR') : '—';
}
