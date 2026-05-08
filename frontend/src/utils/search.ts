import type { Project, ReportSummary } from '../types/domain';

export function normalizeSearchValue(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function matchesSearch(parts: unknown[], query: string) {
  const term = normalizeSearchValue(query.trim());
  if (!term) return true;
  return normalizeSearchValue(parts.join(' ')).includes(term);
}

export function projectSearchParts(project: Project) {
  return [
    project.code,
    project.name,
    project.clientName,
    project.clientCnpj,
    project.clientEmailPrimary,
    ...(project.clientEmailCc || []),
    ...(project.clientSigners || []).flatMap(signer => [signer.name, signer.email]),
    project.contractCode,
    project.location,
    project.operator?.name,
    ...(project.reportSequences || []).flatMap(sequence => [sequence.reportType, sequence.nextNumber])
  ];
}

export function reportSearchParts(report: ReportSummary) {
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
