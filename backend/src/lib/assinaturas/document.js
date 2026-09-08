import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';

import env from '../../config/env.js';
import {
  resolveManagedDocumentPath,
  unlinkManagedDocumentFile,
  writeManagedDocumentFile
} from '../documents/storage.js';
import { recordDocumentEvent } from './audit.js';
import { signatureOperationLog } from './observability.js';

const SIGNATURES_PREFIX = 'Assinaturas/';
const SOURCE_FOLDER = 'Documentos';

function httpError(message, statusCode = 400) {
  const error = new Error(message);
  error.status = statusCode;
  error.statusCode = statusCode;
  return error;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function normalizedText(value) {
  return String(value || '').trim();
}

export function parsePdfUpload(fileName, dataUrl) {
  const name = normalizedText(fileName);
  const match = normalizedText(dataUrl).match(/^data:application\/pdf;base64,([A-Za-z0-9+/]+={0,2})$/i);
  if (!name || !match || match[1].length % 4 !== 0) {
    throw httpError('Envie um arquivo PDF válido.');
  }
  const bytes = Buffer.from(match[1], 'base64');
  const maxBytes = env.assinaturasMaxPdfMb * 1024 * 1024;
  if (!bytes.length || bytes.length > maxBytes || bytes.subarray(0, 4).toString('utf8') !== '%PDF') {
    throw httpError(`Arquivo PDF inválido ou muito grande (máx. ${env.assinaturasMaxPdfMb} MB).`);
  }
  return { fileName: name, mimeType: 'application/pdf', extension: 'pdf', bytes };
}

export async function pdfMetadata(bytes) {
  let pdf;
  try {
    pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    throw httpError('PDF inválido, ilegível ou protegido por senha.');
  }
  const pages = pdf.getPages();
  if (!pages.length) throw httpError('O PDF precisa ter pelo menos uma página.');
  if (pages.length > env.assinaturasMaxPages) {
    throw httpError(`O PDF pode ter no máximo ${env.assinaturasMaxPages} páginas.`);
  }
  const pageDimensions = pages.map((page, index) => {
    const cropBox = page.getCropBox();
    const rotation = ((page.getRotation().angle % 360) + 360) % 360;
    if (![0, 90, 180, 270].includes(rotation)) {
      throw httpError(`A rotação da página ${index + 1} não é suportada.`);
    }
    return {
      page: index + 1,
      widthPt: cropBox.width,
      heightPt: cropBox.height,
      rotation
    };
  });
  return { pageCount: pages.length, pageDimensions };
}

export function storeSourcePdf({
  fileName,
  bytes,
  rootDir = env.uploadDir,
  token = randomUUID()
}) {
  return writeManagedDocumentFile({
    rootDir,
    folderParts: ['Assinaturas', SOURCE_FOLDER],
    token,
    fileName,
    bytes,
    extension: 'pdf'
  });
}

async function verifiedDocumentBuffer(storagePath, expectedHash, label, { rootDir = env.uploadDir } = {}) {
  const targetPath = resolveManagedDocumentPath(storagePath, {
    rootDir,
    requiredPrefix: SIGNATURES_PREFIX
  });
  if (!targetPath) throw httpError(`${label} não encontrado.`, 404);
  const bytes = await fs.readFile(targetPath);
  if (!expectedHash || sha256(bytes) !== expectedHash) {
    throw httpError(`A integridade do ${label.toLowerCase()} não pôde ser confirmada.`, 409);
  }
  return bytes;
}

export function sourcePdfBuffer(document, options) {
  return verifiedDocumentBuffer(document?.sourceStoragePath, document?.sourceDocumentHash, 'PDF original', options);
}

export function finalPdfBuffer(document, options) {
  if (document?.status !== 'CONCLUIDO') {
    throw httpError('O PDF assinado ainda não está disponível.', 409);
  }
  return verifiedDocumentBuffer(document?.finalStoragePath, document?.finalDocumentHash, 'PDF assinado', options);
}

export async function purgeDocumentFiles(document, { rootDir = env.uploadDir } = {}) {
  const paths = [document?.sourceStoragePath, document?.finalStoragePath].filter(Boolean);
  const removed = [];
  for (const storagePath of paths) {
    const didRemove = await unlinkManagedDocumentFile(storagePath, {
      rootDir,
      requiredPrefix: SIGNATURES_PREFIX
    });
    if (didRemove) removed.push(storagePath);
  }
  return removed;
}

export async function createDocument(client, input, dependencies = {}) {
  const startedAt = Date.now();
  const ownerUserId = normalizedText(input?.ownerUserId);
  const requesterNameSnapshot = normalizedText(input?.requesterNameSnapshot);
  if (!ownerUserId) throw new TypeError('ownerUserId is required to create a signature document.');
  if (!requesterNameSnapshot) throw httpError('O nome do solicitante é obrigatório.');

  const parsed = parsePdfUpload(input?.fileName, input?.pdfDataUrl);
  const metadata = await pdfMetadata(parsed.bytes);
  const title = normalizedText(input?.title)
    || path.basename(parsed.fileName, path.extname(parsed.fileName));
  if (!title || title.length > 180) throw httpError('O título deve ter entre 1 e 180 caracteres.');

  const store = dependencies.storeSourcePdf || storeSourcePdf;
  const remove = dependencies.removeStoredPdf || (storagePath => unlinkManagedDocumentFile(storagePath, {
    rootDir: env.uploadDir,
    requiredPrefix: SIGNATURES_PREFIX
  }));
  const storagePath = await store({
    fileName: parsed.fileName,
    bytes: parsed.bytes,
    token: randomUUID()
  });

  try {
    const operation = async tx => {
      const document = await tx.signatureDocument.create({
        data: {
          ownerUserId,
          requesterNameSnapshot,
          title,
          originalFileName: parsed.fileName,
          mimeType: parsed.mimeType,
          fileSizeBytes: parsed.bytes.length,
          pageCount: metadata.pageCount,
          pageDimensions: metadata.pageDimensions,
          sourceStoragePath: storagePath,
          sourceDocumentHash: sha256(parsed.bytes)
        }
      });
      await recordDocumentEvent(tx, {
        document,
        actorUserId: ownerUserId,
        action: 'DOCUMENTO_CRIADO',
        description: 'Documento de assinatura criado.'
      });
      return document;
    };
    const document = await (client.$transaction ? client.$transaction(operation) : operation(client));
    signatureOperationLog('document.upload', {
      documentId: document.id,
      sizeBytes: parsed.bytes.length,
      pageCount: metadata.pageCount,
      outcome: 'completed'
    }, { startedAt });
    return document;
  } catch (error) {
    await remove(storagePath);
    signatureOperationLog('document.upload', { outcome: 'failed' }, { level: 'warn', startedAt });
    throw error;
  }
}
