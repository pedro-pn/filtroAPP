import type { Project, ReportSummary } from '../types/domain';

export function normalizeSearchValue(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function compactSearchValue(value: string) {
  return value.replace(/[^\p{L}\p{N}]+/gu, '');
}

export function searchTokens(query: string) {
  return normalizeSearchValue(query)
    .trim()
    .split(/\s+/)
    .map(token => token.trim())
    .filter(Boolean);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function createSearchMatcher(query: string) {
  const tokens = searchTokens(query).map(value => ({ value, compact: compactSearchValue(value) }));
  return (parts: unknown[]) => {
    if (!tokens.length) return true;
    const fields = parts.map(normalizeSearchValue);
    const searchable = fields.join(' ');
    // Preserve field boundaries: report 58 + project 00 must never match 5800.
    const compactFields = fields.map(compactSearchValue);
    return tokens.every(token => searchable.includes(token.value)
      || (token.compact.length > 0 && compactFields.some(field => field.includes(token.compact))));
  };
}

export function matchesSearch(parts: unknown[], query: string) {
  return createSearchMatcher(query)(parts);
}

export function projectSearchParts(project: Project) {
  return [
    project.code,
    project.name,
    project.clientName,
    project.clientCnpj,
    project.clientEmailPrimary,
    project.clientSignerFirstName,
    project.clientSignerLastName,
    ...(project.clientEmailCc || []),
    ...(project.clientSigners || []).flatMap(signer => [signer.name, signer.firstName, signer.lastName, signer.email]),
    project.contractCode,
    project.location,
    project.operator?.name,
    project.managerOnly ? 'Somente gestor' : project.visibleToCollaborators ? 'Gestor coordenador colaboradores' : 'Gestor coordenador',
    ...(project.reportSequences || []).flatMap(sequence => [sequence.reportType, sequence.nextNumber])
  ];
}

export function reportSearchParts(report: ReportSummary) {
  const specialConditions = asRecord(report.specialConditions);
  const serviceData = asRecord(specialConditions.serviceData);
  const manualUpload = asRecord(specialConditions.__manualUpload);
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
