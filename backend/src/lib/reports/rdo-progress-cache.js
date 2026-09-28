import prisma from '../prisma.js';

export async function plannedServiceCountForRdo(projectId) {
  return prisma.projectPlannedService.count({ where: { projectId } });
}

export async function hasRdoProgressSourcesChanged(report, metadata, pdfModifiedAtMs) {
  const endOfDay = new Date(report.reportDate);
  endOfDay.setUTCHours(23, 59, 59, 999);
  const [latestRdo, latestPlannedService, plannedServiceCount] = await Promise.all([
    prisma.report.findFirst({
      where: { projectId: report.projectId, reportType: 'RDO', reportDate: { lte: endOfDay } },
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true }
    }),
    prisma.projectPlannedService.findFirst({
      where: { projectId: report.projectId },
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true }
    }),
    plannedServiceCountForRdo(report.projectId)
  ]);
  return (latestRdo?.updatedAt?.getTime() ?? 0) > pdfModifiedAtMs
    || (latestPlannedService?.updatedAt?.getTime() ?? 0) > pdfModifiedAtMs
    || metadata.plannedServiceCount !== plannedServiceCount;
}
