import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import env from '../../config/env.js';
import {
  publicPathForToken,
  publicUrlForPath,
  resolveManagedDocumentPath,
  safeDocumentPathPart,
  unlinkManagedDocumentFile,
  writeManagedDocumentFile
} from '../documents/storage.js';
import prisma from '../prisma.js';

const PUBLIC_PATH_PREFIX = '/api/estoque-anexos';
const STOCK_FOLDER = 'Estoque';
const DOCUMENTS_FOLDER = 'Documentos';
const LEGACY_FISPQ_FOLDER = 'FISPQ';
const MAX_PDF_BYTES = 20 * 1024 * 1024;

function legacyFispqDir(rootDir = env.uploadDir) {
  return path.join(rootDir, safeDocumentPathPart(STOCK_FOLDER), safeDocumentPathPart(LEGACY_FISPQ_FOLDER));
}

function parsePdfUpload(upload) {
  if (!upload) return null;
  const fileName = String(upload.fileName || upload.name || '').trim();
  const dataUrl = String(upload.dataUrl || '').trim();
  if (!fileName || !dataUrl) return null;
  if (!fileName.toLowerCase().endsWith('.pdf')) {
    const error = new Error('O documento deve ser enviado em PDF.');
    error.statusCode = 400;
    throw error;
  }
  const match = dataUrl.match(/^data:application\/pdf;base64,(.+)$/i);
  if (!match) {
    const error = new Error('O documento deve ser enviado em formato PDF.');
    error.statusCode = 400;
    throw error;
  }
  const bytes = Buffer.from(match[1], 'base64');
  if (!bytes.length || bytes.length > MAX_PDF_BYTES || bytes.subarray(0, 4).toString('utf8') !== '%PDF') {
    const error = new Error('Arquivo PDF inválido ou maior que 20 MB.');
    error.statusCode = 400;
    throw error;
  }
  return { fileName: path.basename(fileName), mimeType: 'application/pdf', bytes };
}

async function findLegacyStockAttachmentPath(token, rootDir = env.uploadDir) {
  const cleanToken = String(token || '').trim();
  if (!cleanToken) return null;
  const dir = legacyFispqDir(rootDir);
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const match = entries.find(entry => entry.isFile() && entry.name.endsWith(`-${cleanToken}.pdf`));
  return match ? path.join(dir, match.name) : null;
}

export function publicStockAttachmentUrl(token) {
  return publicUrlForPath(publicPathForToken(PUBLIC_PATH_PREFIX, token));
}

export function serializeStockItemDocument(document) {
  if (!document) return null;
  return {
    id: document.id,
    fileName: document.fileName,
    mimeType: document.mimeType,
    publicUrl: publicStockAttachmentUrl(document.publicToken),
    createdAt: document.createdAt
  };
}

export async function createStockItemDocument(client, { itemId, upload }, { rootDir = env.uploadDir } = {}) {
  const parsed = parsePdfUpload(upload);
  if (!parsed) return null;

  const publicToken = randomUUID();
  const storagePath = await writeManagedDocumentFile({
    rootDir,
    folderParts: [STOCK_FOLDER, DOCUMENTS_FOLDER],
    token: publicToken,
    fileName: parsed.fileName,
    bytes: parsed.bytes
  });

  try {
    return await client.stockItemDocument.create({
      data: {
        itemId,
        fileName: parsed.fileName,
        mimeType: parsed.mimeType,
        storagePath,
        publicToken
      }
    });
  } catch (error) {
    await unlinkManagedDocumentFile(storagePath, { rootDir, requiredPrefix: `${STOCK_FOLDER}/` });
    throw error;
  }
}

export async function removeStockItemDocument(client, { itemId, documentId }, { rootDir = env.uploadDir } = {}) {
  const document = await client.stockItemDocument.findFirst({
    where: { id: documentId, itemId }
  });
  if (!document) return null;

  await client.stockItemDocument.delete({ where: { id: document.id } });
  await removeStockItemDocumentFiles([document], { rootDir });
  return document;
}

export async function removeStockItemDocumentFiles(documents, { rootDir = env.uploadDir } = {}) {
  for (const document of documents || []) {
    if (document.storagePath) {
      // eslint-disable-next-line no-await-in-loop
      await unlinkManagedDocumentFile(document.storagePath, {
        rootDir,
        requiredPrefix: `${STOCK_FOLDER}/`
      });
    } else if (document.publicToken) {
      // FISPQs anteriores à migração não armazenavam o caminho relativo.
      // eslint-disable-next-line no-await-in-loop
      const targetPath = await findLegacyStockAttachmentPath(document.publicToken, rootDir);
      if (targetPath) {
        // eslint-disable-next-line no-await-in-loop
        await fs.unlink(targetPath).catch(() => {});
      }
    }
  }
}

export async function resolvePublicStockAttachment(token, client = prisma, { rootDir = env.uploadDir } = {}) {
  const publicToken = String(token || '').trim();
  if (!publicToken) return null;
  const document = await client.stockItemDocument.findUnique({
    where: { publicToken },
    include: { item: { select: { id: true, code: true, name: true } } }
  });
  if (!document) return null;

  const targetPath = document.storagePath
    ? resolveManagedDocumentPath(document.storagePath, {
        rootDir,
        requiredPrefix: `${STOCK_FOLDER}/`
      })
    : await findLegacyStockAttachmentPath(document.publicToken, rootDir);
  if (!targetPath) return null;
  return { document, item: document.item, targetPath };
}

export function stockAttachmentFileName(resolved) {
  const fileName = path.basename(String(resolved?.document?.fileName || '').trim());
  if (fileName) return fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName}.pdf`;
  const item = resolved?.item || {};
  const label = [item.code, item.name].filter(Boolean).join(' - ') || 'documento';
  return `${label}.pdf`;
}
