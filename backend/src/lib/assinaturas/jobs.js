import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import env from '../../config/env.js';
import { runTrackedJob } from '../jobs/runner.js';
import prisma from '../prisma.js';
import { safeDocumentPathPart } from '../documents/storage.js';
import { recordDocumentEvent } from './audit.js';
import { purgeDocumentFiles, sourcePdfBuffer } from './document.js';
import { buildFinalPdfBytes } from './final-pdf.js';
import { processSignatureFilePurges } from './file-quarantine.js';
import { expireOverdueInvites } from './invites.js';
import { purgePreviews } from './preview.js';
import { signatureOperationLog } from './observability.js';
import {
  processCompletionEmailQueue,
  processInviteEmailQueue,
  queueCompletedEmail
} from './notifications.js';

const FINALIZATION_INTERVAL_MS = 60_000;
const EMAIL_INTERVAL_MS = 5 * 60_000;
const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60_000;
const CLAIM_TTL_MS = 5 * 60_000;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function finalRelativePath(documentId) {
  const safeId = safeDocumentPathPart(documentId);
  if (!safeId || safeId !== String(documentId)) throw new TypeError('Invalid signature document id.');
  return `Assinaturas/Assinados/${safeId}-assinado.pdf`;
}

export async function persistFinalBytes(documentId, bytes, rootDir, {
  fileSystem = fs,
  afterRename = null
} = {}) {
  const relativePath = finalRelativePath(documentId);
  const targetPath = path.join(rootDir, ...relativePath.split('/'));
  const directory = path.dirname(targetPath);
  await fileSystem.mkdir(directory, { recursive: true });
  const temporaryPath = path.join(directory, `.${path.basename(targetPath)}.${randomUUID()}.tmp`);
  await fileSystem.writeFile(temporaryPath, bytes, { flag: 'wx' });
  try {
    await fileSystem.rename(temporaryPath, targetPath);
  } catch (error) {
    await fileSystem.unlink(temporaryPath).catch(() => {});
    throw error;
  }
  if (afterRename) await afterRename({ temporaryPath, targetPath });
  const persisted = await fileSystem.readFile(targetPath);
  const expectedHash = sha256(bytes);
  if (sha256(persisted) !== expectedHash) {
    throw new Error('Final PDF integrity check failed.');
  }
  return { relativePath, hash: expectedHash };
}

function retryAt(attempts, now) {
  const delayMinutes = Math.min(60, 2 ** Math.max(0, attempts - 1));
  return new Date(now.getTime() + (delayMinutes * 60_000));
}

