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

const PUBLIC_PATH_PREFIX = '/api/qualidade-anexos';
const QUALITY_FOLDER = 'Qualidade';
const EVIDENCE_FOLDER = 'Evidencias';
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

const IMAGE_MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp'
};

const EVIDENCE_REQUIRED_PREFIX = `${safeDocumentPathPart(QUALITY_FOLDER)}/${safeDocumentPathPart(EVIDENCE_FOLDER)}/`;

export function publicQualityAttachmentUrl(token) {
  return publicUrlForPath(publicPathForToken(PUBLIC_PATH_PREFIX, token));
}

function error(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function parsePdfUpload(fileName, dataUrl) {
  const match = dataUrl.match(/^data:application\/pdf;base64,(.+)$/i);
  if (!match) throw error('A evidência em PDF deve ser enviada em formato PDF.');
  const bytes = Buffer.from(match[1], 'base64');
  if (!bytes.length || bytes.length > MAX_PDF_BYTES || bytes.subarray(0, 4).toString('utf8') !== '%PDF') {
    throw error('Arquivo PDF inválido ou muito grande (máx. 20 MB).');
  }
  return { fileName, mimeType: 'application/pdf', extension: 'pdf', bytes };
}

function parseImageUpload(fileName, dataUrl) {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z.+-]+);base64,(.+)$/);
  if (!match) throw error('A evidência deve ser uma imagem ou PDF.');
  const mimeType = match[1].toLowerCase();
  const extension = IMAGE_MIME_EXT[mimeType];
  if (!extension) throw error('Formato de imagem não suportado (use PNG, JPG ou WEBP).');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    throw error('Imagem inválida ou muito grande (máx. 15 MB).');
  }
  return { fileName, mimeType, extension, bytes };
}

export function parseQualityEvidenceUpload(upload) {
  if (!upload) return null;
  const fileName = String(upload.fileName || upload.name || '').trim();
  const dataUrl = String(upload.dataUrl || '').trim();
  if (!fileName || !dataUrl) return null;
  if (/^data:application\/pdf;base64,/i.test(dataUrl)) return parsePdfUpload(fileName, dataUrl);
  if (/^data:image\//i.test(dataUrl)) return parseImageUpload(fileName, dataUrl);
  throw error('A evidência deve ser uma imagem ou PDF.');
}

export async function createQualityEvidenceAttachment({ upload }) {
  const parsed = parseQualityEvidenceUpload(upload);
  if (!parsed) return null;
  const token = randomUUID();
  const storagePath = await writeManagedDocumentFile({
    rootDir: env.uploadDir,
    folderParts: [QUALITY_FOLDER, EVIDENCE_FOLDER],
    token,
    fileName: parsed.fileName,
    bytes: parsed.bytes,
    extension: parsed.extension
  });
  return {
    fileName: parsed.fileName,
    mimeType: parsed.mimeType,
    storagePath,
    publicToken: token
  };
}

export async function removeQualityEvidenceAttachment(evidence) {
  if (!evidence?.storagePath) return false;
  return unlinkManagedDocumentFile(evidence.storagePath, {
    rootDir: env.uploadDir,
    requiredPrefix: EVIDENCE_REQUIRED_PREFIX
  });
}

export async function resolvePublicQualityAttachment(token, client = prisma) {
  const evidence = await client.qualityEvidence.findFirst({
    where: {
      publicToken: String(token || '').trim(),
      kind: 'ATTACHMENT',
      record: { deletedAt: null }
    },
    select: {
      id: true,
      fileName: true,
      mimeType: true,
      storagePath: true,
      publicToken: true,
      record: { select: { number: true } }
    }
  });
  if (!evidence?.storagePath) return null;
  const targetPath = resolveManagedDocumentPath(evidence.storagePath, {
    rootDir: env.uploadDir,
    requiredPrefix: EVIDENCE_REQUIRED_PREFIX
  });
  if (!targetPath) return null;
  return { evidence, targetPath };
}

export function qualityAttachmentFileName(evidence) {
  return String(evidence?.fileName || evidence?.record?.number || 'evidencia').trim() || 'evidencia';
}
