import { recordDocumentEvent } from './audit.js';

export async function beginDocumentFinalization(tx, document, { now = new Date(), actorUserId = null } = {}) {
  if (typeof tx.$queryRawUnsafe === 'function') {
    await tx.$queryRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1), 0)::text AS lock_result',
      document.id
    );
  }
  const remaining = await tx.signatureDocumentSigner.count({
    where: { documentId: document.id, isRequired: true, status: { notIn: ['ASSINADO', 'REVOGADO'] } }
  });
  if (remaining > 0) return false;
  const signed = await tx.signatureDocumentSigner.count({
    where: { documentId: document.id, status: 'ASSINADO' }
  });
  if (signed === 0) return false;
  const transition = await tx.signatureDocument.updateMany({
    where: { id: document.id, status: 'AGUARDANDO_ASSINATURAS', deletedAt: null },
    data: {
      status: 'FINALIZANDO',
      finalizationClaimedAt: null,
      finalizationNextAttemptAt: now,
      finalizationLastError: null
    }
  });
  if (transition.count !== 1) return false;
  await recordDocumentEvent(tx, {
    document,
    actorUserId,
    action: 'FINALIZACAO_INICIADA',
    description: 'Todas as assinaturas obrigatórias ativas foram recebidas; finalização iniciada.'
  });
  return true;
}

export function scheduleDocumentFinalization(client, documentId, dependencies = {}) {
  const schedule = dependencies.scheduleFinalization || setImmediate;
  try {
    schedule(async () => {
      try {
        const finalize = dependencies.processFinalization || (await import('./jobs.js')).processDocumentFinalization;
        await finalize(client, documentId);
      } catch {
        // The durable job retries after the accepted signature or revocation.
      }
    });
  } catch {
    // The durable job still sees FINALIZANDO if scheduling is unavailable.
  }
}
