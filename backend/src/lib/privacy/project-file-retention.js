// LGPD — fotos e anexos dos RDOs (decisão de 2026-11-18): removidos 10 anos
// após o ENCERRAMENTO do projeto.
//
// Encerramento = projeto arquivado (isActive = false) e a data mais recente
// entre: finalização pelo módulo Relatórios (acompanhamentoReportArchivedAt),
// data de término (endDate) e a última data de RDO. Usar a mais recente evita
// apagar cedo quando um dos campos está desatualizado. Projeto arquivado sem
// nenhuma dessas datas não é tocado (só contado na simulação).
//
// Removido: fotos referenciadas no JSON dos RDOs (só arquivos de imagem dentro
// da pasta do próprio projeto, "Missão <código> - <nome>/") e os PDFs anexados
// ao RDO (ReportPdfAttachment). Mantido: o RDO em si, os PDFs emitidos/assinados
// (ReportVersion), as assinaturas e trilhas de auditoria, o Data Book e
// certificados de calibração (que ficam fora da pasta do projeto).
// Projeto com exceção (DataRetentionHold kind PROJECT) nunca é tocado.

import fs from 'node:fs/promises';
import path from 'node:path';

import { normalizeReportUploadReference, syncReportUploadAttachments } from '../report-upload-attachments.js';
import { reportPdfAttachmentPath } from '../reports/pdf-attachments.js';

export const PROJECT_FILE_RETENTION_YEARS = 10;
export const PROJECT_HOLD_KIND = 'PROJECT';
const IMAGE_EXTENSION = /\.(jpe?g|png|gif|webp|heic|heif|dng|bmp|tiff?)$/i;

export function projectFileRetentionCutoff(now = new Date(), years = PROJECT_FILE_RETENTION_YEARS) {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
  return cutoff;
}

export function projectClosedAt(project, latestReportDate = null) {
  const dates = [project?.acompanhamentoReportArchivedAt, project?.endDate, latestReportDate]
    .map(value => (value ? new Date(value) : null))
    .filter(value => value && !Number.isNaN(value.getTime()));
  if (!dates.length) return null;
  return new Date(Math.max(...dates.map(value => value.getTime())));
}

function safePathPart(value) {
  return String(value ?? '').replace(/[<>:"/\\|?*\n\r]/g, '_').trim();
}

// Mesmo critério de report-upload-attachments.js: a pasta do projeto começa com
// "Missão <código> - ".
export function isProjectImagePath(relativePath, projectCode) {
  const code = safePathPart(projectCode);
  if (!code || !relativePath || !IMAGE_EXTENSION.test(relativePath)) return false;
  const [firstFolder] = relativePath.split('/').filter(Boolean);
  return Boolean(firstFolder && firstFolder.startsWith(`Missão ${code} - `) && relativePath.includes('/'));
}

function referenceOf(item) {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    return item.url || item.storagePath || item.path || item.publicUrl || item.href || item.src || '';
  }
  return '';
}

function projectImageReference(item, projectCode) {
  const raw = referenceOf(item);
  if (!raw || typeof raw !== 'string' || raw.startsWith('data:')) return '';
  const normalized = normalizeReportUploadReference(raw);
  return isProjectImagePath(normalized, projectCode) ? normalized : '';
}

// Remove do JSON toda referência a foto do projeto: itens de lista (string ou
// objeto {url}) saem da lista; campos escalares viram null. Retorna os caminhos.
export function stripProjectImageReferences(value, projectCode, removed = new Set()) {
  if (Array.isArray(value)) {
    const kept = [];
    for (const item of value) {
      const reference = projectImageReference(item, projectCode);
      if (reference) {
        removed.add(reference);
        continue;
      }
      kept.push(stripProjectImageReferences(item, projectCode, removed).value);
    }
    return { value: kept, removed };
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).map(([key, item]) => {
      if (typeof item === 'string') {
        const reference = projectImageReference(item, projectCode);
        if (reference) {
          removed.add(reference);
          return [key, null];
        }
        return [key, item];
      }
      return [key, stripProjectImageReferences(item, projectCode, removed).value];
    });
    return { value: Object.fromEntries(entries), removed };
  }
  return { value, removed };
}

