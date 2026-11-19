import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import env from '../../config/env.js';
import { multipartJsonWithFile } from '../http/multipart-form.js';
import { sha256Hex } from '../internal-report-signatures.js';
import { isLikelyCompletePdf } from '../report-pdf-from-docx.js';
import { safePath } from '../report-filename.js';
import { MAX_MANUAL_REPORT_PDF_BYTES, decodeManualReportPdfDataUrl, validateManualReportPdfBytes } from './manual-pdf-extraction.js';

// Upload manual de RDO em multipart (spec 042, D3): parte `pdf` com o arquivo e
// parte `payload` com os demais campos em JSON. O envio JSON antigo (PDF em
// base64 no campo pdfDataUrl) segue aceito só até o limite padrão de 1 MB.

// PDF de até 50 MB mais os campos em JSON.
export const manualPdfMultipart = multipartJsonWithFile({ maxBytes: MAX_MANUAL_REPORT_PDF_BYTES + 2 * 1024 * 1024 });

// PDF do pedido: parte `pdf` do multipart ou `pdfDataUrl` do JSON antigo.
export function manualReportPdfBytes(req, pdfDataUrl) {
  if (req.uploadedFile) return validateManualReportPdfBytes(req.uploadedFile.bytes);
  if (pdfDataUrl) return decodeManualReportPdfDataUrl(pdfDataUrl);
  return null;
}

export function hasManualReportPdf(req, pdfDataUrl) {
  return Boolean(req.uploadedFile || pdfDataUrl);
}

export function missingManualPdf(res) {
  return res.status(400).json({ error: 'Envie o PDF do relatório.', code: 'VALIDATION_ERROR' });
}

function reportDateKey(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function manualReportOriginalFileName(value) {
  const normalized = safePath(String(value || '').trim().replace(/\.pdf$/i, ''));
  return normalized || 'relatorio-antigo';
}

// Grava o PDF do upload manual na pasta do projeto (escrita atômica via .tmp).
export async function saveManualReportPdf({ project, reportType, sequenceNumber, reportDate, fileName, pdfBytes, folder = 'uploads-manuais' }) {
  const projectFolderName = safePath(`Missão ${project.code} - ${project.name}`) || safePath(project.id);
  const targetDir = path.join(env.uploadDir, projectFolderName, reportType, folder);
  const sequencePart = Number.isInteger(sequenceNumber) ? String(sequenceNumber).padStart(4, '0') : 'sem-numero';
  const dayPart = reportDateKey(reportDate) || new Date().toISOString().slice(0, 10);
  const baseName = manualReportOriginalFileName(fileName);
  const targetFileName = `${dayPart}-${sequencePart}-${Date.now()}-${randomUUID()}-${baseName}.pdf`;
  const targetPath = path.join(targetDir, targetFileName);
  const tempPath = `${targetPath}.tmp`;

  await fs.mkdir(targetDir, { recursive: true });
  try {
    await fs.writeFile(tempPath, pdfBytes);
    if (!(await isLikelyCompletePdf(tempPath))) {
      const error = new Error('PDF enviado está incompleto ou corrompido.');
      error.statusCode = 400;
      throw error;
    }
    await fs.rename(tempPath, targetPath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => undefined);
    throw error;
  }

  return {
    fileName: targetFileName,
    originalFileName: String(fileName || '').trim() || targetFileName,
    targetPath,
    publicUrl: path.relative(env.uploadDir, targetPath).split(path.sep).join('/'),
    sourceDocumentHash: sha256Hex(pdfBytes)
  };
}
