import { ReportStatus, ReportType } from '@prisma/client';

export function isManualClientReleaseActive(report) {
  if (!report?.clientReleasedAt || !report?.updatedAt) return false;
  return new Date(report.clientReleasedAt).getTime() === new Date(report.updatedAt).getTime();
}

export function canClientSeeReportWithRules(report, allReportsById, {
  isReportUnavailable,
  hasActiveClientRejection,
  previousRdosSignedForServiceReport
}) {
  if (isReportUnavailable(report)) return false;
  if (!report || !report.project?.clientCnpj) return false;
  if (report.reportType === ReportType.RDO) {
    return report.status === ReportStatus.APPROVED || report.status === ReportStatus.SIGNED || hasActiveClientRejection(report);
  }
  if (report.specialConditions?.serviceOnly === true) {
    return report.status === ReportStatus.APPROVED || report.status === ReportStatus.SIGNED;
  }
  const parentId = report.specialConditions?.parentRdoId;
  if (!parentId) return false;
  const parent = allReportsById.get(parentId);
  if (!parent || parent.reportType !== ReportType.RDO || parent.projectId !== report.projectId || parent.deletedAt) return false;
  if (isManualClientReleaseActive(report) && (report.status === ReportStatus.APPROVED || report.status === ReportStatus.SIGNED)) return true;
  return parent.status === ReportStatus.SIGNED
    && previousRdosSignedForServiceReport(report, parent, allReportsById);
}

function releasedServiceReportPayload(report) {
  return {
    id: report.id,
    projectId: report.projectId,
    reportType: report.reportType,
    sequenceNumber: report.sequenceNumber ?? null,
    reportDate: report.reportDate,
    project: {
      id: report.project?.id || report.projectId,
      code: report.project?.code || '',
      name: report.project?.name || ''
    }
  };
}

export async function releasedServiceReportsForSignedRdo(rdo, client, {
  projectReportsForClientVisibility,
  compareProjectReportOrder,
  canClientSeeReport
}) {
  if (!rdo || rdo.reportType !== ReportType.RDO || rdo.status !== ReportStatus.SIGNED) return [];
  const projectReports = await projectReportsForClientVisibility(rdo.projectId, client);
  const byId = new Map(projectReports.map(item => [item.id, item]));
  return projectReports
    .filter(report => {
      if (report.reportType === ReportType.RDO) return false;
      const parentId = report.specialConditions?.parentRdoId;
      if (!parentId) return false;
      const parent = byId.get(parentId);
      const signedRdoReleasedThisReport = parentId === rdo.id || compareProjectReportOrder(rdo, parent || report) < 0;
      return signedRdoReleasedThisReport && canClientSeeReport(report, byId);
    })
    .map(releasedServiceReportPayload);
}
