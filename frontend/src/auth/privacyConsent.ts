import { CLIENT_PRIVACY_NOTICE_VERSION } from '../constants/privacy';
import type { AuthUser } from '../types/auth';

export function needsClientPrivacyConsent(user: AuthUser | null | undefined) {
  if (!user || (user.accountType !== 'CLIENT' && user.role !== 'CLIENT')) return false;
  return user.privacyPolicyRequired === true || user.privacyPolicyVersion !== CLIENT_PRIVACY_NOTICE_VERSION;
}
