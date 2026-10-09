import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import env from '../../config/env.js';
import prisma from '../prisma.js';
import { resolveManagedDocumentPath, writeManagedDocumentFile, unlinkManagedDocumentFile } from '../documents/storage.js';
import { resolvePublicStockAttachment } from '../estoque/stock-attachments.js';
import { resolveStoredUploadPath } from '../stored-image.js';
import { databookError } from './policy.js';
import { loadDatabookSources, selectDatabookSources, sha256 } from './sources.js';
import { buildDatabookPackage } from './package.js';

const LEASE_MS = 5 * 60 * 1000;
let started = false;
let busy = false;
// Retry jobs saved by the previous version against the same complete source data.
const sourceFingerprintMatches = (selection, expected) => selection.fingerprint === expected || selection.legacyFingerprint === expected;

export async function claimDatabookJob(database, now = new Date()) {
  const runnable = { OR: [{ status: 'PENDING' }, { status: 'RUNNING', lockedAt: { lt: new Date(now.getTime() - LEASE_MS) } }] };
  const candidate = await database.projectDatabook.findFirst({ where: runnable, orderBy: { createdAt: 'asc' } });
  if (!candidate) return null;
  const leaseToken = randomUUID();
  const claimed = await database.projectDatabook.updateMany({ where: { id: candidate.id, ...runnable },
    data: { status: 'RUNNING', leaseToken, lockedAt: now, progress: 1, error: null, attempts: { increment: 1 } } });
  if (!claimed.count) return null;
  return database.projectDatabook.findFirst({ where: { id: candidate.id, leaseToken } });
}

