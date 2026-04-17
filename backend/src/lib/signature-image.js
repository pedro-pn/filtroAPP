import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

import env from '../config/env.js';

function extToMime(ext) {
  const normalized = String(ext || '').toLowerCase();
  if (normalized === '.png') return 'image/png';
  if (normalized === '.jpg' || normalized === '.jpeg') return 'image/jpeg';
  if (normalized === '.gif') return 'image/gif';
  if (normalized === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

function resolveRelativeUploadPath(source) {
  if (!source || source.startsWith('data:')) return '';
  try {
    if (/^https?:\/\//i.test(source)) {
      const pathname = new URL(source).pathname;
      if (pathname.startsWith('/relatorios/')) return decodeURIComponent(pathname.slice('/relatorios/'.length));
      if (pathname.startsWith('/uploads/')) return decodeURIComponent(pathname.slice('/uploads/'.length));
      return '';
    }
    if (source.startsWith('/relatorios/')) return decodeURIComponent(source.slice('/relatorios/'.length));
    if (source.startsWith('/uploads/')) return decodeURIComponent(source.slice('/uploads/'.length));
  } catch {
    return '';
  }
  return '';
}

export function isSignatureDataUrl(value) {
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(String(value || ''));
}

export function parseSignatureDataUrl(value) {
  const match = String(value || '').match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!match) return null;
  const mimeType = match[1].toLowerCase();
  const bytes = Buffer.from(match[2], 'base64');
  return { mimeType, bytes };
}

export async function fileSignatureToDataUrl(source) {
  const relativePath = resolveRelativeUploadPath(source);
  if (!relativePath) return null;
  const filePath = path.join(env.reportsDir, relativePath);
  if (!fsSync.existsSync(filePath)) return null;
  const bytes = await fs.readFile(filePath);
  const mimeType = extToMime(path.extname(filePath));
  return `data:${mimeType};base64,${bytes.toString('base64')}`;
}

export async function normalizeSignatureValue(source) {
  if (!source) return null;
  if (isSignatureDataUrl(source)) return String(source);
  return fileSignatureToDataUrl(source);
}

export async function ensureCollaboratorSignatureDataUrl(prisma, collaborator) {
  if (!collaborator?.signatureImage) return collaborator;
  if (isSignatureDataUrl(collaborator.signatureImage)) return collaborator;
  const dataUrl = await fileSignatureToDataUrl(collaborator.signatureImage);
  if (!dataUrl) return collaborator;
  return prisma.collaborator.update({
    where: { id: collaborator.id },
    data: { signatureImage: dataUrl }
  });
}

