import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { IntegrationApiError } from '../../middleware/api-request-context.js';
import { OPERATIONAL_DOWNLOADS } from './extended-operational-resources.js';
import { operationalVisibilityWhere, prepareOperationalQuery } from './operational-service.js';

import { openManagedFile, createOperationalBufferDownload, operationalFileDisposition } from './managed-files.js';
export { openManagedFile, MAX_OPERATIONAL_FILE_BYTES } from './managed-files.js';
import { readIntegrationReportPdf, REPORT_PDF_SELECT } from '../reports/integration-pdf.js';
const missing = () => new IntegrationApiError(404, 'FILE_NOT_FOUND', 'Arquivo indisponível.');
const safePart = value => String(value ?? '').replace(/[<>:"/\\|?*\n\r]/g, '_').trim();
const projectSelect = { id: true, code: true, name: true };

export function validateOperationalDownload(operationId, params, query, context) {
  const definition = OPERATIONAL_DOWNLOADS.find(item => item.operationId === operationId);
  if (!definition) throw new IntegrationApiError(400, 'UNKNOWN_OPERATION', 'Operação indisponível.');
  if (definition.requiredScopes.some(scope => !context.scopes.has(scope))) throw new IntegrationApiError(403, 'INSUFFICIENT_SCOPE', 'A credencial não possui a permissão necessária.');
  const { id } = z.object({ id: z.string().trim().min(1).max(100) }).strict().parse(params);
  z.object({}).strict().parse(query);
  prepareOperationalQuery(definition.metadata.operationId, {}, context);
  return { definition, id };
}

export async function openOperationalDownload(client, operationId, params, query, context, roots) {
  const { definition, id } = validateOperationalDownload(operationId, params, query, context);
  if (definition.storage === 'REPORT_PDF') {
    const { resource } = prepareOperationalQuery('operational.Report.list', {}, context);
    const report = await client.report.findFirst({ where: { AND: [{ id },
      operationalVisibilityWhere(resource, {}, { ...context, projectAccessMode: 'ALL' })] }, select: REPORT_PDF_SELECT });
    if (!report) throw missing();
    if (context.projectAccessMode === 'SELECTED' && !context.projectIds.has(report.projectId)) {
      throw new IntegrationApiError(403, 'PROJECT_NOT_ALLOWED', 'O projeto solicitado não está autorizado.');
    }
    return createOperationalBufferDownload(await readIntegrationReportPdf(client, report, roots));
  }
  const metadata = definition.metadata;
  const select = { id: true, fileName: true, mimeType: true, storagePath: true,
    ...(definition.storage === 'REPORT' ? { report: { select: { project: { select: projectSelect } } }, reportService: { select: { report: { select: { project: { select: projectSelect } } } } } } : {}),
    ...(definition.storage === 'STOCK' ? { publicToken: true } : {}) };
  const row = await client[metadata.delegate].findFirst({ where: { AND: [{ id }, operationalVisibilityWhere(metadata, {}, context)] }, select });
  if (!row) throw missing();
  let relative = row.storagePath;
  let prefix;
  const root = definition.storage === 'REPORT' ? roots.reportsDir : roots.uploadDir;
  if (definition.storage === 'REPORT') {
    const projects = [row.report?.project, row.reportService?.report?.project].filter(Boolean);
    if (!projects.length || projects.some(project => project.id !== projects[0].id)) throw missing();
    prefix = `${safePart(`Missão ${projects[0].code} - ${projects[0].name}`)}/`;
  } else if (definition.storage === 'MAINTENANCE') {
    prefix = 'Equipamentos/Manutenções/';
  } else {
    prefix = 'Estoque/Documentos/';
    if (!relative) {
      if (!/^[a-zA-Z0-9-]{1,100}$/.test(row.publicToken || '')) throw missing();
      prefix = 'Estoque/FISPQ/';
      const entries = await fs.readdir(path.join(root, prefix), { withFileTypes: true }).catch(() => []);
      const matches = entries.filter(entry => entry.isFile() && entry.name.endsWith(`-${row.publicToken}.pdf`));
      if (matches.length !== 1) throw missing();
      relative = `${prefix}${matches[0].name}`;
    } else if (relative.startsWith('Estoque/FISPQ/')) prefix = 'Estoque/FISPQ/';
  }
  const file = await openManagedFile(root, relative, prefix);
  // Nome e MIME não podem injetar headers nem revelar caminhos de armazenamento.
  return { ...file, rows: 0, contentType: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(row.mimeType) ? row.mimeType : 'application/octet-stream',
    disposition: operationalFileDisposition(row.fileName) };
}
