import type { ReportSummary } from '../types/domain';

type ClientUser = {
  email?: string | null;
  username?: string | null;
  clientCnpj?: string | null;
};

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function cnpjDigits(value: unknown) {
  return String(value || '').replace(/\D/g, '');
}

function plainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function manualReportUploadMeta(report: ReportSummary | undefined) {
  return plainObject(plainObject(report?.specialConditions).__manualUpload);
}

function manualReportRequiresSignature(report: ReportSummary | undefined) {
  return manualReportUploadMeta(report).requiresSignature === true;
}

function manualReportAllowsOptionalSignature(report: ReportSummary | undefined) {
  return manualReportUploadMeta(report).allowsOptionalSignature === true;
}

function reportHasClientSignatureFlow(report: ReportSummary) {
  if (manualReportRequiresSignature(report) || manualReportAllowsOptionalSignature(report)) return true;
  if (report.reportType === 'RDO') return true;
  return report.project.requireServiceReportSignatures === true;
}

export function clientSignerEmailForReport(report: ReportSummary | undefined, user: ClientUser | null | undefined) {
  const username = normalizeEmail(user?.username);
  if (username.includes('@')) return username;

  const projectCnpj = cnpjDigits(report?.project.clientCnpj);
  const accountCnpjs = [user?.username, user?.clientCnpj]
    .map(cnpjDigits)
    .filter(value => value.length === 14);
  if (projectCnpj && accountCnpjs.includes(projectCnpj)) {
    return normalizeEmail(report?.project.clientEmailPrimary);
  }

  const email = normalizeEmail(user?.email);
  return email || '';
}

export function clientSignatureForReport(report: ReportSummary | undefined, user: ClientUser | null | undefined) {
  const email = clientSignerEmailForReport(report, user);
  if (!email) return null;
  return report?.reportSignatures?.find(signature => normalizeEmail(signature.signerEmail) === email) || null;
}

function signerFullName(signer: NonNullable<ReportSummary['project']['clientSigners']>[number]) {
  const fromParts = [signer.firstName, signer.lastName]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
  return fromParts || String(signer.name || '').trim();
}

export function clientSignerPrefillNameForReport(report: ReportSummary | undefined, user: ClientUser | null | undefined) {
  const email = clientSignerEmailForReport(report, user);
  if (!email) return '';
  const configuredSigner = report?.project.clientSigners?.find(signer => normalizeEmail(signer.email) === email);
  return configuredSigner ? signerFullName(configuredSigner) : '';
}

export function clientHasSignedReport(report: ReportSummary | undefined, user: ClientUser | null | undefined) {
  return clientSignatureForReport(report, user)?.status === 'SIGNED';
}

export function clientCanSignReport(report: ReportSummary, user: ClientUser | null | undefined, clientRejected = false) {
  if (report.status !== 'APPROVED' || clientRejected || !reportHasClientSignatureFlow(report)) return false;
  const signerEmail = clientSignerEmailForReport(report, user);
  if (!signerEmail) return false;

  const allowedSigners = new Set([
    normalizeEmail(report.project.clientEmailPrimary),
    ...(report.project.clientSigners || []).map(signer => normalizeEmail(signer.email))
  ].filter(Boolean));
  if (allowedSigners.size && !allowedSigners.has(signerEmail)) return false;

  return !clientHasSignedReport(report, user);
}
