export const MANUAL_SERVICE_EDIT_KEY = '__manualDerivedServiceReportEdit';
export const SERVICE_REPORT_TYPES = ['RTP', 'RLQ', 'RCPU', 'RLM', 'RLF', 'RLI'];

export function projectServiceReportCorrections(reports, serviceReports, {
  measurementKey, isServiceFinalized, isManualUploadedReport,
  replaceService = (source, corrected) => ({ ...source, finalized: true, extraData: corrected.extraData || {} })
}) {
  const parents = new Map(reports
    .filter(report => report.status === 'SIGNED' && !report.deletedAt && !isManualUploadedReport(report))
    .map(report => [report.id, report]));
  const corrections = new Map();
  const ordered = [...serviceReports].sort((a, b) =>
    String(a.specialConditions?.[MANUAL_SERVICE_EDIT_KEY]?.editedAt || '').localeCompare(
      String(b.specialConditions?.[MANUAL_SERVICE_EDIT_KEY]?.editedAt || '')
    ) || String(a.id).localeCompare(String(b.id)));

  for (const report of ordered) {
    const special = report.specialConditions || {};
    const edit = special[MANUAL_SERVICE_EDIT_KEY];
    const parent = parents.get(special.parentRdoId);
    if (!parent || parent.projectId !== report.projectId || report.deletedAt
      || !SERVICE_REPORT_TYPES.includes(report.reportType) || special.serviceOnly === true
      || !['APPROVED', 'SIGNED'].includes(report.status) || !edit?.editedAt) continue;

    const corrected = report.services?.[0];
    if (!corrected) continue;
    const candidates = (parent.services || []).filter(service =>
      isServiceFinalized(service) && service.serviceType === corrected.serviceType);
    let source = candidates.find(service => service.id === special.serviceId);
    if (!source) {
      const refs = new Set([special.serviceId, special.serviceLinkKey].filter(Boolean));
      const matches = candidates.filter(service => [service.id,
        service.extraData?.__ongoingKey, service.extraData?.__serviceLinkKey,
        service.extraData?.__sourceServiceId, service.extraData?.serviceId
      ].some(key => key && refs.has(key)));
      if (matches.length === 1) source = matches[0];
    }
    if (!source) continue;

    const replacement = replaceService(source, corrected);
    const key = `${parent.id}:${source.id}`;
    if (measurementKey(source) === measurementKey(replacement)) {
      corrections.delete(key);
      continue;
    }
    corrections.set(key, {
      ...replacement,
      correction: {
        reportId: report.id,
        reportType: report.reportType,
        sequenceNumber: report.sequenceNumber,
        editedAt: edit.editedAt,
        editedByUserId: edit.editedByUserId || null
      }
    });
  }

  return reports.map(report => ({
    ...report,
    services: (report.services || []).map(service => corrections.get(`${report.id}:${service.id}`) || service)
  }));
}
