export const SIGNATURE_RDO_NOTICE_VERSION = 'signature_rdo_v1';
export const SIGNATURE_EPI_NOTICE_VERSION = 'signature_epi_v1';
export const SURVEY_NOTICE_VERSION = 'survey_notice_v1';
export const CLIENT_PRIVACY_NOTICE_VERSION = 'client_account_privacy_v1';
export const COLLABORATOR_SIGNATURE_NOTICE_VERSION = 'collaborator_signature_v1';
export const PRIVACY_NOTICE_LEGACY_ROLLOUT_COMPAT_ENABLED = process.env.PRIVACY_NOTICE_LEGACY_ROLLOUT_COMPAT_ENABLED === 'true';

export function validatePrivacyNoticeAcknowledgement(body, currentVersion, { legacyVersions = [] } = {}) {
  const hasAccepted = Object.prototype.hasOwnProperty.call(body || {}, 'privacyNoticeAccepted');
  const hasVersion = Object.prototype.hasOwnProperty.call(body || {}, 'privacyNoticeVersion');
  const version = String(body?.privacyNoticeVersion || '').trim();

  if (!hasAccepted && !hasVersion && PRIVACY_NOTICE_LEGACY_ROLLOUT_COMPAT_ENABLED) {
    return null;
  }
  if (body?.privacyNoticeAccepted !== true) {
    return 'Confirme a ciência do aviso de privacidade.';
  }
  if (version !== currentVersion && !legacyVersions.includes(version)) {
    return 'Versão do aviso de privacidade inválida.';
  }
  return null;
}

export function isClientAccount(user) {
  return user?.accountType === 'CLIENT' || user?.role === 'CLIENT';
}

export function clientPrivacyConsentRequired(user) {
  if (!isClientAccount(user)) return false;
  return user.privacyPolicyVersion !== CLIENT_PRIVACY_NOTICE_VERSION;
}

export function isClientPrivacyConsentAllowedRoute(req) {
  const method = String(req.method || '').toUpperCase();
  const path = String(req.originalUrl || req.url || '').split('?')[0];
  return (
    (method === 'GET' && path.endsWith('/auth/me')) ||
    (method === 'POST' && path.endsWith('/auth/logout')) ||
    (method === 'POST' && path.endsWith('/auth/client-privacy-consent')) ||
    (method === 'GET' && path.endsWith('/privacy/me/data-export')) ||
    (method === 'POST' && path.endsWith('/privacy/me/delete-request'))
  );
}
