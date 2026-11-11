import prisma from '../prisma.js';

export async function plannedServiceCountForRdo(projectId, client = prisma) {
  return client.projectPlannedService.count({ where: { projectId } });
}

export async function hasRdoProgressSourcesChanged(report, metadata, pdfModifiedAtMs, client = prisma) {
  const endOfDay = new Date(report.reportDate);
  endOfDay.setUTCHours(23, 59, 59, 999);
  const [latestRdo, latestPlannedService, plannedServiceCount] = await Promise.all([
    client.report.findFirst({
      where: { projectId: report.projectId, reportType: 'RDO', reportDate: { lte: endOfDay } },
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true }
    }),
    client.projectPlannedService.findFirst({
      where: { projectId: report.projectId },
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true }
    }),
    plannedServiceCountForRdo(report.projectId, client)
  ]);
  return (latestRdo?.updatedAt?.getTime() ?? 0) > pdfModifiedAtMs
    || (latestPlannedService?.updatedAt?.getTime() ?? 0) > pdfModifiedAtMs
    || metadata.plannedServiceCount !== plannedServiceCount;
}