export async function generateDatabookJob(database, job, dependencies = {}) {
  const rootDir = dependencies.rootDir || env.uploadDir;
  const leaseWhere = { id: job.id, status: 'RUNNING', leaseToken: job.leaseToken };
  const createdFiles = [];
  let leaseLost = false;
  const heartbeat = async progress => {
    const result = await database.projectDatabook.updateMany({ where: leaseWhere, data: {
      lockedAt: new Date(), ...(progress === undefined ? {} : { progress: Math.min(95, progress) }) } });
    if (!result.count) { leaseLost = true; throw databookError('A tarefa foi recuperada por outro processo.', 409); }
  };
  const timer = setInterval(() => heartbeat().catch(() => { leaseLost = true; }), 30000);
  timer.unref();
  try {
    const project = await database.project.findFirst({ where: { id: job.projectId, deletedAt: null } });
    if (!project) throw databookError('Projeto indisponível para emissão.', 409);
    const sources = await (dependencies.loadSources || loadDatabookSources)(database, project, job.options);
    const selection = selectDatabookSources(sources, job.options);
    if (!sourceFingerprintMatches(selection, job.sourceFingerprint)) throw databookError('As fontes mudaram após a preparação. Prepare uma nova revisão para conferir os dados.', 409);
    const missing = label => databookError(`Arquivo obrigatório indisponível: ${label}.`);
    const readReport = dependencies.readReport || (async summary => {
      const { reportDownloadInclude, getReportPdfDownload } = await import('../../routes/resources/reports.js');
      const report = await database.report.findFirst({ where: { id: summary.id, projectId: job.projectId, deletedAt: null }, include: reportDownloadInclude });
      if (!report || !['APPROVED', 'SIGNED'].includes(report.status)) throw missing(`${summary.reportType} ${summary.sequenceNumber}`);
      // Use the same verified version/signature downloader as the official PDF route.
      // Curating a databook does not synchronize or overwrite derived report content.
      return getReportPdfDownload(report);
    });
    const readPhoto = dependencies.readPhoto || (async summary => {
      const photo = selection.photos.find(item => item.key === summary.key);
      const target = photo && resolveStoredUploadPath(photo.storagePath);
      if (!target) throw missing(summary.fileName);
      return fs.readFile(target);
    });
    const readFds = dependencies.readFds || (async product => {
      const source = selection.products.find(item => item.id === product.id);
      const resolved = source && await resolvePublicStockAttachment(source.document.publicToken, database, { rootDir });
      if (!resolved || resolved.document.id !== product.document.id || resolved.document.itemId !== product.id) throw missing(product.document.fileName);
      return fs.readFile(resolved.targetPath);
    });
    const readDocument = dependencies.readDocument || (async summary => {
      const document = selection.documents.find(item => item.currentVersion.id === summary.versionId);
      const version = document?.currentVersion;
      const signed = version?.signatureDocument?.status === 'CONCLUIDO' && !version.signatureDocument.deletedAt;
      const storagePath = signed ? version.signatureDocument.finalStoragePath : version?.storagePath;
      const target = resolveManagedDocumentPath(storagePath, { rootDir, requiredPrefix: signed ? 'Assinaturas/' : 'Projetos/' });
      if (!target) throw missing(summary.title);
      const buffer = await fs.readFile(target);
      if (!signed && version.sha256 && sha256(buffer) !== version.sha256) throw databookError(`Documento diverge do hash registrado: ${summary.title}.`);
      return { buffer, fileName: version.originalFileName || 'documento.pdf', mimeType: signed ? 'application/pdf' : version.mimeType };
    });
    const result = await (dependencies.buildPackage || buildDatabookPackage)({ snapshot: job.snapshot, revision: job.revision,
      issuedAt: new Date(job.createdAt).toISOString(), author: job.createdByName, readReport, readPhoto, readFds, readDocument, onProgress: heartbeat });
    const refreshed = await (dependencies.loadSources || loadDatabookSources)(database, project, job.options);
    if (!sourceFingerprintMatches(selectDatabookSources(refreshed, job.options), job.sourceFingerprint)) throw databookError('As fontes mudaram durante a geração. Prepare uma nova revisão.', 409);
    if (leaseLost) throw databookError('A tarefa perdeu a reserva de processamento.', 409);
    await heartbeat(95);
    const writeFile = dependencies.writeFile || writeManagedDocumentFile;
    const common = { rootDir, folderParts: ['Databooks', job.projectId, job.familyId], token: `${job.id}-${job.leaseToken}` };
    const pdfPath = await writeFile({ ...common, fileName: `rev-${job.revision}`, bytes: result.pdf, extension: 'pdf' }); createdFiles.push(pdfPath);
    const zipPath = await writeFile({ ...common, fileName: `rev-${job.revision}`, bytes: result.zip, extension: 'zip' }); createdFiles.push(zipPath);
    const finalized = await database.projectDatabook.updateMany({ where: leaseWhere, data: { status: 'COMPLETED', progress: 100,
      pdfPath, zipPath, pdfSha256: sha256(result.pdf), zipSha256: sha256(result.zip), completedAt: new Date(), lockedAt: null, leaseToken: null, error: null } });
    if (!finalized.count) throw databookError('A tarefa foi recuperada por outro processo.', 409);
  } catch (error) {
    for (const file of createdFiles) await (dependencies.unlinkFile || unlinkManagedDocumentFile)(file, { rootDir, requiredPrefix: 'Databooks/' });
    const message = error.statusCode ? error.message : 'Não foi possível gerar o pacote. Verifique os arquivos das fontes e tente novamente.';
    await database.projectDatabook.updateMany({ where: leaseWhere, data: { status: 'FAILED', error: message.slice(0, 1000), lockedAt: null, leaseToken: null } });
    if (!dependencies.silent) console.error('[databook] Falha de geração', { id: job.id, message: error.message });
  } finally { clearInterval(timer); }
}

export function startDatabookJobs({ keepAlive = false } = {}) {
  if (started) return;
  started = true;
  const processQueue = async () => {
    if (busy) return;
    busy = true;
    try { const job = await claimDatabookJob(prisma); if (job) await generateDatabookJob(prisma, job); }
    catch (error) { console.error('[databook] Falha na fila', { message: error.message }); }
    finally { busy = false; }
  };
  const interval = setInterval(() => void processQueue(), 10000);
  if (!keepAlive) interval.unref();
  void processQueue();
}
