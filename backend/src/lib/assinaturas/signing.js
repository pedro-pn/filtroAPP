import {
  SIGNATURE_AVULSA_NOTICE_VERSION,
  validatePrivacyNoticeAcknowledgement
} from '../privacy-consent.js';
import { decodableSignatureImageDataUrl } from '../signatures/common.js';
import { recordDocumentEvent } from './audit.js';
import { resolveInviteByToken } from './invites.js';

function httpError(message, statusCode, code) {
  const error = new Error(message);
  error.status = statusCode;
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

export function tokenFromSignatureHeader(req) {
  const value = String(req?.headers?.['x-signature-token'] || '').trim();
  return /^[a-f0-9]{64}$/i.test(value) ? value : '';
}

export function assertInviteUsable(invite, now = new Date(), { allowSigned = true } = {}) {
  if (!invite || !invite.tokenHash || invite.status === 'REVOGADO') {
    throw httpError('Link de assinatura inválido.', 404);
  }
  if (invite.document?.deletedAt || invite.document?.status === 'CANCELADO') {
    throw httpError('Este documento não está mais disponível para assinatura.', 410);
  }
  if (!invite.tokenExpiresAt || new Date(invite.tokenExpiresAt).getTime() <= now.getTime()) {
    throw httpError('Este link de assinatura expirou.', 410);
  }
  if (invite.status === 'EXPIRADO') throw httpError('Este link de assinatura expirou.', 410);
  if (invite.status === 'ASSINADO' && allowSigned) return invite;
  if (!['PENDENTE', 'VISUALIZADO'].includes(invite.status)) {
    throw httpError('Este convite não pode mais ser assinado.', 409);
  }
  if (!['AGUARDANDO_ASSINATURAS', 'FINALIZANDO', 'CONCLUIDO'].includes(invite.document?.status)) {
    throw httpError('Este documento não está disponível para assinatura.', 409);
  }
  return invite;
}

function numericField(field) {
  return {
    pageNumber: field.pageNumber,
    x: Number(field.x),
    y: Number(field.y),
    width: Number(field.width),
    height: Number(field.height)
  };
}

export function publicInvitePayload(invite) {
  const signers = Array.isArray(invite.document?.signers) ? invite.document.signers : [];
  const signed = signers.filter(signer => signer.status === 'ASSINADO').length;
  const documentStatus = invite.document.status;
  return {
    status: invite.status === 'ASSINADO' ? 'ASSINADO' : 'ATIVO',
    expiresAt: invite.tokenExpiresAt,
    document: {
      title: invite.document.title,
      originalFileName: invite.document.originalFileName,
      pageCount: invite.document.pageCount,
      status: documentStatus,
      sourceDocumentHash: invite.document.sourceDocumentHash,
      requestedBy: invite.document.requesterNameSnapshot,
      progress: { signed, total: signers.length }
    },
    signer: {
      name: invite.name,
      status: invite.status,
      signedAt: invite.signedAt || null
    },
    fields: (invite.fields || []).map(numericField),
    downloadAvailable: documentStatus === 'CONCLUIDO' && invite.status === 'ASSINADO'
  };
}

async function expireInvite(client, invite, now, evidence) {
  const result = await client.signatureDocumentSigner.updateMany({
    where: {
      id: invite.id,
      status: { in: ['PENDENTE', 'VISUALIZADO'] },
      tokenExpiresAt: { lte: now }
    },
    data: { status: 'EXPIRADO', expiredAt: now }
  });
  if (result.count === 1) {
    await recordDocumentEvent(client, {
      document: invite.document,
      signer: invite,
      action: 'CONVITE_EXPIRADO',
      description: `Convite de ${invite.name} expirado.`,
      evidence
    });
  }
}

export async function loadInvite(client, token, evidence = {}, { now = new Date() } = {}) {
  let invite = await resolveInviteByToken(client, token);
  if (invite?.tokenExpiresAt && new Date(invite.tokenExpiresAt).getTime() <= now.getTime()) {
    await expireInvite(client, invite, now, evidence);
    invite = { ...invite, status: 'EXPIRADO', expiredAt: now };
  }
  assertInviteUsable(invite, now);
  if (invite.status === 'PENDENTE') {
    const viewed = await client.signatureDocumentSigner.updateMany({
      where: { id: invite.id, status: 'PENDENTE' },
      data: { status: 'VISUALIZADO', viewedAt: now }
    });
    if (viewed.count === 1) {
      invite = { ...invite, status: 'VISUALIZADO', viewedAt: now };
      await recordDocumentEvent(client, {
        document: invite.document,
        signer: invite,
        action: 'LINK_ACESSADO',
        description: `Link acessado por ${invite.name}.`,
        evidence
      });
      await recordDocumentEvent(client, {
        document: invite.document,
        signer: invite,
        action: 'DOCUMENTO_VISUALIZADO',
        description: `Documento visualizado por ${invite.name}.`,
        evidence
      });
    }
  }
  return publicInvitePayload(invite);
}

async function advisoryDocumentLock(tx, documentId) {
  if (typeof tx.$queryRawUnsafe === 'function') {
    await tx.$queryRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1), 0)::text AS lock_result',
      documentId
    );
  }
}

