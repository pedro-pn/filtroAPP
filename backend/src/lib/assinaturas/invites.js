import env from '../../config/env.js';
import {
  decryptSignatureToken,
  signatureTokenData,
  signatureTokenHash
} from '../signature-token.js';
import { recordDocumentEvent } from './audit.js';

function httpError(message, statusCode = 400) {
  const error = new Error(message);
  error.status = statusCode;
  error.statusCode = statusCode;
  return error;
}

export function inviteUrl(token, appUrl = env.appUrl) {
  const base = String(appUrl || '').replace(/\/+$/, '');
  return `${base}/assinaturas/assinar#convite=${encodeURIComponent(token)}`;
}

export async function issueInvites(client, document, expiresAt, {
  actorUserId = null,
  tokenFactory = signatureTokenData
} = {}) {
  const issued = [];
  for (const signer of document.signers || []) {
    const tokenData = tokenFactory();
    const { token, ...persistedTokenData } = tokenData;
    const updatedSigner = await client.signatureDocumentSigner.update({
      where: { id: signer.id },
      data: {
        status: 'PENDENTE',
        ...persistedTokenData,
        tokenExpiresAt: expiresAt,
        invalidationReason: null,
        revokedAt: null,
        expiredAt: null,
        emailStatus: signer.email ? 'PENDENTE' : 'NAO_APLICAVEL',
        emailAttempts: 0,
        emailSentAt: null,
        emailLastError: null,
        emailClaimedAt: null
      }
    });
    await recordDocumentEvent(client, {
      document,
      signer,
      actorUserId,
      action: 'CONVITE_CRIADO',
      description: `Convite criado para ${signer.name}.`
    });
    issued.push({ signer: updatedSigner, token, url: inviteUrl(token) });
  }
  return issued;
}

export async function recoverInviteLink(client, document, signer, actorUserId) {
  if (!signer || signer.documentId !== document.id || !signer.tokenHash) {
    throw httpError('Convite não encontrado.', 404);
  }
  if (!signer.tokenEncrypted || !signer.tokenIv || !signer.tokenAuthTag) {
    throw httpError('Este convite não possui link recuperável.', 409);
  }
  let token;
  try {
    token = decryptSignatureToken(signer);
  } catch {
    throw httpError('Não foi possível recuperar o link deste convite.', 409);
  }
  if (signatureTokenHash(token) !== signer.tokenHash) {
    throw httpError('Não foi possível confirmar a integridade do convite.', 409);
  }
  await recordDocumentEvent(client, {
    document,
    signer,
    actorUserId,
    action: 'LINK_RECUPERADO',
    description: `Link recuperado para ${signer.name}.`
  });
  return { url: inviteUrl(token), expiresAt: signer.tokenExpiresAt };
}

export async function resolveInviteByToken(client, token) {
  const value = String(token || '');
  if (!/^[a-f0-9]{64}$/i.test(value)) return null;
  return client.signatureDocumentSigner.findUnique({
    where: { tokenHash: signatureTokenHash(value) },
    include: {
      fields: { orderBy: [{ pageNumber: 'asc' }, { createdAt: 'asc' }] },
      document: {
        include: {
          signers: { select: { id: true, status: true, isRequired: true } }
        }
      }
    }
  });
}

export async function renewInvite(client, document, signer, expiresAt, {
  actorUserId = null,
  tokenFactory = signatureTokenData,
  now = new Date()
} = {}) {
  if (!signer || signer.documentId !== document.id) throw httpError('Assinante não encontrado.', 404);
  if (signer.status === 'ASSINADO' || signer.status === 'REVOGADO') {
    throw httpError('Este convite não pode ser renovado.', 409);
  }
  const tokenData = tokenFactory();
  const { token, ...persistedTokenData } = tokenData;
  const update = await client.signatureDocumentSigner.updateMany({
    where: {
      id: signer.id,
      documentId: document.id,
      status: { in: ['PENDENTE', 'VISUALIZADO', 'EXPIRADO'] },
      tokenHash: signer.tokenHash
    },
    data: {
      status: 'PENDENTE',
      ...persistedTokenData,
      tokenExpiresAt: expiresAt,
      renewalCount: { increment: 1 },
      invalidationReason: null,
      viewedAt: null,
      expiredAt: null,
      emailStatus: signer.email ? 'PENDENTE' : 'NAO_APLICAVEL',
      emailAttempts: 0,
      emailSentAt: null,
      emailLastError: null,
      emailClaimedAt: null,
      revokedAt: null
    }
  });
  if (update.count !== 1) throw httpError('O convite foi alterado por outra operação. Atualize a página.', 409);
  const renewed = { ...signer, ...persistedTokenData, status: 'PENDENTE', tokenExpiresAt: expiresAt };
  await recordDocumentEvent(client, {
    document,
    signer: renewed,
    actorUserId,
    action: 'CONVITE_RENOVADO',
    description: `Convite renovado para ${signer.name}.`
  });
  return { signer: renewed, url: inviteUrl(token), expiresAt, renewedAt: now };
}

