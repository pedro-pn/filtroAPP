import { buildStandaloneSignatureRequestEmailTemplate } from '../email-templates.js';
import { getMissingMailerConfig, sendClientMail } from '../mailer.js';
import { decryptSignatureToken, signatureTokenHash } from '../signature-token.js';
import { recordDocumentEvent } from './audit.js';
import { groupMemberInclude } from './grouped-invites.js';
import { inviteUrl } from './invites.js';

const MAX_ATTEMPTS = 5;
const pendingMember = { status: { in: ['PENDENTE', 'VISUALIZADO'] }, email: { not: null }, document: { status: 'AGUARDANDO_ASSINATURAS', deletedAt: null } };

async function auditGroup(client, group, action, description) {
  for (const member of group.members) await recordDocumentEvent(client, { document: member.document, signer: member, action, description });
}

export async function sendGroupInviteEmail(client, id, { now = new Date(), mailer = sendClientMail, missingMailerConfig = getMissingMailerConfig() } = {}) {
  const claim = await client.signatureInviteGroup.updateMany({ where: {
    id, emailStatus: { in: ['PENDENTE', 'FALHOU'] }, emailClaimedAt: null,
    emailAttempts: { lt: MAX_ATTEMPTS }, tokenExpiresAt: { gt: now }, members: { some: pendingMember }
  }, data: { emailStatus: 'EM_ENVIO', emailClaimedAt: now, emailAttempts: { increment: 1 }, emailLastError: null } });
  if (claim.count !== 1) return { status: 'IGNORADO' };
  const group = await client.signatureInviteGroup.findUnique({ where: { id }, include: groupMemberInclude });
  const recipient = group.members.find(member => member.email && ['PENDENTE', 'VISUALIZADO'].includes(member.status));
  if (!recipient) {
    await client.signatureInviteGroup.updateMany({ where: { id, emailStatus: 'EM_ENVIO', emailClaimedAt: now }, data: { emailStatus: 'NAO_APLICAVEL', emailClaimedAt: null } });
    return { status: 'IGNORADO' };
  }
  await auditGroup(client, group, 'EMAIL_SOLICITADO', `Envio do convite único solicitado para ${recipient.name}.`);
  try {
    if (mailer === sendClientMail && missingMailerConfig.length) throw new Error('SMTP indisponível.');
    const token = decryptSignatureToken(group);
    if (signatureTokenHash(token) !== group.tokenHash) throw new Error('Integridade inválida.');
    const result = await mailer({ to: recipient.email, ...buildStandaloneSignatureRequestEmailTemplate({
      documentTitle: recipient.document.title,
      documentTitles: group.members.map(member => member.document.title),
      requesterNameSnapshot: recipient.document.requesterNameSnapshot, signerName: recipient.name,
      signUrl: inviteUrl(token), expiresLabel: new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(group.tokenExpiresAt)
    }) });
    if (result?.skipped) throw new Error('Envio desativado.');
  } catch {
    await client.signatureInviteGroup.updateMany({ where: { id, emailStatus: 'EM_ENVIO', emailClaimedAt: now }, data: {
      emailStatus: 'FALHOU', emailClaimedAt: null, emailLastError: 'Falha confirmada no envio. O link continua válido para cópia manual.'
    } });
    await auditGroup(client, group, 'EMAIL_FALHOU', `Falha ao enviar o convite único para ${recipient.name}.`);
    return { status: 'FALHOU' };
  }
  // Falhas após a entrega deixam o claim para revisão, evitando duplicar o e-mail.
  const persisted = await client.signatureInviteGroup.updateMany({ where: { id, emailStatus: 'EM_ENVIO', emailClaimedAt: now }, data: {
    emailStatus: 'ENVIADO', emailSentAt: now, emailClaimedAt: null, emailLastError: null
  } });
  if (persisted.count !== 1) return { status: 'REVISAO_NECESSARIA' };
  await auditGroup(client, group, 'EMAIL_ENVIADO', `Convite único enviado para ${recipient.name}.`);
  return { status: 'ENVIADO' };
}

export async function resendGroupInviteEmail(client, id, dependencies) {
  await client.signatureInviteGroup.update({ where: { id }, data: { emailStatus: 'PENDENTE', emailAttempts: 0, emailClaimedAt: null, emailLastError: null } });
  return sendGroupInviteEmail(client, id, dependencies);
}

export async function processGroupInviteEmailQueue(client, { now = new Date(), limit = 25, ...dependencies } = {}) {
  const stale = await client.signatureInviteGroup.updateMany({ where: { emailStatus: 'EM_ENVIO', emailClaimedAt: { lte: new Date(now.getTime() - 15 * 60_000) } }, data: {
    emailStatus: 'REVISAO_NECESSARIA', emailClaimedAt: null, emailLastError: 'Resultado do provedor desconhecido; reenvio automático bloqueado.'
  } });
  const candidates = await client.signatureInviteGroup.findMany({ where: {
    emailStatus: { in: ['PENDENTE', 'FALHOU'] }, emailClaimedAt: null, emailAttempts: { lt: MAX_ATTEMPTS },
    tokenExpiresAt: { gt: now }, members: { some: pendingMember }
  }, orderBy: { updatedAt: 'asc' }, take: limit });
  let sent = 0;
  let failed = 0;
  for (const group of candidates) {
    const delay = Math.min(60, 2 ** Math.max(0, group.emailAttempts - 1)) * 60_000;
    if (group.emailStatus === 'FALHOU' && new Date(group.updatedAt).getTime() + delay > now.getTime()) continue;
    const result = await sendGroupInviteEmail(client, group.id, { now, ...dependencies });
    if (result.status === 'ENVIADO') sent++;
    if (result.status === 'FALHOU') failed++;
  }
  return { found: candidates.length, sent, failed, reviewed: stale.count };
}