export async function processDocumentFinalization(client, documentId, {
  now = new Date(),
  rootDir = env.uploadDir,
  loadSource = sourcePdfBuffer,
  buildBytes = buildFinalPdfBytes,
  persistBytes = persistFinalBytes,
  deliverCompletion = queueCompletedEmail
} = {}) {
  const startedAt = Date.now();
  const staleClaim = new Date(now.getTime() - CLAIM_TTL_MS);
  const claim = await client.signatureDocument.updateMany({
    where: {
      id: documentId,
      status: 'FINALIZANDO',
      OR: [
        { finalizationClaimedAt: null },
        { finalizationClaimedAt: { lte: staleClaim } }
      ]
    },
    data: {
      finalizationClaimedAt: now,
      finalizationAttempts: { increment: 1 },
      finalizationLastError: null
    }
  });
  if (claim.count !== 1) {
    return client.signatureDocument.findUnique({ where: { id: documentId } });
  }

  const document = await client.signatureDocument.findUnique({
    where: { id: documentId },
    include: {
      signers: { orderBy: { position: 'asc' } },
      fields: { orderBy: [{ pageNumber: 'asc' }, { createdAt: 'asc' }] },
      owner: { select: { email: true, notifySignaturesByEmail: true } }
    }
  });
  if (!document || document.status !== 'FINALIZANDO') return document;

  try {
    const sourceBytes = await loadSource(document, { rootDir });
    const finalBytes = await buildBytes(document, sourceBytes);
    const persisted = await persistBytes(document.id, finalBytes, rootDir);
    const completed = await client.$transaction(async tx => {
      const transition = await tx.signatureDocument.updateMany({
        where: { id: document.id, status: 'FINALIZANDO' },
        data: {
          status: 'CONCLUIDO',
          finalStoragePath: persisted.relativePath,
          finalDocumentHash: persisted.hash,
          completedAt: now,
          finalizationClaimedAt: null,
          finalizationNextAttemptAt: null,
          finalizationLastError: null
        }
      });
      if (transition.count !== 1) {
        return tx.signatureDocument.findUnique({ where: { id: document.id } });
      }
      await recordDocumentEvent(tx, {
        document,
        action: 'PDF_FINAL_GERADO',
        description: 'PDF final gerado e verificado.'
      });
      await recordDocumentEvent(tx, {
        document,
        action: 'DOCUMENTO_CONCLUIDO',
        description: 'Documento concluído com todas as assinaturas.'
      });
      if (document.owner?.email && document.owner.notifySignaturesByEmail !== false) {
        await tx.signatureDocumentCompletionNotification.upsert({
          where: { documentId: document.id },
          create: {
            documentId: document.id,
            idempotencyKey: `assinaturas:completed:${document.id}`,
            emailTo: document.owner.email
          },
          update: {}
        });
      }
      return tx.signatureDocument.findUnique({ where: { id: document.id } });
    });
    if (completed?.status === 'CONCLUIDO') {
      await deliverCompletion(client, document.id, { now }).catch(() => {
        // A outbox já foi commitada; o job de e-mail fará a recuperação.
      });
    }
    signatureOperationLog('finalization.process', {
      documentId: document.id,
      attempts: document.finalizationAttempts,
      status: completed?.status,
      outcome: 'completed'
    }, { startedAt });
    return completed;
  } catch (error) {
    const current = await client.signatureDocument.findUnique({
      where: { id: document.id },
      select: { finalizationAttempts: true }
    });
    await client.$transaction(async tx => {
      await tx.signatureDocument.updateMany({
        where: { id: document.id, status: 'FINALIZANDO' },
        data: {
          finalizationClaimedAt: null,
          finalizationNextAttemptAt: retryAt(current?.finalizationAttempts || 1, now),
          finalizationLastError: 'Falha ao gerar ou persistir o PDF final.'
        }
      });
      await recordDocumentEvent(tx, {
        document,
        action: 'FINALIZACAO_FALHOU',
        description: 'A finalização falhou e será retomada automaticamente.'
      });
    });
    signatureOperationLog('finalization.process', {
      documentId: document.id,
      attempts: current?.finalizationAttempts || 1,
      outcome: 'retry'
    }, { level: 'warn', startedAt });
    throw error;
  }
}

export async function processPendingFinalizations(client = prisma, { now = new Date() } = {}) {
  const documents = await client.signatureDocument.findMany({
    where: {
      status: 'FINALIZANDO',
      OR: [
        { finalizationNextAttemptAt: null },
        { finalizationNextAttemptAt: { lte: now } }
      ]
    },
    select: { id: true },
    orderBy: { updatedAt: 'asc' },
    take: 10
  });
  let completed = 0;
  for (const document of documents) {
    const result = await processDocumentFinalization(client, document.id, { now }).catch(() => null);
    if (result?.status === 'CONCLUIDO') completed += 1;
  }
  return { found: documents.length, completed };
}

