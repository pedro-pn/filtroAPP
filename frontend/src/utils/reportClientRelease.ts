import type { ReportSummary } from '../types/domain';

export function isReportManuallyReleased(report: ReportSummary): boolean {
  return Boolean(report.clientReleasedAt && report.clientReleasedAt === report.updatedAt);
}
