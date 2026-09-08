function cloneJson(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

export function stripInternalEditState(specialConditions) {
  if (!specialConditions || typeof specialConditions !== 'object' || Array.isArray(specialConditions)) {
    return specialConditions || {};
  }
  const cleaned = cloneJson(specialConditions) || {};
  delete cleaned.__editOriginalSnapshot;
  delete cleaned.__editMeta;
  return cleaned;
}

export function stripAuthoritativeExecutionContext(specialConditions) {
  const cleaned = cloneJson(
    specialConditions && typeof specialConditions === 'object' && !Array.isArray(specialConditions)
      ? specialConditions
      : {}
  ) || {};
  delete cleaned.workforceContext;
  delete cleaned.efetivoPlanningContext;
  return cleaned;
}

function reportSnapshotUploadAttachments(report) {
  const records = [];
  for (const attachment of report.attachments || []) {
    if (attachment?.storagePath) records.push({ storagePath: attachment.storagePath });
  }
  for (const service of report.services || []) {
    for (const attachment of service.attachments || []) {
      if (attachment?.storagePath) records.push({ storagePath: attachment.storagePath });
    }
  }
  return records;
}

export function buildReportSnapshot(report) {
  return {
    projectId: report.projectId,
    createdByUserId: report.createdByUserId || null,
    reportType: report.reportType,
    status: report.status,
    reportDate: report.reportDate ? new Date(report.reportDate).toISOString().slice(0, 10) : null,
    arrivalTime: report.arrivalTime,
    departureTime: report.departureTime,
    lunchBreak: report.lunchBreak,
    daytimeCount: report.daytimeCount,
    overtimeReason: report.overtimeReason || null,
    dailyDescription: report.dailyDescription || null,
    reviewNotes: report.reviewNotes || null,
    reviewedByUserId: report.reviewedByUserId || null,
    approvedAt: report.approvedAt ? new Date(report.approvedAt).toISOString() : null,
    returnedAt: report.returnedAt ? new Date(report.returnedAt).toISOString() : null,
    specialConditions: stripInternalEditState(report.specialConditions || {}),
    collaboratorIds: (report.collaborators || []).map(link => link.collaboratorId).filter(Boolean),
    collaborators: (report.collaborators || []).map(link => ({
      collaboratorId: link.collaboratorId,
      name: link.collaborator?.name || null,
      jobRoleId: link.jobRoleIdSnapshot || link.collaborator?.jobRole?.id || null,
      role: link.roleNameSnapshot || link.collaborator?.jobRole?.name || null
    })),
    uploadAttachments: reportSnapshotUploadAttachments(report),
    services: (report.services || []).map(service => ({
      serviceType: service.serviceType,
      equipmentId: service.equipmentId || null,
      system: service.system || null,
      material: service.material || null,
      startTime: service.startTime || null,
      endTime: service.endTime || null,
      finalized: typeof service.finalized === 'boolean' ? service.finalized : null,
      extraData: cloneJson(service.extraData || {})
    }))
  };
}
