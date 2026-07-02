import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

import env from '../../config/env.js';

export function safeDocumentPathPart(value) {
  return String(value ?? '').replace(/[<>:"/\\|?*\n\r]/g, '_').trim();
}

function posixPath(value) {
  return String(value || '').split(path.sep).join('/');
}

function isInside(root, targetPath) {
  const relative = path.relative(root, targetPath);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

export function publicPathForToken(prefix, token) {
  const cleanPrefix = `/${String(prefix || '').replace(/^\/+|\/+$/g, '')}`;
  return `${cleanPrefix}/${encodeURIComponent(String(token || ''))}`;
}

export function publicUrlForPath(pathValue, appUrl = env.appUrl) {
  const baseUrl = String(appUrl || '').replace(/\/+$/, '');
  return baseUrl ? `${baseUrl}${pathValue}` : pathValue;
}

export async function writeManagedDocumentFile({
  rootDir = env.uploadDir,
  folderParts = [],
  token,
  fileName,
  bytes,
  extension = 'pdf'
}) {
  if (!bytes?.length) throw new TypeError('Document bytes are required.');
  const dir = path.join(rootDir, ...folderParts.map(safeDocumentPathPart).filter(Boolean));
  await fs.mkdir(dir, { recursive: true });
  const baseName = safeDocumentPathPart(path.basename(fileName || 'anexo', path.extname(fileName || ''))) || 'anexo';
  const safeExtension = safeDocumentPathPart(extension || 'bin').replace(/^\.+/, '') || 'bin';
  const targetName = `${baseName}-${safeDocumentPathPart(token) || Date.now()}.${safeExtension}`;
  const targetPath = path.join(dir, targetName);
  await fs.writeFile(targetPath, bytes, { flag: 'wx' });
  return posixPath(path.relative(rootDir, targetPath));
}

export function resolveManagedDocumentPath(storagePath, {
  rootDir = env.uploadDir,
  requiredPrefix = ''
} = {}) {
  const rawPath = posixPath(storagePath);
  if (!rawPath || rawPath.startsWith('/') || rawPath.split('/').includes('..')) return null;
  const normalizedPath = rawPath.replace(/^\/+/, '');
  if (!normalizedPath) return null;
  if (requiredPrefix && !normalizedPath.startsWith(requiredPrefix)) return null;

  const root = path.resolve(rootDir);
  const targetPath = path.resolve(root, ...normalizedPath.split('/'));
  if (!isInside(root, targetPath)) return null;
  if (!fsSync.existsSync(targetPath) || !fsSync.statSync(targetPath).isFile()) return null;
  return targetPath;
}

export async function unlinkManagedDocumentFile(storagePath, {
  rootDir = env.uploadDir,
  requiredPrefix = ''
} = {}) {
  const targetPath = resolveManagedDocumentPath(storagePath, { rootDir, requiredPrefix });
  if (!targetPath) return false;
  await fs.unlink(targetPath).catch(() => {});
  return true;
}

export function inlineContentDisposition(fileName) {
  const ascii = String(fileName)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ._\-]/g, '_');
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
