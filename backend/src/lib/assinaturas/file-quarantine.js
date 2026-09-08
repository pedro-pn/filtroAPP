import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import env from '../../config/env.js';
import { safeDocumentPathPart } from '../documents/storage.js';
import {
  assertUserDeletionImpactReady,
  userDeletionImpact
} from './service.js';
import { signatureOperationLog } from './observability.js';

const QUARANTINE_PREFIX = 'Assinaturas/Quarentena/';
const MOVABLE_PREFIXES = [
  'Assinaturas/Documentos/',
  'Assinaturas/Assinados/',
  'Assinaturas/Previews/'
];
const PREPARING_TTL_MS = 15 * 60_000;
const PROCESSING_TTL_MS = 15 * 60_000;

function conflict(message, extra = {}) {
  const error = new Error(message);
  error.status = 409;
  error.statusCode = 409;
  Object.assign(error, extra);
  return error;
}

function portableRelativePath(value, allowedPrefixes) {
  const candidate = String(value || '');
  if (!candidate || candidate.includes('\\') || candidate.startsWith('/') || candidate.includes('\0')) return null;
  const parts = candidate.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) return null;
  if (!allowedPrefixes.some(prefix => candidate.startsWith(prefix))) return null;
  return candidate;
}

function absoluteManagedPath(rootDir, relativePath, allowedPrefixes) {
  const validated = portableRelativePath(relativePath, allowedPrefixes);
  if (!validated) throw conflict('O manifesto de arquivos da conta contém um caminho inválido.');
  const root = path.resolve(rootDir);
  const target = path.resolve(root, ...validated.split('/'));
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw conflict('O manifesto de arquivos da conta aponta para fora do armazenamento gerenciado.');
  }
  return target;
}

function documentManifestEntries(documents, quarantineRoot) {
  const sourcePaths = [];
  for (const document of documents) {
    for (const relativePath of [document.sourceStoragePath, document.finalStoragePath]) {
      if (relativePath) sourcePaths.push({ relativePath, kind: 'file', documentId: document.id });
    }
    const safeId = safeDocumentPathPart(document.id);
    if (!safeId || safeId !== String(document.id)) throw conflict('Documento de assinatura inválido.');
    sourcePaths.push({
      relativePath: `Assinaturas/Previews/${safeId}`,
      kind: 'directory',
      documentId: document.id
    });
  }
  const unique = Array.from(new Map(sourcePaths.map(item => [item.relativePath, item])).values());
  return unique.map((item, index) => {
    const sourceRelativePath = portableRelativePath(item.relativePath, MOVABLE_PREFIXES);
    if (!sourceRelativePath) throw conflict('Documento com caminho de armazenamento inválido.');
    return {
      ...item,
      sourceRelativePath,
      quarantineRelativePath: `${quarantineRoot}/${String(index + 1).padStart(4, '0')}-${path.posix.basename(sourceRelativePath)}`,
      moved: false,
      missing: false
    };
  });
}

