export type ReportEditorOperationalMode = 'full' | 'team-only' | 'hidden';

interface ReportEditorOperationalModeInput {
  manualReport: boolean;
  serviceOnly: boolean;
  derivedServiceReport: boolean;
}

export function reportEditorOperationalMode({
  manualReport,
  serviceOnly,
  derivedServiceReport
}: ReportEditorOperationalModeInput): ReportEditorOperationalMode {
  if (manualReport) return 'full';
  if (serviceOnly) return 'team-only';
  if (derivedServiceReport) return 'hidden';
  return 'full';
}
