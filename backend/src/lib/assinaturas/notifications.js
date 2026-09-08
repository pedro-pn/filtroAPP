import env from '../../config/env.js';
import {
  buildStandaloneSignatureCompletedEmailTemplate,
  buildStandaloneSignatureRequestEmailTemplate
} from '../email-templates.js';
import {
  clientEmailsEnabled,
  getMissingMailerConfig,
  sendClientMail
} from '../mailer.js';
import prisma from '../prisma.js';
import { decryptSignatureToken, signatureTokenHash } from '../signature-token.js';
import { recordDocumentEvent } from './audit.js';
import { inviteUrl } from './invites.js';
import { signatureOperationLog } from './observability.js';

const MAX_EMAIL_ATTEMPTS = 5;
const CLAIM_STALE_MS = 15 * 60_000;

function retryDelayMs(attempts) {
  return Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60_000;
}

function retryAt(attempts, now) {
  return new Date(now.getTime() + retryDelayMs(attempts));
}

function safeDeliveryError() {
  return 'Falha confirmada no envio. O link continua válido para cópia manual.';
}

function deliveryDisabled(result) {
  return Boolean(result?.skipped);
}

function providerMessageId(result) {
  return String(result?.messageId || result?.response || '').slice(0, 500) || null;
}

function expiresLabel(expiresAt) {
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return 'prazo indisponível';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
}

function assertMailerAvailable(mailer, missingMailerConfig) {
  if (mailer === sendClientMail && clientEmailsEnabled() && missingMailerConfig.length) {
    throw new Error('SMTP indisponível.');
  }
}

function encryptedTokenPayload(signer) {
  return {
    tokenEncrypted: signer.tokenEncrypted,
    tokenIv: signer.tokenIv,
    tokenAuthTag: signer.tokenAuthTag
  };
}

function recoverSignerToken(signer) {
  if (!signer?.tokenHash || !signer.tokenEncrypted || !signer.tokenIv || !signer.tokenAuthTag) {
    throw new Error('Convite sem token recuperável.');
  }
  const token = decryptSignatureToken(encryptedTokenPayload(signer));
  if (signatureTokenHash(token) !== signer.tokenHash) throw new Error('Convite com integridade inválida.');
  return token;
}

export function inviteEmailRetryDue(signer, now = new Date()) {
  if (signer.emailStatus === 'PENDENTE') return true;
  if (signer.emailStatus !== 'FALHOU' || signer.emailAttempts >= MAX_EMAIL_ATTEMPTS) return false;
  const lastAttempt = new Date(signer.updatedAt || 0);
  return Number.isNaN(lastAttempt.getTime())
    || lastAttempt.getTime() + retryDelayMs(signer.emailAttempts || 1) <= now.getTime();
}

export async function sendInviteEmail(client, signerId, {
  now = new Date(),
  mailer = sendClientMail,
  missingMailerConfig = getMissingMailerConfig()
} = {}) {
  const startedAt = Date.now();
  const claimedAt = now;
  const claim = await client.signatureDocumentSigner.updateMany({
    where: {
      id: signerId,
      email: { not: null },
      emailStatus: { in: ['PENDENTE', 'FALHOU'] },
      emailClaimedAt: null,
      emailAttempts: { lt: MAX_EMAIL_ATTEMPTS }
    },
    data: {
      emailStatus: 'EM_ENVIO',
      emailClaimedAt: claimedAt,
      emailAttempts: { increment: 1 },
      emailLastError: null
    }
  });
  if (claim.count !== 1) return { status: 'IGNORADO' };

  const signer = await client.signatureDocumentSigner.findUnique({
    where: { id: signerId },
    include: { document: true }
  });
  if (!signer?.email || !signer.document) return { status: 'IGNORADO' };

  await recordDocumentEvent(client, {
    document: signer.document,
    signer,
    action: 'EMAIL_SOLICITADO',
    description: `Envio de convite solicitado para ${signer.name}.`
  });

  try {
    assertMailerAvailable(mailer, missingMailerConfig);
    const token = recoverSignerToken(signer);
    const template = buildStandaloneSignatureRequestEmailTemplate({
      documentTitle: signer.document.title,
      requesterNameSnapshot: signer.document.requesterNameSnapshot,
      signerName: signer.name,
      signUrl: inviteUrl(token),
      expiresLabel: expiresLabel(signer.tokenExpiresAt)
    });
    const result = await mailer({ to: signer.email, ...template });
    if (deliveryDisabled(result)) throw new Error('Envio de e-mail desativado.');
    const persisted = await client.signatureDocumentSigner.updateMany({
      where: { id: signer.id, emailStatus: 'EM_ENVIO', emailClaimedAt: claimedAt },
      data: {
        emailStatus: 'ENVIADO',
        emailSentAt: now,
        emailClaimedAt: null,
        emailLastError: null
      }
    });
    if (persisted.count !== 1) return { status: 'REVISAO_NECESSARIA' };
    await recordDocumentEvent(client, {
      document: signer.document,
      signer,
      action: 'EMAIL_ENVIADO',
      description: `Convite enviado para ${signer.name}.`
    });
    signatureOperationLog('email.invite', {
      documentId: signer.document.id,
      attempts: signer.emailAttempts,
      outcome: 'sent'
    }, { startedAt });
    return { status: 'ENVIADO', providerMessageId: providerMessageId(result) };
  } catch {
    await client.signatureDocumentSigner.updateMany({
      where: { id: signer.id, emailStatus: 'EM_ENVIO', emailClaimedAt: claimedAt },
      data: {
        emailStatus: 'FALHOU',
        emailClaimedAt: null,
        emailLastError: safeDeliveryError()
      }
    });
    await recordDocumentEvent(client, {
      document: signer.document,
      signer,
      action: 'EMAIL_FALHOU',
      description: `Falha confirmada ao enviar convite para ${signer.name}; o link permanece válido.`
    });
    signatureOperationLog('email.invite', {
      documentId: signer.document.id,
      attempts: signer.emailAttempts,
      outcome: 'retry'
    }, { level: 'warn', startedAt });
    return { status: 'FALHOU' };
  }
}

