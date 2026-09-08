import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import { requireAssinaturasAccess, documentForOwnerOrThrow } from '../../lib/assinaturas/access.js';
import { createDocument, finalPdfBuffer, sourcePdfBuffer } from '../../lib/assinaturas/document.js';
import {
  recoverInviteLink,
  renewInvite,
  resolveInviteByToken,
  revokeInvite
} from '../../lib/assinaturas/invites.js';
import { resendInviteEmail, sendInviteEmail } from '../../lib/assinaturas/notifications.js';
import { renderPage } from '../../lib/assinaturas/preview.js';
import {
  archiveDocument,
  cancelDocument,
  getDocument,
  listAudit,
  listDocuments,
  publicationExpiresAt,
  publishDocument,
  renameDocument,
  replaceFields,
  replaceSigners,
  restoreArchivedDocument,
  restoreDeletedDocument,
  softDeleteDocument,
  unpublishDocument,
  validateByCode
} from '../../lib/assinaturas/service.js';
import {
  assertInviteUsable,
  confirmSignature,
  loadInvite,
  tokenFromSignatureHeader
} from '../../lib/assinaturas/signing.js';
import { inlineContentDisposition } from '../../lib/documents/storage.js';
import prisma from '../../lib/prisma.js';
import { createMemoryRateLimit } from '../../lib/rate-limit.js';
import { signatureEvidenceFromRequest } from '../../lib/signatures/common.js';
import { requireAuth } from '../../middleware/auth.js';

const router = Router();
const publicSignatureLimiter = createMemoryRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: 'Muitas tentativas. Tente novamente mais tarde.'
});

const uploadSchema = z.strictObject({
  fileName: z.string().trim().min(1).max(255),
  pdfDataUrl: z.string().min(1),
  title: z.string().trim().min(1).max(180).optional()
});
const renameSchema = z.strictObject({ title: z.string().trim().min(1).max(180) });
const signerSchema = z.array(z.strictObject({
  id: z.string().trim().min(1).optional(),
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().email().optional().nullable().or(z.literal('')),
  position: z.number().int().positive()
}));
const fieldSchema = z.array(z.strictObject({
  signerId: z.string().trim().min(1),
  pageNumber: z.number().int().positive(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0.02).max(1),
  height: z.number().min(0.02).max(1)
}));
const publishSchema = z.union([
  z.strictObject({ expiresInDays: z.number().int().positive() }),
  z.strictObject({ expiresAt: z.string().datetime() })
]);
const publicSignSchema = z.strictObject({
  signerName: z.string().trim().min(2).max(160),
  signatureImageDataUrl: z.string().trim().min(1).max(750_000),
  privacyNoticeAccepted: z.boolean(),
  privacyNoticeVersion: z.string().trim().min(1)
});
const cancelSchema = z.strictObject({ reason: z.string().trim().max(500).optional() });

function publicHeaders(_req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
}

function ownerId(req) {
  return req.auth?.user?.id;
}

function invitationToken(req) {
  const token = tokenFromSignatureHeader(req);
  if (token) return token;
  const error = new Error('Link de assinatura inválido.');
  error.statusCode = 404;
  throw error;
}

// Rotas públicas: o segredo existe somente em X-Signature-Token.
router.get('/publico', publicSignatureLimiter, publicHeaders, asyncHandler(async (req, res) => {
  const payload = await loadInvite(prisma, invitationToken(req), signatureEvidenceFromRequest(req));
  return res.json(payload);
}));

router.get('/publico/pdf', publicSignatureLimiter, publicHeaders, asyncHandler(async (req, res) => {
  const invite = await resolveInviteByToken(prisma, invitationToken(req));
  assertInviteUsable(invite);
  let bytes;
  let fileName = invite.document.originalFileName;
  if (invite.document.status === 'FINALIZANDO') {
    const error = new Error('O documento está sendo finalizado.');
    error.statusCode = 409;
    error.code = 'DOCUMENT_FINALIZING';
    throw error;
  }
  if (invite.document.status === 'CONCLUIDO') {
    if (invite.status !== 'ASSINADO') {
      const error = new Error('O PDF final não está disponível para este convite.');
      error.statusCode = 409;
      throw error;
    }
    bytes = await finalPdfBuffer(invite.document);
    fileName = fileName.replace(/\.pdf$/i, '') + '-assinado.pdf';
  } else {
    bytes = await sourcePdfBuffer(invite.document);
  }
  res.type('application/pdf');
  res.setHeader('Content-Disposition', inlineContentDisposition(fileName));
  return res.send(bytes);
}));

