import path from 'node:path';
import { z } from 'zod';
import { buildReportFileName } from '../report-filename.js';
import { isManualPdfReport, selectReportPdfSource } from '../reports/pdf-download-source.js';
import { localReportPdfReference, reportPdfProjectPrefix } from '../reports/integration-pdf.js';
import { operationalVisibilityWhere, prepareOperationalQuery } from './operational-service.js';
import { CORPORATE_CONTACT_SCOPE, REPORT_PDF_SCOPE } from './omni-document-fields.js';

export function projectCorporateContact(row, context) {
  if (!context.scopes.has(CORPORATE_CONTACT_SCOPE)) return row;
  const email = typeof row.user?.email === 'string' ? row.user.email.trim().toLowerCase() : '';
  return { ...row, userId: row.user?.id || null,
    emailCorporativo: email.endsWith('@filtrovali.com.br') && z.email().safeParse(email).success ? email : null };
}

export async function enrichReportPdfMetadata(client, rows, context) {
  if (!context.scopes.has(REPORT_PDF_SCOPE)) return rows;
  const maintenanceIds = rows.filter(row => row.reportType === 'RDO_MAINTENANCE').map(row => row.id);
  const documents = new Map();
  if (maintenanceIds.length && ['manutencao.registros.read', 'manutencao.anexos.metadata.read'].every(scope => context.scopes.has(scope))) {
    const { resource } = prepareOperationalQuery('operational.MaintenanceAttachment.list', {}, context);
    const attachments = await client.maintenanceAttachment.findMany({
      where: { AND: [{ kind: 'DOCUMENT', maintenance: { reportId: { in: maintenanceIds } } }, operationalVisibilityWhere(resource, {}, context)] },
      select: { id: true, maintenance: { select: { reportId: true } } }, orderBy: { id: 'asc' }
    });
    for (const item of attachments) {
      const id = item.maintenance.reportId;
      if (!documents.has(id)) documents.set(id, []);
      documents.get(id).push(item.id);
    }
  }
  return rows.map(row => {
    if (row.reportType === 'RDO_MAINTENANCE') return { ...row, pdf: { disponivel: false, maintenanceAttachmentIds: documents.get(row.id) || [] } };
    const source = selectReportPdfSource(row);
    // Indicador barato: só versões persistidas; sem disco, hashes ou chamadas externas.
    if (['CACHE', 'ZAPSIGN'].includes(source.kind)) return { ...row, pdf: { disponivel: false } };
    let storedName;
    try { storedName = path.posix.basename(localReportPdfReference(source.url, reportPdfProjectPrefix(row))); }
    catch { return { ...row, pdf: { disponivel: false } }; }
    return { ...row, pdf: { disponivel: true, versao: source.kind,
      nomeArquivo: isManualPdfReport(row) ? buildReportFileName(row, 'pdf') : storedName,
      atualizadoEm: source.version.createdAt ? new Date(source.version.createdAt).toISOString() : null } };
  });
}