async function heldProjectIds(prismaClient) {
  const holds = await prismaClient.dataRetentionHold.findMany({ where: { kind: PROJECT_HOLD_KIND }, select: { targetId: true } });
  return holds.map(hold => hold.targetId);
}

async function closedProjectCandidates(prismaClient, { onlyIds = null } = {}) {
  const heldIds = await heldProjectIds(prismaClient);
  const projects = await prismaClient.project.findMany({
    where: {
      isActive: false,
      filesRetentionPurgedAt: null,
      ...(heldIds.length ? { NOT: { id: { in: heldIds } } } : {}),
      ...(onlyIds ? { id: { in: onlyIds } } : {})
    },
    select: { id: true, code: true, endDate: true, acompanhamentoReportArchivedAt: true }
  });
  if (!projects.length) return [];
  const latest = await prismaClient.report.groupBy({
    by: ['projectId'],
    where: { projectId: { in: projects.map(project => project.id) } },
    _max: { reportDate: true }
  });
  const latestByProject = new Map(latest.map(row => [row.projectId, row._max?.reportDate || null]));
  return projects.map(project => ({ ...project, closedAt: projectClosedAt(project, latestByProject.get(project.id)) }));
}

export async function previewProjectFileRetention({ prismaClient, now = new Date(), sampleLimit = 20 }) {
  const cutoff = projectFileRetentionCutoff(now);
  const candidates = await closedProjectCandidates(prismaClient);
  const eligible = candidates.filter(project => project.closedAt && project.closedAt < cutoff);
  const eligibleIds = eligible.map(project => project.id);
  const [reportAttachments, pdfAttachments, onHold] = await Promise.all([
    eligibleIds.length ? prismaClient.reportAttachment.count({ where: { OR: [
      { report: { projectId: { in: eligibleIds } } },
      { reportService: { report: { projectId: { in: eligibleIds } } } }
    ] } }) : 0,
    eligibleIds.length ? prismaClient.reportPdfAttachment.count({ where: { report: { projectId: { in: eligibleIds } } } }) : 0,
    prismaClient.dataRetentionHold.count({ where: { kind: PROJECT_HOLD_KIND } })
  ]);
  return {
    projectFilesRemoveBefore: cutoff.toISOString(),
    projectsToPurgeFiles: eligible.length,
    projectsToPurgeFilesSample: eligible.slice(0, sampleLimit).map(project => ({ id: project.id, code: project.code })),
    projectFileIndexRowsToRemove: reportAttachments,
    projectPdfAttachmentsToRemove: pdfAttachments,
    archivedProjectsWithoutClosureDate: candidates.filter(project => !project.closedAt).length,
    projectsOnRetentionHold: onHold
  };
}