router.get('/publico/paginas/:n.png', publicSignatureLimiter, publicHeaders, asyncHandler(async (req, res) => {
  const invite = await resolveInviteByToken(prisma, invitationToken(req));
  assertInviteUsable(invite);
  const png = await renderPage(invite.document, req.params.n);
  res.type('image/png');
  return res.send(png);
}));

router.post('/publico/assinar', publicSignatureLimiter, publicHeaders, asyncHandler(async (req, res) => {
  const body = publicSignSchema.parse(req.body);
  const result = await confirmSignature(prisma, invitationToken(req), body, signatureEvidenceFromRequest(req));
  return res.json(result);
}));

router.get('/validar/:code', publicSignatureLimiter, publicHeaders, asyncHandler(async (req, res) => {
  const payload = await validateByCode(prisma, req.params.code);
  if (!payload) {
    const error = new Error('Código de validação inválido.');
    error.statusCode = 404;
    throw error;
  }
  return res.json(payload);
}));

router.use(requireAuth, requireAssinaturasAccess);

router.get('/documentos', asyncHandler(async (req, res) => {
  const result = await listDocuments(prisma, ownerId(req), {
    status: req.query.status,
    q: req.query.q,
    archived: req.query.arquivados === '1',
    cursor: req.query.cursor,
    limit: req.query.limit
  });
  return res.json(result);
}));

router.post('/documentos', asyncHandler(async (req, res) => {
  const body = uploadSchema.parse(req.body);
  const document = await createDocument(prisma, {
    ownerUserId: ownerId(req),
    requesterNameSnapshot: req.auth?.user?.name,
    fileName: body.fileName,
    pdfDataUrl: body.pdfDataUrl,
    title: body.title
  });
  return res.status(201).json(document);
}));

router.get('/documentos/:id', asyncHandler(async (req, res) => {
  return res.json(await getDocument(prisma, req.params.id, ownerId(req)));
}));

router.get('/documentos/:id/pdf', asyncHandler(async (req, res) => {
  const document = await documentForOwnerOrThrow(prisma, req.params.id, ownerId(req));
  const bytes = await sourcePdfBuffer(document);
  res.setHeader('Cache-Control', 'no-store');
  res.type('application/pdf');
  res.setHeader('Content-Disposition', inlineContentDisposition(document.originalFileName));
  return res.send(bytes);
}));

router.get('/documentos/:id/pdf-final', asyncHandler(async (req, res) => {
  const document = await documentForOwnerOrThrow(prisma, req.params.id, ownerId(req));
  const bytes = await finalPdfBuffer(document);
  res.setHeader('Cache-Control', 'no-store');
  res.type('application/pdf');
  res.setHeader('Content-Disposition', inlineContentDisposition(`${document.title}-assinado.pdf`));
  return res.send(bytes);
}));

router.get('/documentos/:id/paginas/:n.png', asyncHandler(async (req, res) => {
  const document = await documentForOwnerOrThrow(prisma, req.params.id, ownerId(req));
  const png = await renderPage(document, req.params.n);
  res.setHeader('Cache-Control', 'private, no-store');
  res.type('image/png');
  return res.send(png);
}));

router.patch('/documentos/:id', asyncHandler(async (req, res) => {
  const body = renameSchema.parse(req.body);
  const document = await documentForOwnerOrThrow(prisma, req.params.id, ownerId(req));
  return res.json(await renameDocument(prisma, document, body.title, ownerId(req)));
}));

router.put('/documentos/:id/assinantes', asyncHandler(async (req, res) => {
  const body = signerSchema.parse(req.body);
  const document = await documentForOwnerOrThrow(prisma, req.params.id, ownerId(req));
  return res.json(await replaceSigners(prisma, document, body, ownerId(req)));
}));

router.put('/documentos/:id/campos', asyncHandler(async (req, res) => {
  const body = fieldSchema.parse(req.body);
  const document = await documentForOwnerOrThrow(prisma, req.params.id, ownerId(req), {
    include: { signers: true }
  });
  return res.json(await replaceFields(prisma, document, body, ownerId(req)));
}));