export async function markAmbiguousInviteClaims(client, { now = new Date() } = {}) {
  const staleBefore = new Date(now.getTime() - CLAIM_STALE_MS);
  const stale = await client.signatureDocumentSigner.findMany({
    where: { emailStatus: 'EM_ENVIO', emailClaimedAt: { lte: staleBefore } },
    include: { document: true },
    take: 50
  });
  let reviewed = 0;
  for (const signer of stale) {
    const updated = await client.signatureDocumentSigner.updateMany({
      where: { id: signer.id, emailStatus: 'EM_ENVIO', emailClaimedAt: signer.emailClaimedAt },
      data: {
        emailStatus: 'REVISAO_NECESSARIA',
        emailClaimedAt: null,
        emailLastError: 'Resultado do provedor desconhecido; reenvio automático bloqueado.'
      }
    });
    if (updated.count !== 1) continue;
    reviewed += 1;
    await recordDocumentEvent(client, {
      document: signer.document,
      signer,
      action: 'EMAIL_FALHOU',
      description: `Envio para ${signer.name} requer revisão para evitar duplicidade.`
    });
  }
  return reviewed;
}

export async function processInviteEmailQueue(client = prisma, { now = new Date(), limit = 25, ...dependencies } = {}) {
  const reviewed = await markAmbiguousInviteClaims(client, { now });
  const candidates = await client.signatureDocumentSigner.findMany({
    where: {
      email: { not: null },
      emailStatus: { in: ['PENDENTE', 'FALHOU'] },
      emailClaimedAt: null,
      emailAttempts: { lt: MAX_EMAIL_ATTEMPTS },
      document: { status: 'AGUARDANDO_ASSINATURAS', deletedAt: null }
    },
    orderBy: { updatedAt: 'asc' },
    take: limit
  });
  let sent = 0;
  let failed = 0;
  for (const signer of candidates.filter(item => inviteEmailRetryDue(item, now))) {
    const result = await sendInviteEmail(client, signer.id, { now, ...dependencies });
    if (result.status === 'ENVIADO') sent += 1;
    if (result.status === 'FALHOU') failed += 1;
  }
  return { found: candidates.length, sent, failed, reviewed };
}

export async function queueInviteEmails(client, documentId, dependencies = {}) {
  const signers = await client.signatureDocumentSigner.findMany({
    where: { documentId, email: { not: null }, emailStatus: 'PENDENTE' },
    select: { id: true }
  });
  const results = [];
  for (const signer of signers) results.push(await sendInviteEmail(client, signer.id, dependencies));
  return results;
}

export async function resendInviteEmail(client, document, signer, dependencies = {}) {
  if (!signer || signer.documentId !== document.id) {
    const error = new Error('Assinante não encontrado.');
    error.statusCode = 404;
    throw error;
  }
  if (!signer.email) {
    const error = new Error('Este assinante não possui e-mail. Copie o link manualmente.');
    error.statusCode = 409;
    throw error;
  }
  if (!['PENDENTE', 'VISUALIZADO'].includes(signer.status) || !signer.tokenHash) {
    const error = new Error('Este convite não pode ser reenviado.');
    error.statusCode = 409;
    throw error;
  }
  await client.signatureDocumentSigner.update({
    where: { id: signer.id },
    data: {
      emailStatus: 'PENDENTE',
      emailAttempts: 0,
      emailClaimedAt: null,
      emailLastError: null
    }
  });
  return sendInviteEmail(client, signer.id, dependencies);
}

