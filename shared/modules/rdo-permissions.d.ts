export type RdoExtraPermission = 'REVIEW_REPORTS';
export const REVIEW_REPORTS: RdoExtraPermission;

export interface RdoAccount {
  role?: string | null;
  accountType?: string | null;
  moduleRoles?: readonly string[];
  rdoExtraPermissions?: readonly string[];
}

export function canReceiveRdoExtraPermissions(user: RdoAccount | null | undefined): boolean;

export function canReviewRdoReports(user: RdoAccount | null | undefined): boolean;

export function normalizeRdoExtraPermissions(value: readonly string[] | null | undefined, user: RdoAccount): RdoExtraPermission[];
