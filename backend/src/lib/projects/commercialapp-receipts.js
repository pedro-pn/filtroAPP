import { projectAllowsChannel, projectChannelWhere } from './distribution.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import prisma from '../prisma.js';
import { commercialTransaction, lockCommercialProject } from '../acompanhamento/commercial-contributions.js';
import { commercialAppConnection, readLimitedCommercialResponse } from './commercialapp-client.js';

const LEASE_MS = 60_000;
const pending = ['PENDING', 'SENDING'];
const scopeStatus = z.enum(['APPLIED', 'IMPORTED', 'UNCHANGED', 'PARTIAL', 'NEEDS_REVIEW', 'MANUAL_PRESERVED', 'SELECTION_PRESERVED']);
const budgetStatus = z.enum(['SELECTED', 'STAGED']);
const acknowledgementSchema = z.object({
  contractVersion: z.literal(1), eventId: z.uuid(), proposalId: z.string(), proposalCode: z.string(),
  revisionNumber: z.number().int(), projectId: z.string(), generationId: z.string(),
  budgetStatus, scopeStatus, deliveryStatus: z.enum(['SUCESSO', 'AGUARDANDO_SELECAO']),
  importedAt: z.iso.datetime({ offset: true }), acknowledgedAt: z.iso.datetime({ offset: true }), duplicate: z.boolean()
});

// Must be called in the same transaction that saved the PDFs, budget and scope.
export async function queueCommercialReceipt(tx, { projectId, bundle, budgetStatus: budget, scopeStatus: scope, importedAt = new Date() }) {
  const previous = await tx.commercialAppReceipt.findFirst({
    where: { externalId: bundle.proposalId }, orderBy: [{ importedAt: 'desc' }, { eventId: 'desc' }]
  });
  // Keep ordering deterministic even when imports commit within the same millisecond.
  const date = new Date(Math.max(importedAt.getTime(), previous ? previous.importedAt.getTime() + 1 : 0));
  const payload = {
    contractVersion: 1, source: 'FILTRO_APP', eventId: randomUUID(), proposalId: bundle.proposalId,
    projectId, generationId: bundle.documents[0].generationId, importedAt: date.toISOString(),
    budgetStatus: budgetStatus.parse(budget), scopeStatus: scopeStatus.parse(scope),
    documents: bundle.documents.map(({ id, kind, sha256 }) => ({ id, kind, sha256 }))
  };
  return tx.commercialAppReceipt.create({ data: {
    eventId: payload.eventId, projectId, externalId: bundle.proposalId,
    proposalCode: bundle.proposalCode, revisionNumber: bundle.revisionNumber,
    payload, importedAt: date, nextAttemptAt: date
  } });
}

export async function sendCommercialReceipt(receipt, options = {}) {
  const connection = commercialAppConnection(options);
  const payload = receipt.payload;
  const response = await (options.transport || fetch)(
    `${connection.origin}/api/integrations/filtroapp/propostas/${encodeURIComponent(receipt.proposalCode)}/revisoes/${receipt.revisionNumber}/recebimento`, {
      method: 'POST', headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(15_000)
    });
  const bytes = await readLimitedCommercialResponse(response, 16_384);
  let ack;
  try { ack = acknowledgementSchema.parse(JSON.parse(bytes.toString('utf8'))); }
  catch { throw Object.assign(new Error('COMERCIALAPP_RECEIPT_ACK_INVALID'), { code: 'COMERCIALAPP_RECEIPT_ACK_INVALID' }); }
  if (['eventId', 'proposalId', 'projectId', 'generationId', 'budgetStatus', 'scopeStatus', 'importedAt']
    .some(key => ack[key] !== payload[key]) || ack.proposalCode !== receipt.proposalCode
    || ack.revisionNumber !== receipt.revisionNumber
    || ack.deliveryStatus !== (payload.budgetStatus === 'SELECTED' ? 'SUCESSO' : 'AGUARDANDO_SELECAO')) {
    throw Object.assign(new Error('COMERCIALAPP_RECEIPT_ACK_INVALID'), { code: 'COMERCIALAPP_RECEIPT_ACK_INVALID' });
  }
  return ack;
}

async function claimReceipt(database, eventId, now) {
  return commercialTransaction(async tx => {
    const row = await tx.commercialAppReceipt.findUnique({ where: { eventId } });
    if (!row || !pending.includes(row.status)) return null;
    const project = await lockCommercialProject(tx, row.projectId);
    if (!projectAllowsChannel(project, 'commercial')) return null;
    const oldest = await tx.commercialAppReceipt.findFirst({ where: { externalId: row.externalId, status: { in: pending } },
      orderBy: [{ importedAt: 'asc' }, { eventId: 'asc' }] });
    if (oldest?.eventId !== eventId || row.nextAttemptAt > now
      || row.status === 'SENDING' && row.attemptAt > new Date(now.getTime() - LEASE_MS)) return null;
    const attemptId = randomUUID();
    await tx.commercialAppReceipt.update({ where: { eventId }, data: {
      status: 'SENDING', attemptId, attemptAt: now, nextAttemptAt: new Date(now.getTime() + LEASE_MS),
      attempts: { increment: 1 }, errorCode: null
    } });
    return { ...row, attemptId, attempts: row.attempts + 1 };
  }, database);
}

export async function processCommercialReceipts(options = {}) {
  const database = options.database || prisma;
  commercialAppConnection(options);
  const now = options.now || new Date();
  const rows = await database.commercialAppReceipt.findMany({ where: {
    status: { in: pending }, nextAttemptAt: { lte: now },
    project: { ...projectChannelWhere('commercial'), isActive: true }
  }, orderBy: [{ importedAt: 'asc' }, { eventId: 'asc' }], take: 20 });
  const results = [];
  for (const row of rows) {
    const attemptAt = options.now || new Date();
    const claimed = await claimReceipt(database, row.eventId, attemptAt);
    if (!claimed) continue;
    try {
      const ack = await sendCommercialReceipt(claimed, options);
      await database.commercialAppReceipt.updateMany({ where: { eventId: row.eventId, attemptId: claimed.attemptId }, data: {
        status: 'DELIVERED', acknowledgement: ack, deliveredAt: new Date(), nextAttemptAt: null,
        errorCode: null, attemptId: null, attemptAt: null
      } });
      results.push({ eventId: row.eventId, status: 'DELIVERED' });
    } catch (error) {
      // Never persist upstream bodies, URLs, tokens or generic exception messages.
      const code = /^COMERCIALAPP_[A-Z_0-9]+$/.test(error.code || '') ? error.code : 'COMERCIALAPP_RECEIPT_SEND_FAILED';
      const review = /^COMERCIALAPP_HTTP_(400|401|403|404|409|410|422)$/.test(code) || claimed.attempts >= 10;
      await database.commercialAppReceipt.updateMany({ where: { eventId: row.eventId, attemptId: claimed.attemptId }, data: {
        status: review ? 'REVIEW' : 'PENDING', errorCode: code, attemptId: null, attemptAt: null,
        nextAttemptAt: review ? null : new Date(attemptAt.getTime() + Math.min(3_600_000, 60_000 * 2 ** Math.min(claimed.attempts - 1, 6)))
      } });
      results.push({ eventId: row.eventId, status: review ? 'REVIEW' : 'PENDING', errorCode: code });
    }
  }
  return results;
}
