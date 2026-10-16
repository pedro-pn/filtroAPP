import {
  SIGNATURE_AVULSA_NOTICE_VERSION,
  validatePrivacyNoticeAcknowledgement
} from '../privacy-consent.js';
import { decodableSignatureImageDataUrl } from '../signatures/common.js';
import { recordDocumentEvent } from './audit.js';
import { MAX_SIGNATURE_IMAGE_BYTES } from './image-limits.js';
import { beginDocumentFinalization, scheduleDocumentFinalization } from './finalization.js';
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
  if (invite.members) {
    for (const member of invite.members) assertInviteUsable({ ...member, tokenHash: invite.tokenHash }, now);
  }
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
  if (invite.members) {
    const documents = invite.members.map(member => {
      const payload = publicInvitePayload(member);
      return { ...payload.document, id: member.document.id, pageDimensions: member.document.pageDimensions,
        fields: payload.fields, signerStatus: member.status, downloadAvailable: payload.downloadAvailable };
    });
    const status = documents.some(document => document.status === 'FINALIZANDO') ? 'FINALIZANDO'
      : documents.every(document => document.status === 'CONCLUIDO') ? 'CONCLUIDO' : 'AGUARDANDO_ASSINATURAS';
    return {
      ...publicInvitePayload({ ...invite, members: undefined }), documents,
      document: { ...documents[0], title: documents.length > 1 ? `Assinatura de ${documents.length} documentos` : documents[0].title,
        originalFileName: documents.length > 1 ? `${documents.length} PDFs separados` : documents[0].originalFileName,
        pageCount: documents.reduce((sum, document) => sum + document.pageCount, 0), status,
        progress: documents.reduce((sum, document) => ({ signed: sum.signed + document.progress.signed, total: sum.total + document.progress.total }), { signed: 0, total: 0 }) },
      downloadAvailable: documents.some(document => document.downloadAvailable)
    };
  }
  const signers = (Array.isArray(invite.document?.signers) ? invite.document.signers : []).filter(signer => signer.status !== 'REVOGADO');
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
  if (invite?.members) {
    for (const member of invite.members) {
      if (new Date(member.tokenExpiresAt).getTime() <= now.getTime()) await expireInvite(client, member, now, evidence);
    }
    assertInviteUsable(invite, now);
    for (const member of invite.members) {
      if (member.status !== 'PENDENTE') continue;
      const viewed = await client.signatureDocumentSigner.updateMany({ where: { id: member.id, status: 'PENDENTE' }, data: { status: 'VISUALIZADO', viewedAt: now } });
      if (viewed.count === 1) {
        await recordDocumentEvent(client, { document: member.document, signer: member, action: 'LINK_ACESSADO', description: `Convite agrupado acessado por ${member.name}.`, evidence });
        await recordDocumentEvent(client, { document: member.document, signer: member, action: 'DOCUMENTO_VISUALIZADO', description: `Documento disponibilizado no convite de ${member.name}.`, evidence });
      }
    }
    return publicInvitePayload(await resolveInviteByToken(client, token));
  }
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

export async function confirmSignature(client, token, input, evidence = {}, dependencies = {}) {
  const signerName = String(input?.signerName || '').trim();
  if (signerName.length < 2 || signerName.length > 160) {
    throw httpError('Informe o nome completo do assinante.', 400);
  }
  const privacyError = validatePrivacyNoticeAcknowledgement(input, SIGNATURE_AVULSA_NOTICE_VERSION);
  if (privacyError) throw httpError(privacyError, 400);
  const signatureImage = await decodableSignatureImageDataUrl(input?.signatureImageDataUrl, {
    maxBytes: MAX_SIGNATURE_IMAGE_BYTES
  });
  if (!signatureImage) throw httpError('Assinatura visual inválida.', 400);

  const now = dependencies.now || new Date();
  const preflight = await resolveInviteByToken(client, token);
  assertInviteUsable(preflight, now);
  if (preflight.members) return confirmGroupedSignature(client, token, input, evidence, { ...dependencies, now });
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

    let documentStatus = invite.document.status;
    transitionedToFinalizing = await beginDocumentFinalization(tx, invite.document, { now });
    if (transitionedToFinalizing) {
      documentStatus = 'FINALIZANDO';
    }
    return {
      success: true,
      documentStatus,
      downloadAvailable: documentStatus === 'CONCLUIDO',
      signer: { name: invite.name, status: 'ASSINADO', signedAt }
    };
  });

  if (transitionedToFinalizing) {
    scheduleDocumentFinalization(client, preflight.document.id, dependencies);
  }
  return result;
}

export function inviteDocumentOrThrow(invite, documentId) {
  const member = invite?.members
    ? invite.members.find(item => item.documentId === documentId)
    : (!documentId || invite?.documentId === documentId) ? invite : null;
  if (!member) throw httpError('Documento não encontrado neste convite.', 404);
  return { ...member, tokenHash: invite.tokenHash, tokenExpiresAt: invite.tokenExpiresAt };
}

async function confirmGroupedSignature(client, token, input, evidence, dependencies) {
  const { now } = dependencies;
  const outcome = await client.$transaction(async tx => {
    const initial = await resolveInviteByToken(tx, token);
    if (!initial?.members) throw httpError('Link de assinatura inválido.', 404);
    const locked = await tx.signatureInviteGroup.updateMany({ where: { id: initial.groupInviteId, tokenHash: initial.tokenHash }, data: { updatedAt: now } });
    if (locked.count !== 1) throw httpError('Este convite foi alterado. Atualize a página.', 409);
    const invite = await resolveInviteByToken(tx, token);
    assertInviteUsable(invite, now);
    const finalizingIds = [];
    // Ordem estável também para assinantes concorrentes em conjuntos sobrepostos.
    for (const member of [...invite.members].sort((a, b) => a.documentId.localeCompare(b.documentId))) {
      if (member.status === 'ASSINADO') continue;
      const updated = await tx.signatureDocumentSigner.updateMany({ where: {
        id: member.id, groupInviteId: invite.groupInviteId, status: { in: ['PENDENTE', 'VISUALIZADO'] },
        document: { status: 'AGUARDANDO_ASSINATURAS', deletedAt: null }
      }, data: {
        status: 'ASSINADO', declaredSignerName: String(input.signerName).trim(), signatureImageDataUrl: input.signatureImageDataUrl,
        ipAddress: evidence.ipAddress || null, userAgent: evidence.userAgent || null,
        privacyNoticeAcceptedAt: now, privacyNoticeVersion: SIGNATURE_AVULSA_NOTICE_VERSION, signedAt: now
      } });
      if (updated.count !== 1) throw httpError('Um dos documentos foi alterado. Atualize a página antes de assinar.', 409);
      await recordDocumentEvent(tx, { document: member.document, signer: member, action: 'ASSINATURA_REALIZADA', description: `Assinatura única registrada para ${member.name} nos documentos do convite.`, evidence });
      if (await beginDocumentFinalization(tx, member.document, { now })) finalizingIds.push(member.documentId);
    }
    const current = await resolveInviteByToken(tx, token);
    const payload = publicInvitePayload(current);
    return { finalizingIds, result: { success: true, documentStatus: payload.document.status, downloadAvailable: payload.downloadAvailable, signer: payload.signer } };
  }, { timeout: 120_000 });
  for (const id of outcome.finalizingIds) scheduleDocumentFinalization(client, id, dependencies);
  return outcome.result;
}
