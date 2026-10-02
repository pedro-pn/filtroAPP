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

export function createClientReportTabsHandler({ prisma, buildReportListWhere, canClientSeeReport }) {
  return async (req, res) => {
    if (req.auth.user.role !== 'CLIENT') return res.status(403).json({ error: 'Acesso restrito ao cliente.' });
    const { where } = await buildReportListWhere(req.auth, {});
    const reports = await prisma.report.findMany({
      where,
      select: {
        id: true,
        projectId: true,
        reportType: true,
        status: true,
        reportDate: true,
        sequenceNumber: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
        clientReleasedAt: true,
        specialConditions: true,
        clientReviews: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { action: true, createdAt: true }
        },
        project: { select: { clientCnpj: true, deletedAt: true } }
      }
    });
    res.json(clientReportTypeTabs(reports, canClientSeeReport));
  };
}
