import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import asyncHandler from '../../lib/async-handler.js';
import { requireAuth, requireModuleRole, RDO_ACCESS_ROLES } from '../../middleware/auth.js';
import { assertReviewerReachesReport, requireRdoReviewer } from '../../lib/reports/review-access.js';
import { createSignatureAuditLog, signatureEvidenceFromRequest } from '../../lib/internal-report-signatures.js';
import {
  MAX_REPORT_PDF_ATTACHMENTS, MAX_REPORT_PDF_ATTACHMENT_TOTAL_BYTES, pdfAttachmentError,
  reportPdfAttachmentOrder, reportPdfAttachmentOrderSchema, reportPdfAttachmentPath, reportPdfAttachmentSchema,
  reportPdfAttachmentSelect, validateReportPdfAttachment
} from '../../lib/reports/pdf-attachments.js';

export function registerReportPdfAttachmentRoutes(router, { database, uploadDir, isUnavailable, sendDownloadBuffer }) {
  const access = [requireAuth, requireModuleRole(...RDO_ACCESS_ROLES), requireRdoReviewer];

  async function accessibleReport(client, req, res) {
    const report = await client.report.findUnique({
      where: { id: req.params.id }, include: { project: true }
    });
    if (!report || isUnavailable(report)) {
      res.status(404).json({ error: 'Relatório não encontrado.' });
      return null;
    }
    return assertReviewerReachesReport(req, res, report) ? report : null;
  }

  function audit(client, req, action, fileName) {
    const labels = { PDF_ATTACHMENT_ADDED: 'Anexo PDF adicionado', PDF_ATTACHMENT_REMOVED: 'Anexo PDF excluído', PDF_ATTACHMENT_REORDERED: 'Anexos PDF reordenados' };
    return createSignatureAuditLog(client, {
      reportId: req.params.id, userId: req.auth.user.id, action,
      description: `${labels[action]}: ${fileName}`,
      evidence: signatureEvidenceFromRequest(req)
    });
  }

  router.get('/:id/pdf-attachments', ...access, asyncHandler(async (req, res) => {
    if (!await accessibleReport(database, req, res)) return;
    res.setHeader('Cache-Control', 'no-store');
    res.json(await database.reportPdfAttachment.findMany({
      where: { reportId: req.params.id }, orderBy: reportPdfAttachmentOrder, select: reportPdfAttachmentSelect
    }));
  }));

  router.post('/:id/pdf-attachments', ...access, asyncHandler(async (req, res) => {
    if (!await accessibleReport(database, req, res)) return;
    const data = reportPdfAttachmentSchema.parse(req.body);
    const { bytes, pageCount } = await validateReportPdfAttachment(data.pdfDataUrl);
    const id = randomUUID();
    const storagePath = path.posix.join('report-pdf-attachments', req.params.id, `${id}.pdf`);
    const target = reportPdfAttachmentPath(uploadDir(), storagePath);
    let committed = false;
    try {
      const attachment = await database.$transaction(async tx => {
        // Serializa inclusões/exclusões do mesmo relatório, inclusive os limites.
        await tx.$queryRaw`SELECT "id" FROM "Report" WHERE "id" = ${req.params.id} FOR UPDATE`;
        if (!await accessibleReport(tx, req, res)) return null;
        const totals = await tx.reportPdfAttachment.aggregate({
          where: { reportId: req.params.id }, _count: { _all: true }, _sum: { sizeBytes: true }, _max: { position: true }
        });
        if (totals._count._all >= MAX_REPORT_PDF_ATTACHMENTS) {
          throw pdfAttachmentError(`Cada relatório pode ter até ${MAX_REPORT_PDF_ATTACHMENTS} PDFs anexados.`);
        }
        if ((totals._sum.sizeBytes || 0) + bytes.length > MAX_REPORT_PDF_ATTACHMENT_TOTAL_BYTES) {
          throw pdfAttachmentError('Os anexos do relatório devem somar até 200 MB.');
        }
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, bytes, { flag: 'wx' });
        const created = await tx.reportPdfAttachment.create({
          data: { id, reportId: req.params.id, fileName: data.fileName, storagePath, sizeBytes: bytes.length, pageCount, position: (totals._max.position ?? -1) + 1 },
          select: reportPdfAttachmentSelect
        });
        await audit(tx, req, 'PDF_ATTACHMENT_ADDED', data.fileName);
        return created;
      }, { timeout: 15000 });
      if (!attachment) return;
      committed = true;
      res.status(201).json(attachment);
    } finally {
      if (!committed) await fs.rm(target, { force: true });
    }
  }));

  router.patch('/:id/pdf-attachments/order', ...access, asyncHandler(async (req, res) => {
    const data = reportPdfAttachmentOrderSchema.parse(req.body);
    const ordered = await database.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Report" WHERE "id" = ${req.params.id} FOR UPDATE`;
      if (!await accessibleReport(tx, req, res)) return null;
      const current = await tx.reportPdfAttachment.findMany({ where: { reportId: req.params.id }, select: { id: true, fileName: true } });
      const byId = new Map(current.map(item => [item.id, item]));
      if (current.length !== data.ids.length || data.ids.some(id => !byId.has(id))) {
        throw pdfAttachmentError('A lista de anexos foi alterada. Atualize a lista e tente reordenar novamente.', 409);
      }
      for (const [position, id] of data.ids.entries()) {
        await tx.reportPdfAttachment.updateMany({ where: { id, reportId: req.params.id }, data: { position } });
      }
      await audit(tx, req, 'PDF_ATTACHMENT_REORDERED', data.ids.map(id => byId.get(id).fileName).join(', '));
      return tx.reportPdfAttachment.findMany({ where: { reportId: req.params.id }, orderBy: reportPdfAttachmentOrder, select: reportPdfAttachmentSelect });
    });
    if (ordered) res.json(ordered);
  }));

  router.get('/:id/pdf-attachments/:attachmentId/pdf', ...access, asyncHandler(async (req, res) => {
    if (!await accessibleReport(database, req, res)) return;
    const attachment = await database.reportPdfAttachment.findFirst({
      where: { id: req.params.attachmentId, reportId: req.params.id }
    });
    if (!attachment) return res.status(404).json({ error: 'Anexo não encontrado.' });
    const buffer = await fs.readFile(reportPdfAttachmentPath(uploadDir(), attachment.storagePath)).catch(error => {
      if (error.code === 'ENOENT') throw pdfAttachmentError('Arquivo do anexo não encontrado.', 404);
      throw error;
    });
    sendDownloadBuffer(res, { contentType: 'application/pdf', fileName: attachment.fileName, buffer });
  }));

  router.delete('/:id/pdf-attachments/:attachmentId', ...access, asyncHandler(async (req, res) => {
    const removed = await database.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Report" WHERE "id" = ${req.params.id} FOR UPDATE`;
      if (!await accessibleReport(tx, req, res)) return null;
      const attachment = await tx.reportPdfAttachment.findFirst({
        where: { id: req.params.attachmentId, reportId: req.params.id }
      });
      if (!attachment) throw pdfAttachmentError('Anexo não encontrado.', 404);
      await tx.reportPdfAttachment.delete({ where: { id: attachment.id } });
      await audit(tx, req, 'PDF_ATTACHMENT_REMOVED', attachment.fileName);
      return attachment;
    });
    if (!removed) return;
    await fs.rm(reportPdfAttachmentPath(uploadDir(), removed.storagePath), { force: true }).catch(error => {
      console.error('Falha ao remover arquivo de anexo PDF já desvinculado.', { attachmentId: removed.id, message: error.message });
    });
    res.json({ ok: true });
  }));
}
