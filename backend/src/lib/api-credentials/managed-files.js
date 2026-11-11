import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { IntegrationApiError } from '../../middleware/api-request-context.js';

export const MAX_OPERATIONAL_FILE_BYTES = 50 * 1024 * 1024;
const missing = () => new IntegrationApiError(404, 'FILE_NOT_FOUND', 'Arquivo indisponível.');

export async function openManagedFile(root, relativePath, requiredPrefix) {
  let handle;
  try {
    if (typeof root !== 'string' || !root || typeof relativePath !== 'string' || !relativePath
      || path.isAbsolute(relativePath) || /[\\\x00-\x1f]/.test(relativePath)
      || relativePath.split('/').some(part => !part || part === '.' || part === '..')
      || /%[0-9a-f]{2}/i.test(relativePath) || !relativePath.startsWith(requiredPrefix)) throw missing();
    const base = await fs.realpath(root);
    let target = base;
    for (const part of relativePath.split('/')) {
      target = path.join(target, part);
      if ((await fs.lstat(target)).isSymbolicLink()) throw missing();
    }
    const canonical = await fs.realpath(target);
    if (canonical !== path.join(base, relativePath)) throw missing();
    handle = await fs.open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile()) throw missing();
    if (stat.size > MAX_OPERATIONAL_FILE_BYTES) throw new IntegrationApiError(413, 'FILE_TOO_LARGE', 'Arquivo excede o limite de 50 MiB.');
    return { handle, bytes: stat.size };
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    if (error instanceof IntegrationApiError) throw error;
    throw missing();
  }
}

export function operationalFileDisposition(value) {
  const name = (path.posix.basename(String(value || 'arquivo').replaceAll('\\', '/'))
    .replace(/[\x00-\x1f\x7f]/g, '').slice(0, 180) || 'arquivo').toWellFormed();
  const encoded = encodeURIComponent(name).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="arquivo"; filename*=UTF-8''${encoded}`;
}

export function createOperationalBufferDownload({ buffer, fileName }) {
  if (!Buffer.isBuffer(buffer)) throw missing();
  if (buffer.length > MAX_OPERATIONAL_FILE_BYTES) throw new IntegrationApiError(413, 'FILE_TOO_LARGE', 'Arquivo excede o limite de 50 MiB.');
  return { buffer, bytes: buffer.length, rows: 0, contentType: 'application/pdf', disposition: operationalFileDisposition(fileName) };
}

// Limita a leitura mesmo se o arquivo crescer depois do stat.
export async function readManagedBytes(file, limit = MAX_OPERATIONAL_FILE_BYTES) {
  if (file.bytes > limit) throw new IntegrationApiError(413, 'FILE_TOO_LARGE', 'Arquivo excede o limite permitido.');
  const chunks = [];
  for await (const chunk of file.handle.createReadStream({ autoClose: false, start: 0, end: limit })) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);
  if (buffer.length > limit) throw new IntegrationApiError(413, 'FILE_TOO_LARGE', 'Arquivo excede o limite permitido.');
  return buffer;
}
