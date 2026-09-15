import { MANUAL_REPORT_UPLOAD_KEY } from './manual-operational-data.js';

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeReportSearchValue(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function compactReportSearchValue(value) {
  return value.replace(/[^\p{L}\p{N}]+/gu, '');
}

function reportSearchTokens(term) {
  return normalizeReportSearchValue(term)
    .trim()
    .split(/\s+/)
    .map(token => token.trim())
    .filter(Boolean);
}

function reportSearchParts(report) {
  const serviceData = plainObject(report.specialConditions?.serviceData);
  const manualUpload = plainObject(report.specialConditions?.[MANUAL_REPORT_UPLOAD_KEY]);
  return [
    report.reportType,
    report.sequenceNumber,
    report.status,
    report.reportDate,
    report.project?.code,
    report.project?.name,
    report.project?.clientName,
    report.project?.clientCnpj,
    report.createdBy?.name,
    report.createdBy?.collaborator?.name,
    report.overtimeReason,
    report.dailyDescription,
    report.reviewNotes,
    ...Object.values(serviceData),
    manualUpload.originalFileName,
    ...(report.collaborators || []).map(item => item.collaborator?.name),
    ...(report.services || []).flatMap(service => [
      service.serviceType,
      service.equipment?.code,
      service.equipment?.name,
      service.system,
      service.material
    ])
  ];
}

export function createReportSearchMatcher(term) {
  const tokens = reportSearchTokens(term).map(value => ({ value, compact: compactReportSearchValue(value) }));
  return report => {
    if (!tokens.length) return true;
    const fields = reportSearchParts(report).map(normalizeReportSearchValue);
    const searchable = fields.join(' ');
    const compactFields = fields.map(compactReportSearchValue);
    return tokens.every(token => searchable.includes(token.value)
      || (token.compact.length > 0 && compactFields.some(field => field.includes(token.compact))));
  };
}

// Search only needs these fields. Hydrate cards after filtering and pagination,
// avoiding signatures, reviews and equipment details for every candidate.
export const reportSearchSelect = {
  id: true, projectId: true, reportType: true, sequenceNumber: true, status: true,
  reportDate: true, overtimeReason: true, dailyDescription: true, reviewNotes: true,
  specialConditions: true,
  project: { select: { code: true, name: true, clientName: true, clientCnpj: true } },
  createdBy: { select: { name: true, collaborator: { select: { name: true } } } },
  collaborators: { select: { collaborator: { select: { name: true } } } },
  services: { select: {
    serviceType: true, system: true, material: true,
    equipment: { select: { code: true, name: true } }
  } }
};