export async function purgeDeletedSignatureDocuments(client = prisma, {
  now = new Date(),
  rootDir = env.uploadDir,
  limit = 25,
  purgeFiles = purgeDocumentFiles,
  purgePreviewFiles = purgePreviews
} = {}) {
  const cutoff = new Date(now.getTime() - (env.assinaturasDeletedRetentionDays * 24 * 60 * 60_000));
  const documents = await client.signatureDocument.findMany({
    where: { deletedAt: { lte: cutoff }, filesPurgedAt: null },
    orderBy: { deletedAt: 'asc' },
    take: limit
  });
  let purged = 0;
  for (const document of documents) {
    await purgeFiles(document, { rootDir });
    await purgePreviewFiles(document.id, { rootDir });
    await client.$transaction(async tx => {
      const updated = await tx.signatureDocument.updateMany({
        where: { id: document.id, filesPurgedAt: null },
        data: {
          sourceStoragePath: null,
          finalStoragePath: null,
          filesPurgedAt: now
        }
      });
      if (updated.count !== 1) return;
      await recordDocumentEvent(tx, {
        document,
        action: 'ARQUIVOS_PURGADOS',
        description: 'Arquivos removidos após o prazo de retenção; a trilha foi preservada.'
      });
      purged += 1;
    });
  }
  return { found: documents.length, purged };
}

export async function processAssinaturasMaintenance(client = prisma, { now = new Date(), ...dependencies } = {}) {
  const invites = await expireOverdueInvites(client, { now });
  const files = await purgeDeletedSignatureDocuments(client, { now, ...dependencies });
  return { invites, files };
}

export function startAssinaturasJobs({ client = prisma, intervalMs = FINALIZATION_INTERVAL_MS } = {}) {
  const runFinalization = () => runTrackedJob(
    'assinaturas:finalization',
    () => processPendingFinalizations(client),
    { prismaClient: client, lockTtlMs: Math.max(intervalMs * 2, CLAIM_TTL_MS) }
  ).catch(error => {
    console.error('Falha no job de finalização de assinaturas.', error?.message || error);
  });
  const runInvites = () => runTrackedJob(
    'assinaturas:invite-emails',
    () => processInviteEmailQueue(client),
    { prismaClient: client, lockTtlMs: EMAIL_INTERVAL_MS * 2 }
  ).catch(error => {
    console.error('Falha no job de e-mails de convite de assinaturas.', error?.message || error);
  });
  const runCompletions = () => runTrackedJob(
    'assinaturas:completion-emails',
    () => processCompletionEmailQueue(client),
    { prismaClient: client, lockTtlMs: EMAIL_INTERVAL_MS * 2 }
  ).catch(error => {
    console.error('Falha no job de avisos de conclusão de assinaturas.', error?.message || error);
  });
  const runFilePurges = () => runTrackedJob(
    'assinaturas:file-purge',
    () => processSignatureFilePurges(client),
    { prismaClient: client, lockTtlMs: CLAIM_TTL_MS * 2 }
  ).catch(error => {
    console.error('Falha no job de purga da quarentena de assinaturas.', error?.message || error);
  });
  const runMaintenance = () => runTrackedJob(
    'assinaturas:maintenance',
    () => processAssinaturasMaintenance(client),
    { prismaClient: client, lockTtlMs: 60 * 60_000 }
  ).catch(error => {
    console.error('Falha no job de manutenção de assinaturas.', error?.message || error);
  });
  const timers = [
    setInterval(runFinalization, intervalMs),
    setInterval(runInvites, EMAIL_INTERVAL_MS),
    setInterval(runCompletions, EMAIL_INTERVAL_MS),
    setInterval(runFilePurges, intervalMs),
    setInterval(runMaintenance, MAINTENANCE_INTERVAL_MS)
  ];
  for (const timer of timers) timer.unref?.();
  setTimeout(runFinalization, 1_000).unref?.();
  setTimeout(runInvites, 2_000).unref?.();
  setTimeout(runCompletions, 3_000).unref?.();
  setTimeout(runFilePurges, 4_000).unref?.();
  setTimeout(runMaintenance, 5_000).unref?.();
  return timers;
}
