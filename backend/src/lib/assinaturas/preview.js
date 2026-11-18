import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

import env from '../../config/env.js';
import { safeDocumentPathPart } from '../documents/storage.js';
import { sourcePdfBuffer } from './document.js';
import { signatureOperationLog } from './observability.js';

function httpError(message, statusCode = 400) {
  const error = new Error(message);
  error.status = statusCode;
  error.statusCode = statusCode;
  return error;
}

function previewDirectory(documentId, rootDir = env.uploadDir) {
  const safeId = safeDocumentPathPart(documentId);
  if (!safeId || safeId !== String(documentId)) throw httpError('Documento inválido.', 404);
  return path.join(rootDir, 'Assinaturas', 'Previews', safeId);
}

export async function renderPage(document, pageNumber, { rootDir = env.uploadDir } = {}) {
  const startedAt = Date.now();
  const number = Number(pageNumber);
  if (!Number.isInteger(number) || number < 1 || number > Number(document?.pageCount || 0)) {
    throw httpError('Página não encontrada.', 404);
  }
  const directory = previewDirectory(document.id, rootDir);
  const targetPath = path.join(directory, `${number}.png`);
  try {
    const cached = await fs.readFile(targetPath);
    signatureOperationLog('preview.render', {
      documentId: document.id,
      pageNumber: number,
      cache: 'hit',
      sizeBytes: cached.length,
      outcome: 'completed'
    }, { startedAt });
    return cached;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const bytes = await sourcePdfBuffer(document, { rootDir });
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(bytes),
    disableWorker: true,
    useSystemFonts: true,
    isEvalSupported: false,
    verbosity: pdfjsLib.VerbosityLevel.ERRORS
  });
  const pdf = await loadingTask.promise;
  try {
    const page = await pdf.getPage(number);
    const initial = page.getViewport({ scale: env.assinaturasPreviewScale });
    const scale = initial.width > 1400
      ? env.assinaturasPreviewScale * (1400 / initial.width)
      : env.assinaturasPreviewScale;
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const png = canvas.toBuffer('image/png');
    await fs.mkdir(directory, { recursive: true });
    const temporaryPath = path.join(directory, `.${number}.${randomUUID()}.tmp`);
    await fs.writeFile(temporaryPath, png, { flag: 'wx' });
    await fs.rename(temporaryPath, targetPath).catch(async error => {
      await fs.unlink(temporaryPath).catch(() => {});
      if (error?.code !== 'EEXIST') throw error;
    });
    signatureOperationLog('preview.render', {
      documentId: document.id,
      pageNumber: number,
      cache: 'miss',
      sizeBytes: png.length,
      outcome: 'completed'
    }, { startedAt });
    return png;
  } finally {
    await pdf.cleanup?.();
    await loadingTask.destroy?.();
  }
}

export async function purgePreviews(documentId, { rootDir = env.uploadDir } = {}) {
  const directory = previewDirectory(documentId, rootDir);
  await fs.rm(directory, { recursive: true, force: true });
  return true;
}