router.post('/documentos/:id/publicar', asyncHandler(async (req, res) => {
  return res.json(await publishDocument(prisma, req.params.id, ownerId(req), publishSchema.parse(req.body)));
}));

router.post('/documentos/:id/despublicar', asyncHandler(async (req, res) => {
  return res.json(await unpublishDocument(prisma, req.params.id, ownerId(req)));
}));

router.get('/documentos/:id/assinantes/:signerId/link', asyncHandler(async (req, res) => {
  const document = await documentForOwnerOrThrow(prisma, req.params.id, ownerId(req), {
    include: { signers: true }
  });
  const signer = document.signers.find(item => item.id === req.params.signerId);
  if (!signer) {
    const error = new Error('Assinante não encontrado.');
    error.statusCode = 404;
    throw error;
  }
  return res.json(await recoverInviteLink(prisma, document, signer, ownerId(req)));
}));

router.post('/documentos/:id/assinantes/:signerId/renovar', asyncHandler(async (req, res) => {
  const expiry = publishSchema.parse(req.body);
  const result = await prisma.$transaction(async tx => {
    const document = await documentForOwnerOrThrow(tx, req.params.id, ownerId(req), { include: { signers: true } });
    const signer = document.signers.find(item => item.id === req.params.signerId);
    if (!signer) {
      const error = new Error('Assinante não encontrado.');
      error.statusCode = 404;
      throw error;
    }
    return renewInvite(tx, document, signer, publicationExpiresAt(expiry), { actorUserId: ownerId(req) });
  });
  if (result.signer.email) {
    await sendInviteEmail(prisma, result.signer.id).catch(() => {});
  }
  return res.json({ url: result.url, expiresAt: result.expiresAt });
}));

router.post('/documentos/:id/assinantes/:signerId/revogar', asyncHandler(async (req, res) => {
  const result = await prisma.$transaction(async tx => {
    const document = await documentForOwnerOrThrow(tx, req.params.id, ownerId(req), { include: { signers: true } });
    const signer = document.signers.find(item => item.id === req.params.signerId);
    if (!signer) {
      const error = new Error('Assinante não encontrado.');
      error.statusCode = 404;
      throw error;
    }
    return revokeInvite(tx, document, signer, { actorUserId: ownerId(req) });
  });
  return res.json({ id: result.id, status: result.status, revokedAt: result.revokedAt });
}));

router.post('/documentos/:id/assinantes/:signerId/reenviar-email', asyncHandler(async (req, res) => {
  const document = await documentForOwnerOrThrow(prisma, req.params.id, ownerId(req), { include: { signers: true } });
  const signer = document.signers.find(item => item.id === req.params.signerId);
  if (!signer) {
    const error = new Error('Assinante não encontrado.');
    error.statusCode = 404;
    throw error;
  }
  return res.json(await resendInviteEmail(prisma, document, signer));
}));

router.get('/documentos/:id/auditoria', asyncHandler(async (req, res) => {
  return res.json(await listAudit(prisma, req.params.id, ownerId(req), {
    cursor: req.query.cursor,
    limit: req.query.limit
  }));
}));

router.post('/documentos/:id/cancelar', asyncHandler(async (req, res) => {
  const body = cancelSchema.parse(req.body || {});
  return res.json(await cancelDocument(prisma, req.params.id, ownerId(req), body.reason));
}));

router.post('/documentos/:id/arquivar', asyncHandler(async (req, res) => {
  return res.json(await archiveDocument(prisma, req.params.id, ownerId(req)));
}));

router.post('/documentos/:id/restaurar', asyncHandler(async (req, res) => {
  return res.json(await restoreArchivedDocument(prisma, req.params.id, ownerId(req)));
}));

router.delete('/documentos/:id', asyncHandler(async (req, res) => {
  await softDeleteDocument(prisma, req.params.id, ownerId(req));
  return res.status(204).end();
}));

router.post('/documentos/:id/restaurar-excluido', asyncHandler(async (req, res) => {
  return res.json(await restoreDeletedDocument(prisma, req.params.id, ownerId(req)));
}));

export default router;