async function pathExists(fileSystem, target) {
  try {
    await fileSystem.lstat(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function persistManifest(client, operationKey, manifest) {
  await client.signatureDocumentFilePurge.update({
    where: { operationKey },
    data: { manifest }
  });
}

async function moveEntry(entry, { rootDir, fileSystem }) {
  const source = absoluteManagedPath(rootDir, entry.sourceRelativePath, MOVABLE_PREFIXES);
  const target = absoluteManagedPath(rootDir, entry.quarantineRelativePath, [QUARANTINE_PREFIX]);
  const [sourceExists, targetExists] = await Promise.all([
    pathExists(fileSystem, source),
    pathExists(fileSystem, target)
  ]);
  if (targetExists && !sourceExists) return { ...entry, moved: true, missing: false };
  if (targetExists && sourceExists) throw conflict('O destino de quarentena já existe.');
  if (!sourceExists) return { ...entry, moved: false, missing: true };
  await fileSystem.mkdir(path.dirname(target), { recursive: true });
  await fileSystem.rename(source, target);
  return { ...entry, moved: true, missing: false };
}

async function restoreEntries(entries, { rootDir, fileSystem }) {
  const restored = [...entries];
  for (let index = restored.length - 1; index >= 0; index -= 1) {
    const entry = restored[index];
    if (!entry.moved) continue;
    const source = absoluteManagedPath(rootDir, entry.sourceRelativePath, MOVABLE_PREFIXES);
    const target = absoluteManagedPath(rootDir, entry.quarantineRelativePath, [QUARANTINE_PREFIX]);
    const [sourceExists, targetExists] = await Promise.all([
      pathExists(fileSystem, source),
      pathExists(fileSystem, target)
    ]);
    if (sourceExists && targetExists) throw conflict('Não foi possível restaurar a quarentena sem sobrescrever um arquivo.');
    if (targetExists) {
      await fileSystem.mkdir(path.dirname(source), { recursive: true });
      await fileSystem.rename(target, source);
    }
    restored[index] = { ...entry, moved: false };
  }
  return restored;
}

export async function stageUserSignatureFiles(client, userId, documents, {
  rootDir = env.uploadDir,
  fileSystem = fs,
  operationKey = randomUUID()
} = {}) {
  const startedAt = Date.now();
  if (!documents.length) return null;
  const safeOperationKey = safeDocumentPathPart(operationKey);
  if (!safeOperationKey || safeOperationKey !== String(operationKey)) throw conflict('Operação de quarentena inválida.');
  const quarantineRoot = `${QUARANTINE_PREFIX}${safeOperationKey}`;
  let manifest = documentManifestEntries(documents, quarantineRoot);
  const operation = await client.signatureDocumentFilePurge.create({
    data: {
      operationKey: safeOperationKey,
      targetUserId: userId,
      quarantineRoot,
      manifest,
      status: 'PREPARANDO'
    }
  });
  try {
    for (let index = 0; index < manifest.length; index += 1) {
      manifest[index] = await moveEntry(manifest[index], { rootDir, fileSystem });
      await persistManifest(client, safeOperationKey, manifest);
    }
    signatureOperationLog('quarantine.stage', {
      operationKey: safeOperationKey,
      found: manifest.length,
      completed: manifest.filter(entry => entry.moved).length,
      outcome: 'completed'
    }, { startedAt });
    return { ...operation, manifest, quarantineRoot, operationKey: safeOperationKey };
  } catch (error) {
    try {
      manifest = await restoreEntries(manifest, { rootDir, fileSystem });
      await client.signatureDocumentFilePurge.update({
        where: { operationKey: safeOperationKey },
        data: { manifest, status: 'CANCELADO', lastError: 'Staging de arquivos revertido.' }
      });
    } catch {
      // O manifesto PREPARANDO permanece recuperável pelo reconciliador.
    }
    signatureOperationLog('quarantine.stage', {
      operationKey: safeOperationKey,
      outcome: 'rolled-back'
    }, { level: 'warn', startedAt });
    throw error;
  }
}

export async function rollbackUserSignatureFiles(client, operation, {
  rootDir = env.uploadDir,
  fileSystem = fs
} = {}) {
  if (!operation) return null;
  const current = await client.signatureDocumentFilePurge.findUnique({
    where: { operationKey: operation.operationKey }
  }) || operation;
  const manifest = await restoreEntries(Array.isArray(current.manifest) ? current.manifest : [], { rootDir, fileSystem });
  return client.signatureDocumentFilePurge.update({
    where: { operationKey: operation.operationKey },
    data: {
      manifest,
      status: 'CANCELADO',
      claimedAt: null,
      nextAttemptAt: null,
      lastError: 'Exclusão da conta revertida antes do commit.'
    }
  });
}

export async function promoteUserSignatureFilePurge(client, operationKey) {
  if (!operationKey) return null;
  return client.signatureDocumentFilePurge.update({
    where: { operationKey },
    data: { status: 'PENDENTE', claimedAt: null, nextAttemptAt: null, lastError: null }
  });
}

function retryAt(attempts, now) {
  return new Date(now.getTime() + (Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60_000));
}

export async function purgeUserSignatureFileOperation(client, operationKey, {
  now = new Date(),
  rootDir = env.uploadDir,
  fileSystem = fs
} = {}) {
  const startedAt = Date.now();
  const claim = await client.signatureDocumentFilePurge.updateMany({
    where: {
      operationKey,
      status: { in: ['PENDENTE', 'FALHOU'] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }]
    },
    data: {
      status: 'EM_PROCESSAMENTO',
      attempts: { increment: 1 },
      claimedAt: now,
      nextAttemptAt: null,
      lastError: null
    }
  });
  if (claim.count !== 1) {
    return client.signatureDocumentFilePurge.findUnique({ where: { operationKey } });
  }
  const operation = await client.signatureDocumentFilePurge.findUnique({ where: { operationKey } });
  try {
    const quarantine = absoluteManagedPath(rootDir, operation.quarantineRoot, [QUARANTINE_PREFIX]);
    await fileSystem.rm(quarantine, { recursive: true, force: true });
    const completed = await client.signatureDocumentFilePurge.update({
      where: { operationKey },
      data: {
        status: 'CONCLUIDO',
        completedAt: now,
        claimedAt: null,
        nextAttemptAt: null,
        lastError: null
      }
    });
    signatureOperationLog('quarantine.purge', {
      operationKey,
      attempts: operation.attempts,
      outcome: 'completed'
    }, { startedAt });
    return completed;
  } catch (error) {
    await client.signatureDocumentFilePurge.update({
      where: { operationKey },
      data: {
        status: 'FALHOU',
        claimedAt: null,
        nextAttemptAt: retryAt(operation.attempts || 1, now),
        lastError: 'Falha ao remover a quarentena de arquivos.'
      }
    });
    signatureOperationLog('quarantine.purge', {
      operationKey,
      attempts: operation.attempts,
      outcome: 'retry'
    }, { level: 'warn', startedAt });
    throw error;
  }
}

export async function reconcileSignatureFilePurges(client, {
  now = new Date(),
  rootDir = env.uploadDir,
  fileSystem = fs
} = {}) {
  const preparingCutoff = new Date(now.getTime() - PREPARING_TTL_MS);
  const abandoned = await client.signatureDocumentFilePurge.findMany({
    where: { status: 'PREPARANDO', createdAt: { lte: preparingCutoff } },
    orderBy: { createdAt: 'asc' },
    take: 25
  });
  let restored = 0;
  for (const operation of abandoned) {
    await rollbackUserSignatureFiles(client, operation, { rootDir, fileSystem });
    restored += 1;
  }
  const processingCutoff = new Date(now.getTime() - PROCESSING_TTL_MS);
  const stale = await client.signatureDocumentFilePurge.updateMany({
    where: { status: 'EM_PROCESSAMENTO', claimedAt: { lte: processingCutoff } },
    data: {
      status: 'FALHOU',
      claimedAt: null,
      nextAttemptAt: now,
      lastError: 'Claim de purga expirado; operação reagendada.'
    }
  });
  return { restored, staleClaims: stale.count };
}

export async function processSignatureFilePurges(client, {
  now = new Date(),
  rootDir = env.uploadDir,
  fileSystem = fs,
  limit = 25
} = {}) {
  const reconciliation = await reconcileSignatureFilePurges(client, { now, rootDir, fileSystem });
  const operations = await client.signatureDocumentFilePurge.findMany({
    where: {
      status: { in: ['PENDENTE', 'FALHOU'] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }]
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { operationKey: true }
  });
  let purged = 0;
  for (const operation of operations) {
    const result = await purgeUserSignatureFileOperation(client, operation.operationKey, {
      now,
      rootDir,
      fileSystem
    }).catch(() => null);
    if (result?.status === 'CONCLUIDO') purged += 1;
  }
  return { ...reconciliation, found: operations.length, purged };
}

async function acquireUserDeletionLock(client, userId) {
  if (typeof client.$queryRawUnsafe !== 'function') return;
  await client.$queryRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtext($1))::text AS lock_result',
    `assinaturas:delete-user:${userId}`
  );
}

