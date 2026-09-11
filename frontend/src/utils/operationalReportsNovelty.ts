import type { AuthUser } from '../types/auth';

export const OPERATIONAL_REPORTS_NOVELTY_EXPIRES_AT = new Date(
  '2026-09-14T23:59:59-03:00'
);

export const OPERATIONAL_REPORTS_NOVELTY_STORAGE_PREFIX =
  'filtrovali:operational-reports-hub-novelty:v2:';
export const OPERATIONAL_MODULE_TUTORIAL_STORAGE_PREFIX =
  'filtrovali:operational-module-tutorial:v1:';

export function canStartOperationalReportsNovelty({
  user,
  eligible,
  now = Date.now(),
  seen = false
}: {
  user: Pick<AuthUser, 'id'> | null | undefined;
  eligible: boolean;
  now?: number;
  seen?: boolean;
}) {
  return Boolean(
    user &&
      eligible &&
      now <= OPERATIONAL_REPORTS_NOVELTY_EXPIRES_AT.getTime() &&
      !seen
  );
}

export function canStartOperationalModuleTutorial({
  user,
  eligible,
  seen = false
}: {
  user: Pick<AuthUser, 'id'> | null | undefined;
  eligible: boolean;
  seen?: boolean;
}) {
  return Boolean(user && eligible && !seen);
}
