// Política compartilhada pela tela e pela API. Não abre arquivos nem gera documentos.
export const isManualPdfReport = report => Boolean(report?.specialConditions?.__manualUpload?.uploadedAt);
const isManualUrl = value => String(value || '').replaceAll('\\', '/').includes('/uploads-manuais/');

export async function manualUploadedSourceVersion(report, client) {
  if (!isManualPdfReport(report)) return null;
  const included = Array.isArray(report.versions) && report.versions.find(version => version.sourcePdfUrl && version.sourceDocumentHash && isManualUrl(version.sourcePdfUrl));
  if (included) return included;
  if (!report?.id) return null;
  return client.reportVersion.findFirst({ where: { reportId: report.id,
    sourcePdfUrl: { contains: 'uploads-manuais/' }, sourceDocumentHash: { not: null } }, orderBy: { versionNumber: 'desc' } });
}

export function selectReportPdfSource(report, manualVersion = null, { skipFinal = false } = {}) {
  const versions = Array.isArray(report.versions) ? report.versions : [];
  const final = versions.find(version => version.finalPdfUrl);
  if (!skipFinal && report.status === 'SIGNED' && final) return { kind: 'FINAL_ASSINADO', version: final, url: final.finalPdfUrl, hash: final.finalDocumentHash };
  if (report.status === 'SIGNED' && report.reportType === 'RDO' && (report.zapsignDocToken || report.zapsignDocUrl)) return { kind: 'ZAPSIGN' };
  const manual = isManualPdfReport(report) && (manualVersion || versions.find(version => version.sourcePdfUrl && version.sourceDocumentHash && isManualUrl(version.sourcePdfUrl)));
  if (manual) return { kind: 'MANUAL', version: manual, url: manual.sourcePdfUrl, hash: manual.sourceDocumentHash };
  const active = versions.find(version => version.status === 'ACTIVE' && version.sourcePdfUrl && version.sourceDocumentHash);
  if (report.status === 'APPROVED' && active) return { kind: 'BASE_APROVADO', version: active, url: active.sourcePdfUrl, hash: active.sourceDocumentHash };
  return { kind: 'CACHE' };
}
