import path from 'node:path';
import { createHash } from 'node:crypto';
import { IntegrationApiError } from '../../middleware/api-request-context.js';
import { openManagedFile, readManagedBytes } from '../api-credentials/managed-files.js';
import { buildReportFileName, safePath } from '../report-filename.js';
import { selectReportPdfSource, manualUploadedSourceVersion, isManualPdfReport } from './pdf-download-source.js';
import { pdfCacheMetadataMatches, calibrationCertificateUrlsForReport } from './pdf-cache.js';
import { hasRdoProgressSourcesChanged } from './rdo-progress-cache.js';

const missing = () => new IntegrationApiError(404, 'FILE_NOT_FOUND', 'Arquivo indisponível.');
const notReady = () => new IntegrationApiError(409, 'PDF_NOT_READY', 'O PDF ainda não está pronto. Prepare o documento no FiltroAPP e tente novamente.', { retryAfterSeconds: 30 });
const complete = bytes => bytes.length >= 16 && bytes.subarray(0, 5).toString('latin1') === '%PDF-'
  && bytes.subarray(-2048).toString('latin1').includes('%%EOF');
export const reportPdfProjectPrefix = report => `${safePath(`Missão ${report.project.code} - ${report.project.name}`)}/`;

export function localReportPdfReference(url, prefix) {
  if (typeof url !== 'string') throw missing();
  let relative = url;
  if (relative.startsWith('/relatorios/')) {
    try { relative = decodeURIComponent(relative.slice('/relatorios/'.length)); } catch { throw missing(); }
  }
  if (!relative.startsWith(prefix) || relative.split('/').some(part => !part || part === '.' || part === '..')
    || /[\\\x00-\x1f]|%[0-9a-f]{2}/i.test(relative)) throw missing();
  return relative;
}

async function openSource(roots, url, prefix) {
  const relative = localReportPdfReference(url, prefix);
  // Somente referências locais gerenciadas. Nunca buscar uma URL da versão.
  for (const root of [...new Set([roots.uploadDir, roots.reportsDir].filter(Boolean))]) {
    try { return { ...await openManagedFile(root, relative, prefix), root, relative }; }
    catch (error) { if (error.code !== 'FILE_NOT_FOUND') throw error; }
  }
  throw missing();
}

export async function readIntegrationReportPdf(client, report, roots) {
  if (report.reportType === 'RDO_MAINTENANCE') throw missing();
  let source = selectReportPdfSource(report);
  if (!['FINAL_ASSINADO', 'ZAPSIGN'].includes(source.kind) && isManualPdfReport(report)) {
    source = selectReportPdfSource(report, await manualUploadedSourceVersion(report, client));
  }
  const prefix = reportPdfProjectPrefix(report);
  const fileName = buildReportFileName(report, 'pdf');
  let file;
  try {
    if (source.kind === 'ZAPSIGN') {
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(report.id)) throw missing();
      try { file = await openManagedFile(roots.reportsDir, `_zapsign-assinados/${report.id}.pdf`, '_zapsign-assinados/'); }
      catch (error) { if (error.code === 'FILE_NOT_FOUND') throw notReady(); throw error; }
    } else if (source.kind === 'CACHE') {
      const relative = `${prefix}${report.reportType}/${fileName}`;
      try { file = { ...await openManagedFile(roots.uploadDir, relative, prefix), root: roots.uploadDir, relative }; }
      catch (error) { if (error.code === 'FILE_NOT_FOUND') throw notReady(); throw error; }
      const stat = await file.handle.stat();
      const updated = new Date(report.updatedAt || report.createdAt).getTime();
      if (stat.size < 1024 || (updated && stat.mtimeMs < updated)) throw notReady();
      let metadataFile;
      let metadata;
      try {
        metadataFile = await openManagedFile(file.root, `${relative}.meta.json`, prefix);
        metadata = JSON.parse((await readManagedBytes(metadataFile, 64 * 1024)).toString('utf8'));
      } catch { throw notReady(); }
      finally { await metadataFile?.handle.close().catch(() => {}); }
      if (!pdfCacheMetadataMatches(report, metadata)) throw notReady();
      if (report.reportType === 'RDO' && report.projectId
        && await hasRdoProgressSourcesChanged(report, metadata, stat.mtimeMs, client)) throw notReady();
    } else {
      file = await openSource(roots, source.url, prefix);
    }
    const buffer = await readManagedBytes(file);
    if (!complete(buffer)) throw notReady();
    if (source.kind !== 'CACHE' && source.kind !== 'ZAPSIGN') {
      if (!source.hash || createHash('sha256').update(buffer).digest('hex') !== source.hash) throw notReady();
    }
    if (source.kind === 'CACHE') {
      const expectedLinks = calibrationCertificateUrlsForReport(report);
      if (expectedLinks.length) {
        const content = buffer.toString('latin1');
        if (!expectedLinks.every(url => content.includes(url))) throw notReady();
      }
    }
    return { kind: source.kind, buffer,
      fileName: ['CACHE', 'ZAPSIGN'].includes(source.kind) || isManualPdfReport(report) ? fileName : path.posix.basename(file.relative) };
  } finally { await file?.handle.close().catch(() => {}); }
}

// Inclui somente o necessário para seleção, nome e fingerprint, sem carregar usuários/assinaturas.
export const REPORT_PDF_SELECT = {
  id: true, projectId: true, reportType: true, status: true, sequenceNumber: true, reportDate: true,
  createdAt: true, updatedAt: true, specialConditions: true, daytimeOvertimeMinutes: true,
  nighttimeOvertimeMinutes: true, overtimeReason: true, zapsignDocToken: true, zapsignDocUrl: true,
  project: { select: { id: true, code: true, name: true } },
  versions: { where: { status: 'ACTIVE' }, orderBy: { versionNumber: 'desc' }, take: 1 },
  attachments: { select: { storagePath: true, fileName: true, mimeType: true } },
  services: { select: { equipmentId: true, system: true, extraData: true,
    attachments: { select: { storagePath: true, fileName: true, mimeType: true } } } }
};
