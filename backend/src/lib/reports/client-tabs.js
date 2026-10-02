import { ReportStatus } from '@prisma/client';

export function clientReportTypeTabs(reports, canClientSeeReport) {
  const byId = new Map(reports.map(report => [report.id, report]));
  const groups = new Map();
  for (const report of reports) {
    const available = canClientSeeReport(report, byId);
    if (!available && report.status !== ReportStatus.APPROVED && report.status !== ReportStatus.SIGNED) continue;
    const key = `${report.projectId}::${report.reportType}`;
    const current = groups.get(key);
    if (current) current.available ||= available;
    else groups.set(key, { projectId: report.projectId, reportType: report.reportType, available });
  }
  return [...groups.values()];
}
