import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import env from '../../config/env.js';
import { resolveManagedDocumentPath } from '../documents/storage.js';
import { databookDate, databookError, databookPermissions } from './policy.js';
import { loadDatabookSources, selectDatabookSources, sha256 } from './sources.js';

export async function authorizeDatabookProject(database, projectId, user, { generate = false } = {}) {
  const project = await database.project.findFirst({ where: { id: projectId, deletedAt: null } });
  if (!project) throw databookError('Projeto não encontrado.', 404);
  const permissions = databookPermissions(user, project);
  if (!permissions.canRead || (generate && !permissions.canGenerate)) throw databookError('Sem permissão para acessar ou emitir o databook deste projeto.', 403);
  return { project, permissions };
}

export function serializeDatabook(record) {
  const { id, projectId, familyId, revision, title, status, progress, attempts, error, createdByName, createdAt, completedAt, options, snapshot, pdfSha256, zipSha256 } = record;
  return { id, projectId, familyId, revision, title, status, progress, attempts, error, createdByName, createdAt, completedAt,
    startDate: databookDate(record.startDate), endDate: databookDate(record.endDate), options, warnings: snapshot?.warnings || [],
    pdfSha256: status === 'COMPLETED' ? pdfSha256 : null, zipSha256: status === 'COMPLETED' ? zipSha256 : null };
}

export async function createDatabook(database, projectId, input, user) {
  const { project } = await authorizeDatabookProject(database, projectId, user, { generate: true });
  const sources = await loadDatabookSources(database, project, input);
  const selection = selectDatabookSources(sources, input);
  return database.$transaction(async tx => {
    // Serialize revision allocation for this project; parameterized SQL, no ad-hoc data changes.
    await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`;
    const currentProject = await tx.project.findFirst({ where: { id: projectId, deletedAt: null } });
    if (!databookPermissions(user, currentProject).canGenerate) throw databookError('O projeto mudou. Atualize antes de emitir.', 409);
    let familyId = randomUUID();
    let revision = 1;
    if (input.previousId) {
      const previous = await tx.projectDatabook.findFirst({ where: { id: input.previousId, projectId } });
      if (!previous) throw databookError('Revisão anterior não encontrada neste projeto.', 404);
      familyId = previous.familyId;
      const latest = await tx.projectDatabook.findFirst({ where: { projectId, familyId }, orderBy: { revision: 'desc' } });
      revision = latest.revision + 1;
    }
    const { previousId, ...options } = input;
    return tx.projectDatabook.create({ data: { projectId, familyId, revision, title: input.title,
      startDate: new Date(`${input.startDate}T00:00:00.000Z`), endDate: new Date(`${input.endDate}T00:00:00.000Z`),
      options, snapshot: selection.snapshot, sourceFingerprint: selection.fingerprint,
      createdByUserId: user.id, createdByName: user.name || user.username || 'Responsável' } });
  });
}

export async function retryDatabook(database, projectId, id, user) {
  await authorizeDatabookProject(database, projectId, user, { generate: true });
  const result = await database.projectDatabook.updateMany({ where: { id, projectId, status: 'FAILED' },
    data: { status: 'PENDING', progress: 0, error: null, lockedAt: null, leaseToken: null } });
  if (!result.count) throw databookError('Só é possível repetir uma emissão que falhou.', 409);
  return database.projectDatabook.findFirst({ where: { id, projectId } });
}

export async function resolveDatabookDownload(database, projectId, id, kind, user, { rootDir = env.uploadDir } = {}) {
  const { project } = await authorizeDatabookProject(database, projectId, user);
  const record = await database.projectDatabook.findFirst({ where: { id, projectId } });
  if (!record) throw databookError('Databook não encontrado.', 404);
  if (record.status !== 'COMPLETED') throw databookError('A geração ainda não foi concluída.', 409);
  const storagePath = kind === 'pdf' ? record.pdfPath : record.zipPath;
  const expectedHash = kind === 'pdf' ? record.pdfSha256 : record.zipSha256;
  const target = resolveManagedDocumentPath(storagePath, { rootDir, requiredPrefix: `Databooks/${projectId}/` });
  if (!target) throw databookError('Arquivo do databook indisponível. Contate o responsável.', 404);
  const buffer = await fs.readFile(target);
  if (!expectedHash || sha256(buffer) !== expectedHash) throw databookError('O arquivo diverge do hash da emissão.', 409);
  return { buffer, fileName: `databook-${project.code}-${databookDate(record.startDate)}-${databookDate(record.endDate)}-${record.familyId.slice(0, 8)}-rev-${record.revision}.${kind}`, mimeType: kind === 'pdf' ? 'application/pdf' : 'application/zip' };
}