export async function revokeInvite(client, document, signer, {
  actorUserId = null,
  reason = 'MANUAL',
  now = new Date()
} = {}) {
  if (!signer || signer.documentId !== document.id) throw httpError('Assinante não encontrado.', 404);
  if (signer.status === 'ASSINADO') throw httpError('Uma assinatura já registrada não pode ser revogada.', 409);
  if (signer.status === 'REVOGADO') return signer;
  const update = await client.signatureDocumentSigner.updateMany({
    where: {
      id: signer.id,
      documentId: document.id,
      status: { in: ['PENDENTE', 'VISUALIZADO', 'EXPIRADO'] },
      tokenHash: signer.tokenHash
    },
    data: {
      status: 'REVOGADO',
      tokenHash: null,
      tokenEncrypted: null,
      tokenIv: null,
      tokenAuthTag: null,
      tokenExpiresAt: null,
      invalidationReason: reason,
      revokedAt: now,
      emailStatus: signer.email ? 'FALHOU' : 'NAO_APLICAVEL',
      emailClaimedAt: null,
      emailLastError: signer.email ? 'Convite revogado; nenhum novo envio será feito.' : null
    }
  });
  if (update.count !== 1) throw httpError('O convite foi alterado por outra operação. Atualize a página.', 409);
  const revoked = { ...signer, status: 'REVOGADO', tokenHash: null, invalidationReason: reason, revokedAt: now };
  await recordDocumentEvent(client, {
    document,
    signer: revoked,
    actorUserId,
    action: 'CONVITE_REVOGADO',
    description: `Convite revogado para ${signer.name}.`
  });
  return revoked;
}

export async function revokeAllPending(client, document, reason, {
  actorUserId = null,
  now = new Date()
} = {}) {
  const signers = (document.signers || []).filter(signer => ['PENDENTE', 'VISUALIZADO', 'EXPIRADO'].includes(signer.status));
  const revoked = [];
  for (const signer of signers) {
    revoked.push(await revokeInvite(client, document, signer, { actorUserId, reason, now }));
  }
  return revoked;
}

export async function expireOverdueInvites(client, { now = new Date(), limit = 100 } = {}) {
  const candidates = await client.signatureDocumentSigner.findMany({
    where: {
      status: { in: ['PENDENTE', 'VISUALIZADO'] },
      tokenExpiresAt: { lte: now },
      tokenHash: { not: null }
    },
    include: { document: true },
    orderBy: { tokenExpiresAt: 'asc' },
    take: limit
  });
  let expired = 0;
  for (const signer of candidates) {
    const result = await client.signatureDocumentSigner.updateMany({
      where: {
        id: signer.id,
        status: { in: ['PENDENTE', 'VISUALIZADO'] },
        tokenExpiresAt: { lte: now }
      },
      data: { status: 'EXPIRADO', expiredAt: now }
    });
    if (result.count !== 1) continue;
    expired += 1;
    await recordDocumentEvent(client, {
      document: signer.document,
      signer,
      action: 'CONVITE_EXPIRADO',
      description: `Convite expirado para ${signer.name}.`
    });
  }
  return { found: candidates.length, expired };
}

export async function reissueInviteAfterDelete(client, document, signer, expiresAt, {
  actorUserId = null,
  tokenFactory = signatureTokenData
} = {}) {
  const tokenData = tokenFactory();
  const { token, ...persistedTokenData } = tokenData;
  const update = await client.signatureDocumentSigner.updateMany({
    where: {
      id: signer.id,
      documentId: document.id,
      status: 'REVOGADO',
      invalidationReason: 'DOCUMENTO_EXCLUIDO'
    },
    data: {
      status: 'PENDENTE',
      ...persistedTokenData,
      tokenExpiresAt: expiresAt,
      invalidationReason: null,
      revokedAt: null,
      expiredAt: null,
      viewedAt: null,
      emailStatus: signer.email ? 'PENDENTE' : 'NAO_APLICAVEL',
      emailAttempts: 0,
      emailSentAt: null,
      emailLastError: null,
      emailClaimedAt: null
    }
  });
  if (update.count !== 1) return null;
  await recordDocumentEvent(client, {
    document,
    signer,
    actorUserId,
    action: 'CONVITE_RENOVADO',
    description: `Novo convite emitido para ${signer.name} após desfazer a exclusão.`
  });
  return {
    signerId: signer.id,
    expiresAt,
    hasEmail: Boolean(signer.email),
    url: inviteUrl(token)
  };
}
