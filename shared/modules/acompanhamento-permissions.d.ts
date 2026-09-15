export type AcompanhamentoExtraPermission = 'VIEW_PROJECT_TAXES_AND_BILLING';
export const PROJECT_TAXES_AND_BILLING: AcompanhamentoExtraPermission;

interface AcompanhamentoAccount {
  accountType?: string;
  moduleRoles?: readonly string[];
  acompanhamentoExtraPermissions?: readonly string[];
}

export function canReceiveAcompanhamentoExtraPermissions(user: AcompanhamentoAccount | null | undefined): boolean;
export function canViewProjectFinancials(user: AcompanhamentoAccount | null | undefined): boolean;
export function normalizeAcompanhamentoExtraPermissions(value: readonly string[] | null | undefined, user: AcompanhamentoAccount): AcompanhamentoExtraPermission[];