export async function markAmbiguousCompletionClaims(client, { now = new Date() } = {}) {
  const staleBefore = new Date(now.getTime() - CLAIM_STALE_MS);
  const result = await client.signatureDocumentCompletionNotification.updateMany({
    where: { status: 'EM_ENVIO', claimedAt: { lte: staleBefore } },
    data: {
      status: 'REVISAO_NECESSARIA',
      claimedAt: null,
      lastError: 'Resultado do provedor desconhecido; reenvio automático bloqueado.'
    }
  });
  return result.count;
}

export async function sendCompletedEmailAttempt(client, notificationId, {
  now = new Date(),
  mailer = sendClientMail,
  missingMailerConfig = getMissingMailerConfig()
} = {}) {
  const startedAt = Date.now();
  const claimedAt = now;
  const claim = await client.signatureDocumentCompletionNotification.updateMany({
    where: {
      id: notificationId,
      status: { in: ['PENDENTE', 'FALHOU'] },
      claimedAt: null,
      attempts: { lt: MAX_EMAIL_ATTEMPTS },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }]
    },
    data: { status: 'EM_ENVIO', claimedAt, attempts: { increment: 1 }, lastError: null }
  });
  if (claim.count !== 1) return { status: 'IGNORADO' };

  const notification = await client.signatureDocumentCompletionNotification.findUnique({
    where: { id: notificationId },
    include: { document: { include: { signers: { orderBy: { position: 'asc' } } } } }
  });
  if (!notification?.document) return { status: 'IGNORADO' };

  try {
    assertMailerAvailable(mailer, missingMailerConfig);
    const template = buildStandaloneSignatureCompletedEmailTemplate({
      documentTitle: notification.document.title,
      signerNames: notification.document.signers.map(signer => signer.declaredSignerName || signer.name),
      finalDocumentHash: notification.document.finalDocumentHash,
      appUrl: String(env.appUrl || '').replace(/\/+$/, '')
    });
    const result = await mailer({ to: notification.emailTo, ...template });
    if (deliveryDisabled(result)) throw new Error('Envio de e-mail desativado.');
    await client.signatureDocumentCompletionNotification.updateMany({
      where: { id: notification.id, status: 'EM_ENVIO', claimedAt },
      data: {
        status: 'ENVIADO',
        claimedAt: null,
        nextAttemptAt: null,
        providerMessageId: providerMessageId(result),
        lastError: null,
        sentAt: now
      }
    });
    signatureOperationLog('email.completion', {
      documentId: notification.document.id,
      attempts: notification.attempts,
      outcome: 'sent'
    }, { startedAt });
    return { status: 'ENVIADO' };
  } catch {
    const current = await client.signatureDocumentCompletionNotification.findUnique({
      where: { id: notification.id },
      select: { attempts: true }
    });
    await client.signatureDocumentCompletionNotification.updateMany({
      where: { id: notification.id, status: 'EM_ENVIO', claimedAt },
      data: {
        status: 'FALHOU',
        claimedAt: null,
        nextAttemptAt: retryAt(current?.attempts || 1, now),
        lastError: safeDeliveryError()
      }
    });
    signatureOperationLog('email.completion', {
      documentId: notification.document.id,
      attempts: current?.attempts || 1,
      outcome: 'retry'
    }, { level: 'warn', startedAt });
    return { status: 'FALHOU' };
  }
}

export async function processCompletionEmailQueue(client = prisma, { now = new Date(), limit = 25, ...dependencies } = {}) {
  const reviewed = await markAmbiguousCompletionClaims(client, { now });
  const candidates = await client.signatureDocumentCompletionNotification.findMany({
    where: {
      status: { in: ['PENDENTE', 'FALHOU'] },
      attempts: { lt: MAX_EMAIL_ATTEMPTS },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }]
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: limit
  });
  let sent = 0;
  let failed = 0;
  for (const notification of candidates) {
    const result = await sendCompletedEmailAttempt(client, notification.id, { now, ...dependencies });
    if (result.status === 'ENVIADO') sent += 1;
    if (result.status === 'FALHOU') failed += 1;
  }
  return { found: candidates.length, sent, failed, reviewed };
}

export async function queueCompletedEmail(client, documentId, dependencies = {}) {
  const notification = await client.signatureDocumentCompletionNotification.findUnique({
    where: { documentId },
    select: { id: true }
  });
  return notification ? sendCompletedEmailAttempt(client, notification.id, dependencies) : { status: 'IGNORADO' };
}
