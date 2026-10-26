import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { z } from 'zod';

import { decodeManualReportPdfDataUrl, MAX_MANUAL_REPORT_PDF_DATA_URL_LENGTH } from './manual-pdf-extraction.js';

export const MAX_REPORT_PDF_ATTACHMENTS = 20;
export const MAX_REPORT_PDF_ATTACHMENT_TOTAL_BYTES = 200 * 1024 * 1024;

// Leva somente o total junto da consulta do relatório, sem carregar os arquivos.
export function withReportPdfAttachmentCount(selection) {
  return { ...selection, _count: { select: { pdfAttachments: true } } };
}

export const reportPdfAttachmentSelect = {
  id: true, fileName: true, sizeBytes: true, pageCount: true, position: true, createdAt: true
};
export const reportPdfAttachmentOrder = [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }];
export const reportPdfAttachmentOrderSchema = z.object({
  ids: z.array(z.string().min(1).max(100)).min(1).max(MAX_REPORT_PDF_ATTACHMENTS)
    .refine(ids => new Set(ids).size === ids.length, 'A lista de anexos não pode conter arquivos repetidos.')
});
export const reportPdfAttachmentSchema = z.object({
  fileName: z.string().trim().min(1).max(255).regex(/\.pdf$/i, 'Envie um arquivo PDF.'),
  pdfDataUrl: z.string().max(MAX_MANUAL_REPORT_PDF_DATA_URL_LENGTH)
});

export function pdfAttachmentError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

export function reportPdfAttachmentPath(uploadDir, storagePath) {
  const root = path.resolve(uploadDir, 'report-pdf-attachments');
  const target = path.resolve(uploadDir, storagePath);
  if (!target.startsWith(`${root}${path.sep}`)) {
    throw pdfAttachmentError('Caminho do anexo PDF inválido.', 409);
  }
  return target;
}

export async function validateReportPdfAttachment(pdfDataUrl) {
  const bytes = decodeManualReportPdfDataUrl(pdfDataUrl);
  try {
    const source = await PDFDocument.load(bytes);
    const pageCount = source.getPageCount();
    if (!pageCount) throw new Error('empty');
    // Confirma também que as páginas podem ser copiadas para o relatório.
    const probe = await PDFDocument.create();
    source.getForm().flatten();
    for (const page of await probe.copyPages(source, source.getPageIndices())) probe.addPage(page);
    await probe.save();
    return { bytes, pageCount };
  } catch {
    throw pdfAttachmentError('O PDF está corrompido, protegido por senha ou não contém páginas válidas.');
  }
}

// A composição acontece apenas na entrega: caches, hashes e originais assinados
// continuam imutáveis. Consulta separada evita anexos duplicados ou listas antigas.
export function createReportPdfAttachmentAppender({ database, uploadDir }) {
  return async (report, file) => {
    const attachments = await database.reportPdfAttachment.findMany({
      where: { reportId: report.id }, orderBy: reportPdfAttachmentOrder
    });
    if (!attachments.length) return file;
    const document = await PDFDocument.load(file.buffer);
    for (const attachment of attachments) {
      try {
        const bytes = await fs.readFile(reportPdfAttachmentPath(uploadDir(), attachment.storagePath));
        const source = await PDFDocument.load(bytes);
        source.getForm().flatten();
        for (const page of await document.copyPages(source, source.getPageIndices())) document.addPage(page);
      } catch (error) {
        if (error.statusCode) throw error;
        throw pdfAttachmentError(`Não foi possível incluir o anexo "${attachment.fileName}". Verifique ou exclua o arquivo antes de baixar o relatório.`, 409);
      }
    }
    return { ...file, buffer: Buffer.from(await document.save()) };
  };
}
