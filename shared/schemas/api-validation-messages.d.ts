export type ApiValidationIssue = {
  code?: string;
  input?: unknown;
  expected?: string;
  origin?: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  inclusive?: boolean;
  format?: string;
  divisor?: number;
};
export function apiValidationError(issue: ApiValidationIssue): string | undefined;