function insideRoot(root, target) {
  const relative = path.relative(path.resolve(root), target);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

// Remove os arquivos depois do commit. Falha em um arquivo não desfaz o banco:
// o arquivo fica órfão e é contado em filesFailed (o caminho vai para o log).
async function removeFiles(files, { fsImpl = fs, logger = console } = {}) {
  const result = { filesDeleted: 0, filesMissing: 0, filesFailed: 0 };
  for (const target of files) {
    try {
      await fsImpl.rm(target, { force: false });
      result.filesDeleted += 1;
    } catch (error) {
      if (error?.code === 'ENOENT') {
        result.filesMissing += 1;
      } else {
        result.filesFailed += 1;
        logger.warn?.('[retenção LGPD] arquivo não removido; remover manualmente.', { file: target, code: error?.code });
      }
    }
  }
  return result;
}

// Remove fotos e anexos PDF de um projeto encerrado. Um RDO por transação; o
// projeto só recebe filesRetentionPurgedAt quando todos os RDOs foram tratados.
export async function purgeProjectFiles(prismaClient, project, {
  now = new Date(),
  reportsDir,
  lock = async () => {},
  fsImpl = fs,
  logger = console
}) {
  // Revalida: exceção marcada depois da seleção vence.
  const [stillEligible, hold] = await Promise.all([
    prismaClient.project.findFirst({
      where: { id: project.id, isActive: false, filesRetentionPurgedAt: null },
      select: { id: true }
    }),
    prismaClient.dataRetentionHold.findUnique({
      where: { kind_targetId: { kind: PROJECT_HOLD_KIND, targetId: project.id } }, select: { id: true }
    })
  ]);
  if (!stillEligible || hold) return { reportsUpdated: 0, imageReferencesRemoved: 0, pdfAttachmentsRemoved: 0,
    filesDeleted: 0, filesMissing: 0, filesFailed: 0, skipped: 1 };
  const reports = await prismaClient.report.findMany({ where: { projectId: project.id }, select: { id: true } });
  const files = [];
  const totals = { reportsUpdated: 0, imageReferencesRemoved: 0, pdfAttachmentsRemoved: 0 };

  for (const { id } of reports) {
    const changed = await prismaClient.$transaction(async tx => {
      await lock(tx);
      const report = await tx.report.findUnique({
        where: { id },
        select: {
          id: true,
          specialConditions: true,
          services: { select: { id: true, extraData: true } },
          pdfAttachments: { select: { id: true, storagePath: true } }
        }
      });
      if (!report) return null;
      const removed = new Set();
      const specialConditions = stripProjectImageReferences(report.specialConditions, project.code, removed).value;
      const reportChanged = removed.size > 0;
      const services = (report.services || []).map(service => {
        const before = removed.size;
        const extraData = stripProjectImageReferences(service.extraData, project.code, removed).value;
        return { ...service, extraData, changed: removed.size > before };
      });
      const pdfAttachments = report.pdfAttachments || [];
      if (!removed.size && !pdfAttachments.length) return null;

      // Só grava JSON que mudou (nunca grava null num campo JSON).
      if (reportChanged) await tx.report.update({ where: { id: report.id }, data: { specialConditions } });
      for (const service of services.filter(item => item.changed)) {
        await tx.reportService.update({ where: { id: service.id }, data: { extraData: service.extraData } });
      }
      if (pdfAttachments.length) {
        await tx.reportPdfAttachment.deleteMany({ where: { reportId: report.id } });
      }
      await syncReportUploadAttachments(tx, { id: report.id, specialConditions, services });
      return { removed: [...removed], pdfAttachments };
    });
    if (!changed) continue;
    totals.reportsUpdated += 1;
    totals.imageReferencesRemoved += changed.removed.length;
    totals.pdfAttachmentsRemoved += changed.pdfAttachments.length;
    for (const relativePath of changed.removed) {
      const target = path.resolve(reportsDir, ...relativePath.split('/'));
      if (insideRoot(reportsDir, target)) files.push(target);
    }
    for (const attachment of changed.pdfAttachments) {
      try {
        files.push(reportPdfAttachmentPath(reportsDir, attachment.storagePath));
      } catch {
        // Caminho fora da pasta de anexos: a linha saiu, o arquivo não é tocado.
      }
    }
  }

  await prismaClient.project.update({ where: { id: project.id }, data: { filesRetentionPurgedAt: now } });
  return { ...totals, ...(await removeFiles([...new Set(files)], { fsImpl, logger })) };
}

export async function runProjectFileRetention({
  prismaClient,
  now = new Date(),
  reportsDir,
  maxProjects = 20,
  lock = async () => {},
  fsImpl = fs,
  logger = console,
  onlyIds = null
}) {
  if (!reportsDir) throw new TypeError('A retenção de arquivos de projeto exige a pasta de relatórios.');
  const cutoff = projectFileRetentionCutoff(now);
  const eligible = (await closedProjectCandidates(prismaClient, { onlyIds }))
    .filter(project => project.closedAt && project.closedAt < cutoff)
    .slice(0, maxProjects);
  const totals = {
    projectsFilesPurged: 0,
    reportsUpdated: 0,
    imageReferencesRemoved: 0,
    pdfAttachmentsRemoved: 0,
    filesDeleted: 0,
    filesMissing: 0,
    filesFailed: 0
  };
  for (const project of eligible) {
    const { skipped, ...result } = await purgeProjectFiles(prismaClient, project, { now, reportsDir, lock, fsImpl, logger });
    if (!skipped) totals.projectsFilesPurged += 1;
    for (const key of Object.keys(result)) totals[key] += result[key];
  }
  return totals;
}