export async function deleteUserWithSignatureDocuments(client, userId, {
  actorUserId = null,
  now = new Date(),
  rootDir = env.uploadDir,
  fileSystem = fs,
  purgeAfterCommit = purgeUserSignatureFileOperation
} = {}) {
  const initialImpact = assertUserDeletionImpactReady(await userDeletionImpact(client, userId));
  if (initialImpact.toDelete === 0 && initialImpact.toPreserve === 0) {
    await client.user.delete({ where: { id: userId } });
    return { assinaturas: initialImpact, purgeOperationKey: null };
  }
  const documents = await client.signatureDocument.findMany({
    where: {
      ownerUserId: userId,
      status: { in: ['RASCUNHO', 'AGUARDANDO_ASSINATURAS', 'CANCELADO'] }
    },
    select: { id: true, sourceStoragePath: true, finalStoragePath: true }
  });
  const operation = await stageUserSignatureFiles(client, userId, documents, { rootDir, fileSystem });
  try {
    await client.$transaction(async tx => {
      await acquireUserDeletionLock(tx, userId);
      const currentImpact = assertUserDeletionImpactReady(await userDeletionImpact(tx, userId));
      const currentDocuments = await tx.signatureDocument.findMany({
        where: {
          ownerUserId: userId,
          status: { in: ['RASCUNHO', 'AGUARDANDO_ASSINATURAS', 'CANCELADO'] }
        },
        select: { id: true }
      });
      const expectedIds = documents.map(document => document.id).sort();
      const currentIds = currentDocuments.map(document => document.id).sort();
      if (expectedIds.length !== currentIds.length || expectedIds.some((id, index) => id !== currentIds[index])) {
        throw conflict('Os documentos da conta mudaram durante a exclusão. Tente novamente.', {
          code: 'SIGNATURE_DOCUMENTS_CHANGED',
          assinaturas: currentImpact
        });
      }
      if (currentIds.length) {
        const deleted = await tx.signatureDocument.deleteMany({
          where: {
            id: { in: currentIds },
            ownerUserId: userId,
            status: { in: ['RASCUNHO', 'AGUARDANDO_ASSINATURAS', 'CANCELADO'] }
          }
        });
        if (deleted.count !== currentIds.length) {
          throw conflict('Os documentos da conta mudaram durante a exclusão. Tente novamente.');
        }
      }
      const preserved = await tx.signatureDocument.findMany({
        where: { ownerUserId: userId, status: 'CONCLUIDO' },
        select: { id: true }
      });
      if (preserved.length) {
        await tx.signatureDocumentAuditLog.createMany({
          data: preserved.map(document => ({
            documentId: document.id,
            actorUserId,
            action: 'PROPRIETARIO_REMOVIDO',
            description: 'Conta proprietária removida; documento concluído preservado com o nome histórico.'
          }))
        });
      }
      if (operation) await promoteUserSignatureFilePurge(tx, operation.operationKey);
      await tx.user.delete({ where: { id: userId } });
    });
  } catch (error) {
    await rollbackUserSignatureFiles(client, operation, { rootDir, fileSystem }).catch(() => {});
    throw error;
  }
  if (operation) {
    await purgeAfterCommit(client, operation.operationKey, { now, rootDir, fileSystem }).catch(() => {
      // O manifesto PENDENTE/FALHOU é retomado pelo job durável.
    });
  }
  return { assinaturas: initialImpact, purgeOperationKey: operation?.operationKey || null };
}