export async function confirmSignature(client, token, input, evidence = {}, dependencies = {}) {
  const signerName = String(input?.signerName || '').trim();
  if (signerName.length < 2 || signerName.length > 160) {
    throw httpError('Informe o nome completo do assinante.', 400);
  }
  const privacyError = validatePrivacyNoticeAcknowledgement(input, SIGNATURE_AVULSA_NOTICE_VERSION);
  if (privacyError) throw httpError(privacyError, 400);
  const signatureImage = await decodableSignatureImageDataUrl(input?.signatureImageDataUrl);
  if (!signatureImage) throw httpError('Assinatura visual inválida.', 400);

  const now = dependencies.now || new Date();
  const preflight = await resolveInviteByToken(client, token);
  assertInviteUsable(preflight, now);
  let transitionedToFinalizing = false;
  const result = await client.$transaction(async tx => {
    const invite = await resolveInviteByToken(tx, token);
    if (invite?.status === 'ASSINADO') {
      assertInviteUsable(invite, now);
      return {
        success: true,
        documentStatus: invite.document.status,
        downloadAvailable: invite.document.status === 'CONCLUIDO',
        signer: { name: invite.name, status: invite.status, signedAt: invite.signedAt }
      };
    }
    assertInviteUsable(invite, now, { allowSigned: false });
    const signedAt = now;
    const update = await tx.signatureDocumentSigner.updateMany({
      where: { id: invite.id, status: { in: ['PENDENTE', 'VISUALIZADO'] } },
      data: {
        status: 'ASSINADO',
        declaredSignerName: signerName,
        signatureImageDataUrl: input.signatureImageDataUrl,
        ipAddress: evidence.ipAddress || null,
        userAgent: evidence.userAgent || null,
        privacyNoticeAcceptedAt: now,
        privacyNoticeVersion: SIGNATURE_AVULSA_NOTICE_VERSION,
        signedAt
      }
    });
    if (update.count !== 1) {
      const current = await tx.signatureDocumentSigner.findUnique({
        where: { id: invite.id },
        include: { document: true }
      });
      if (current?.status === 'ASSINADO') {
        return {
          success: true,
          documentStatus: current.document.status,
          downloadAvailable: current.document.status === 'CONCLUIDO',
          signer: { name: current.name, status: current.status, signedAt: current.signedAt }
        };
      }
      throw httpError('Este convite não pode mais ser assinado.', 409);
    }
    await recordDocumentEvent(tx, {
      document: invite.document,
      signer: invite,
      action: 'ASSINATURA_REALIZADA',
      description: `Assinatura registrada para ${invite.name}.`,
      evidence
    });

    await advisoryDocumentLock(tx, invite.document.id);
    const remaining = await tx.signatureDocumentSigner.count({
      where: {
        documentId: invite.document.id,
        isRequired: true,
        status: { not: 'ASSINADO' }
      }
    });
    let documentStatus = invite.document.status;
    if (remaining === 0) {
      const transition = await tx.signatureDocument.updateMany({
        where: { id: invite.document.id, status: 'AGUARDANDO_ASSINATURAS' },
        data: {
          status: 'FINALIZANDO',
          finalizationClaimedAt: null,
          finalizationNextAttemptAt: now,
          finalizationLastError: null
        }
      });
      if (transition.count === 1) {
        transitionedToFinalizing = true;
        documentStatus = 'FINALIZANDO';
        await recordDocumentEvent(tx, {
          document: invite.document,
          action: 'FINALIZACAO_INICIADA',
          description: 'Todas as assinaturas foram recebidas; finalização iniciada.'
        });
      }
    }
    return {
      success: true,
      documentStatus,
      downloadAvailable: documentStatus === 'CONCLUIDO',
      signer: { name: invite.name, status: 'ASSINADO', signedAt }
    };
  });

  if (transitionedToFinalizing) {
    try {
      const finalize = dependencies.processFinalization
        || (await import('./jobs.js')).processDocumentFinalization;
      await finalize(client, preflight.document.id);
      const current = await client.signatureDocument.findUnique({ where: { id: preflight.document.id } });
      if (current?.status) {
        result.documentStatus = current.status;
        result.downloadAvailable = current.status === 'CONCLUIDO';
      }
    } catch {
      // O job durável retoma a finalização; a assinatura já foi aceita.
    }
  }
  return result;
}
