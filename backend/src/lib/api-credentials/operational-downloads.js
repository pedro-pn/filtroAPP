import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { IntegrationApiError } from '../../middleware/api-request-context.js';
import { OPERATIONAL_DOWNLOADS } from './extended-operational-resources.js';
import { operationalVisibilityWhere, prepareOperationalQuery } from './operational-service.js';

export const MAX_OPERATIONAL_FILE_BYTES = 50 * 1024 * 1024;
const missing = () => new IntegrationApiError(404, 'FILE_NOT_FOUND', 'Arquivo indisponível.');
const safePart = value => String(value ?? '').replace(/[<>:"/\\|?*\n\r]/g, '_').trim();
const projectSelect = { id: true, code: true, name: true };

export function validateOperationalDownload(operationId, params, query, context) {
  const definition = OPERATIONAL_DOWNLOADS.find(item => item.operationId === operationId);
  if (!definition) throw new IntegrationApiError(400, 'UNKNOWN_OPERATION', 'Operação indisponível.');
  if (definition.requiredScopes.some(scope => !context.scopes.has(scope))) throw new IntegrationApiError(403, 'INSUFFICIENT_SCOPE', 'A credencial não possui a permissão necessária.');
  const { id } = z.object({ id: z.string().trim().min(1).max(100) }).strict().parse(params);
  z.object({}).strict().parse(query);
  prepareOperationalQuery(definition.metadata.operationId, {}, context);
  return { definition, id };
}

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

export async function openOperationalDownload(client, operationId, params, query, context, roots) {
  const { definition, id } = validateOperationalDownload(operationId, params, query, context);
  const metadata = definition.metadata;
  const select = { id: true, fileName: true, mimeType: true, storagePath: true,
    ...(definition.storage === 'REPORT' ? { report: { select: { project: { select: projectSelect } } }, reportService: { select: { report: { select: { project: { select: projectSelect } } } } } } : {}),
    ...(definition.storage === 'STOCK' ? { publicToken: true } : {}) };
  const row = await client[metadata.delegate].findFirst({ where: { AND: [{ id }, operationalVisibilityWhere(metadata, {}, context)] }, select });
  if (!row) throw missing();
  let relative = row.storagePath;
  let prefix;
  const root = definition.storage === 'REPORT' ? roots.reportsDir : roots.uploadDir;
  if (definition.storage === 'REPORT') {
    const projects = [row.report?.project, row.reportService?.report?.project].filter(Boolean);
    if (!projects.length || projects.some(project => project.id !== projects[0].id)) throw missing();
    prefix = `${safePart(`Missão ${projects[0].code} - ${projects[0].name}`)}/`;
  } else if (definition.storage === 'MAINTENANCE') {
    prefix = 'Equipamentos/Manutenções/';
  } else {
    prefix = 'Estoque/Documentos/';
    if (!relative) {
      if (!/^[a-zA-Z0-9-]{1,100}$/.test(row.publicToken || '')) throw missing();
      prefix = 'Estoque/FISPQ/';
      const entries = await fs.readdir(path.join(root, prefix), { withFileTypes: true }).catch(() => []);
      const matches = entries.filter(entry => entry.isFile() && entry.name.endsWith(`-${row.publicToken}.pdf`));
      if (matches.length !== 1) throw missing();
      relative = `${prefix}${matches[0].name}`;
    } else if (relative.startsWith('Estoque/FISPQ/')) prefix = 'Estoque/FISPQ/';
  }
  const file = await openManagedFile(root, relative, prefix);
  // Nome e MIME não podem injetar headers nem revelar caminhos de armazenamento.
  const fileName = (path.posix.basename(String(row.fileName || 'arquivo').replaceAll('\\', '/')).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 180) || 'arquivo').toWellFormed();
  const encodedName = encodeURIComponent(fileName).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return { ...file, rows: 0, contentType: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(row.mimeType) ? row.mimeType : 'application/octet-stream',
    disposition: `attachment; filename="arquivo"; filename*=UTF-8''${encodedName}` };
}
