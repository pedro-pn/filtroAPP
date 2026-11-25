import { raw, Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import { requireAssinaturasAccess, documentForAccessOrThrow, documentForOwnerOrThrow } from '../../lib/assinaturas/access.js';
import { listDocumentShares, removeDocumentShare, saveDocumentShare, sharingUsers } from '../../lib/assinaturas/sharing.js';
import { createDocument, finalPdfBuffer, sourcePdfBuffer } from '../../lib/assinaturas/document.js';
import { batchInviteAction, createBatch, getBatch, publishBatch, saveBatch } from '../../lib/assinaturas/batch.js';
import env from '../../config/env.js';
import { MAX_SIGNATURE_IMAGE_DATA_URL_LENGTH } from '../../lib/assinaturas/image-limits.js';
import {
  recoverInviteLink,
  renewInvite,
  resolveInviteByToken
} from '../../lib/assinaturas/invites.js';
import { resendInviteEmail, sendInviteEmail } from '../../lib/assinaturas/notifications.js';
import { renderPage, renderSignedPage } from '../../lib/assinaturas/preview.js';
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
  revokeDocumentInvite,
  softDeleteDocument,
  unpublishDocument,
  validateByCode
} from '../../lib/assinaturas/service.js';
import {
  assertInviteUsable,
  inviteDocumentOrThrow,
  confirmSignature,
  loadInvite,
  tokenFromSignatureHeader
} from '../../lib/assinaturas/signing.js';
import { inlineContentDisposition } from '../../lib/documents/storage.js';
import prisma from '../../lib/prisma.js';
import { createMemoryRateLimit, expensiveRouteLimit } from '../../lib/rate-limit.js';
import { signatureEvidenceFromRequest } from '../../lib/signatures/common.js';
import { requireAuth } from '../../middleware/auth.js';

import { defineRoute } from '../../lib/api-contract/registry.js';
import { opsRoute, EMPTY, FILE, jsonResponseSchema, libValidatedBodySchema } from '../../lib/api-contract/domains/operacoes.js';
const router = Router();
const publicSignatureLimiter = createMemoryRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: 'Muitas tentativas. Tente novamente mais tarde.'
});

const uploadSchema = z.strictObject({
  fileName: z.string().trim().min(1).max(255),
  pdfDataUrl: z.string().min(1),
  title: z.string().trim().min(1).max(180).optional(),
  batchId: z.string().trim().min(1).optional()
});
const binaryUploadSchema = uploadSchema.omit({ pdfDataUrl: true });
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
  signatureImageDataUrl: z.string().trim().min(1).max(MAX_SIGNATURE_IMAGE_DATA_URL_LENGTH),
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
defineRoute(router, opsRoute('GET /publico', { tag: 'assinaturas', summary: 'Assinaturas avulsas: Abrir documento pelo link do assinante', auth: 'publicToken', responses: { 200: jsonResponseSchema }, errors: [429] }), publicSignatureLimiter, publicHeaders, asyncHandler(async (req, res) => {
  const payload = await loadInvite(prisma, invitationToken(req), signatureEvidenceFromRequest(req));
  return res.json(payload);
}));

defineRoute(router, opsRoute('GET /publico/pdf', { tag: 'assinaturas', summary: 'Assinaturas avulsas: PDF do documento (link do assinante)', auth: 'publicToken', responses: { 200: FILE }, errors: [429] }), publicSignatureLimiter, publicHeaders, asyncHandler(async (req, res) => {
  const resolved = await resolveInviteByToken(prisma, invitationToken(req));
  assertInviteUsable(resolved);
  const invite = inviteDocumentOrThrow(resolved, req.query.documentId);
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

defineRoute(router, opsRoute('GET /publico/paginas/:n.png', { tag: 'assinaturas', summary: 'Assinaturas avulsas: Imagem de uma página (link do assinante)', auth: 'publicToken', responses: { 200: FILE }, errors: [429] }), publicSignatureLimiter, publicHeaders, asyncHandler(async (req, res) => {
  const resolved = await resolveInviteByToken(prisma, invitationToken(req));
  assertInviteUsable(resolved);
  const invite = inviteDocumentOrThrow(resolved, req.query.documentId);
  assertInviteUsable(invite);
  const pageNumber = Number(req.params.n);
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > Number(invite.document.pageCount)) {
    const error = new Error('Página não encontrada.');
    error.statusCode = 404;
    throw error;
  }
  const signedSigners = await prisma.signatureDocumentSigner.findMany({
    where: { documentId: invite.document.id, status: 'ASSINADO' },
    select: {
      id: true,
      signatureImageDataUrl: true,
      fields: { where: { pageNumber }, select: { pageNumber: true, x: true, y: true, width: true, height: true } }
    }
  });
  const png = await renderSignedPage(invite.document, pageNumber, signedSigners);
  res.type('image/png');
  return res.send(png);
}));

defineRoute(router, opsRoute('POST /publico/assinar', { tag: 'assinaturas', summary: 'Assinaturas avulsas: Assinar pelo link do assinante', auth: 'publicToken', body: publicSignSchema, responses: { 200: jsonResponseSchema }, errors: [400, 429] }), publicSignatureLimiter, publicHeaders, asyncHandler(async (req, res) => {
  const body = publicSignSchema.parse(req.body);
  const result = await confirmSignature(prisma, invitationToken(req), body, signatureEvidenceFromRequest(req));
  return res.json(result);
}));

defineRoute(router, opsRoute('GET /validar/:code', { tag: 'assinaturas', summary: 'Assinaturas avulsas: Validar documento assinado pelo código', auth: 'public', responses: { 200: jsonResponseSchema }, errors: [429] }), publicSignatureLimiter, publicHeaders, asyncHandler(async (req, res) => {
  const payload = await validateByCode(prisma, req.params.code);
  if (!payload) {
    const error = new Error('Código de validação inválido.');
    error.statusCode = 404;
    throw error;
  }
  return res.json(payload);
}));

router.use(requireAuth, requireAssinaturasAccess);

defineRoute(router, opsRoute('POST /lotes', { tag: 'assinaturas', summary: 'Assinaturas avulsas: Criar lote de documentos', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 201: jsonResponseSchema }, errors: [401, 403] }), asyncHandler(async (req, res) => {
  return res.status(201).json(await createBatch(prisma, ownerId(req)));
}));

defineRoute(router, opsRoute('GET /lotes/:id', { tag: 'assinaturas', summary: 'Assinaturas avulsas: Consultar lote', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), asyncHandler(async (req, res) => {
  return res.json(await getBatch(prisma, req.params.id, ownerId(req)));
}));

defineRoute(router, opsRoute('PUT /lotes/:id/configuracao', { tag: 'assinaturas', summary: 'Assinaturas avulsas: Configurar lote', body: libValidatedBodySchema, validatedBy: 'handler/serviço (corpo conferido fora do contrato)', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), asyncHandler(async (req, res) => {
  return res.json(await saveBatch(prisma, req.params.id, ownerId(req), req.body));
}));

defineRoute(router, opsRoute('POST /lotes/:id/publicar', { tag: 'assinaturas', summary: 'Assinaturas avulsas: Publicar lote', body: publishSchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), asyncHandler(async (req, res) => {
  return res.json(await publishBatch(prisma, req.params.id, ownerId(req), publishSchema.parse(req.body)));
}));

defineRoute(router, opsRoute('POST /lotes/:id/assinantes/:signerId/:action', { tag: 'assinaturas', summary: 'Assinaturas avulsas: Ação sobre assinante do lote', body: publishSchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), asyncHandler(async (req, res) => {
  const action = z.enum(['link', 'renovar', 'reenviar-email', 'revogar']).parse(req.params.action);
  const expiry = action === 'renovar' ? publishSchema.parse(req.body) : undefined;
  return res.json(await batchInviteAction(prisma, req.params.id, req.params.signerId, ownerId(req), action, expiry));
}));

defineRoute(router, opsRoute('GET /documentos', { tag: 'assinaturas', summary: 'Assinaturas avulsas: Listar documentos', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), asyncHandler(async (req, res) => {
  const result = await listDocuments(prisma, ownerId(req), {
    grouped: req.query.grouped === '1',
    status: req.query.status,
    q: req.query.q,
    dateFrom: req.query.dateFrom,
    dateTo: req.query.dateTo,
    archived: req.query.arquivados === '1',
    cursor: req.query.cursor,
    limit: req.query.limit
  });
  return res.json(result);
}));

defineRoute(router, opsRoute('POST /documentos', { tag: 'assinaturas', summary: 'Assinaturas avulsas: Criar documento', body: uploadSchema, responses: { 201: jsonResponseSchema }, errors: [400, 401, 403] }), raw({ type: 'application/pdf', limit: `${env.assinaturasMaxPdfMb}mb` }), asyncHandler(async (req, res) => {
  const binary = req.is('application/pdf');
  const body = binary ? binaryUploadSchema.parse(req.query) : uploadSchema.parse(req.body);
  const document = await createDocument(prisma, {
    ownerUserId: ownerId(req),
    requesterNameSnapshot: req.auth?.user?.name,
    fileName: body.fileName,
    pdfDataUrl: body.pdfDataUrl,
    ...(binary ? { pdfBytes: req.body } : {}),
    title: body.title,
    batchId: body.batchId
  });
  return res.status(201).json(document);
}));

defineRoute(router, opsRoute('GET /documentos/:id', { tag: 'assinaturas', summary: 'Assinaturas avulsas: Consultar documento', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), asyncHandler(async (req, res) => {
  return res.json(await getDocument(prisma, req.params.id, ownerId(req)));
}));

defineRoute(router, opsRoute('GET /documentos/:id/usuarios-compartilhamento', { tag: 'assinaturas', summary: 'Assinaturas avulsas: Usuários com quem o documento pode ser compartilhado', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), asyncHandler(async (req, res) => {
  return res.json(await sharingUsers(prisma, req.params.id, ownerId(req), req.query.q || ''));
}));

defineRoute(router, opsRoute('GET /documentos/:id/compartilhamentos', { tag: 'assinaturas', summary: 'Assinaturas avulsas: Compartilhamentos do documento', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), asyncHandler(async (req, res) => {
  return res.json(await listDocumentShares(prisma, req.params.id, ownerId(req)));
}));

defineRoute(router, opsRoute('PUT /documentos/:id/compartilhamentos/:userId', { tag: 'assinaturas', summary: 'Assinaturas avulsas: Compartilhar documento com usuário', body: libValidatedBodySchema, validatedBy: 'handler/serviço (corpo conferido fora do contrato)', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), asyncHandler(async (req, res) => {
  const body = z.strictObject({ permission: z.enum(['VIEW', 'EDIT']) }).parse(req.body);
  return res.json(await saveDocumentShare(prisma, req.params.id, ownerId(req), req.params.userId, body.permission));
}));

defineRoute(router, opsRoute('DELETE /documentos/:id/compartilhamentos/:userId', { tag: 'assinaturas', summary: 'Assinaturas avulsas: Remover compartilhamento', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 204: EMPTY }, errors: [401, 403] }), asyncHandler(async (req, res) => {
  await removeDocumentShare(prisma, req.params.id, ownerId(req), req.params.userId);
  return res.status(204).end();
}));

defineRoute(router, opsRoute('GET /documentos/:id/pdf', { tag: 'assinaturas', summary: 'Assinaturas avulsas: PDF original do documento', responses: { 200: FILE }, errors: [401, 403, 429] }), ...expensiveRouteLimit('document'), asyncHandler(async (req, res) => {
  const document = await documentForAccessOrThrow(prisma, req.params.id, ownerId(req));
  const bytes = await sourcePdfBuffer(document);
  res.setHeader('Cache-Control', 'no-store');
  res.type('application/pdf');
  res.setHeader('Content-Disposition', inlineContentDisposition(document.originalFileName));
  return res.send(bytes);
}));

defineRoute(router, opsRoute('GET /documentos/:id/pdf-final', { tag: 'assinaturas', summary: 'Assinaturas avulsas: PDF final assinado', responses: { 200: FILE }, errors: [401, 403, 429] }), ...expensiveRouteLimit('document'), asyncHandler(async (req, res) => {
  const document = await documentForAccessOrThrow(prisma, req.params.id, ownerId(req));
  const bytes = await finalPdfBuffer(document);
  res.setHeader('Cache-Control', 'no-store');
  res.type('application/pdf');
  res.setHeader('Content-Disposition', inlineContentDisposition(`${document.title}-assinado.pdf`));
  return res.send(bytes);
}));

defineRoute(router, opsRoute('GET /documentos/:id/paginas/:n.png', { tag: 'assinaturas', summary: 'Assinaturas avulsas: Imagem de uma página do documento', responses: { 200: FILE }, errors: [401, 403] }), asyncHandler(async (req, res) => {
  const document = await documentForAccessOrThrow(prisma, req.params.id, ownerId(req));
  const png = await renderPage(document, req.params.n);
  res.setHeader('Cache-Control', 'private, no-cache');
  res.type('image/png');
  return res.send(png);
}));

defineRoute(router, opsRoute('PATCH /documentos/:id', { tag: 'assinaturas', summary: 'Assinaturas avulsas: Renomear documento', body: renameSchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), asyncHandler(async (req, res) => {
  const body = renameSchema.parse(req.body);
  const document = await documentForAccessOrThrow(prisma, req.params.id, ownerId(req), { edit: true });
  return res.json(await renameDocument(prisma, document, body.title, ownerId(req)));
}));

defineRoute(router, opsRoute('PUT /documentos/:id/assinantes', { tag: 'assinaturas', summary: 'Assinaturas avulsas: Definir assinantes', body: signerSchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), asyncHandler(async (req, res) => {
  const body = signerSchema.parse(req.body);
  const document = await documentForAccessOrThrow(prisma, req.params.id, ownerId(req), { edit: true });
  if (document.batchId && !document.permissions.isOwner) {
    return res.status(403).json({ error: 'Os assinantes do lote são gerenciados pelo proprietário.' });
  }
  return res.json(await replaceSigners(prisma, document, body, ownerId(req)));
}));

defineRoute(router, opsRoute('PUT /documentos/:id/campos', { tag: 'assinaturas', summary: 'Assinaturas avulsas: Posicionar campos de assinatura', body: fieldSchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), asyncHandler(async (req, res) => {
  const body = fieldSchema.parse(req.body);
  const document = await documentForAccessOrThrow(prisma, req.params.id, ownerId(req), {
    edit: true,
    include: { signers: true }
  });
  return res.json(await replaceFields(prisma, document, body, ownerId(req)));
}));

defineRoute(router, opsRoute('POST /documentos/:id/publicar', { tag: 'assinaturas', summary: 'Assinaturas avulsas: Publicar documento (enviar para assinatura)', body: publishSchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), asyncHandler(async (req, res) => {
  return res.json(await publishDocument(prisma, req.params.id, ownerId(req), publishSchema.parse(req.body)));
}));

defineRoute(router, opsRoute('POST /documentos/:id/despublicar', { tag: 'assinaturas', summary: 'Assinaturas avulsas: Voltar documento para rascunho', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), asyncHandler(async (req, res) => {
  return res.json(await unpublishDocument(prisma, req.params.id, ownerId(req)));
}));

defineRoute(router, opsRoute('GET /documentos/:id/assinantes/:signerId/link', { tag: 'assinaturas', summary: 'Assinaturas avulsas: Link de assinatura do assinante', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), asyncHandler(async (req, res) => {
  const document = await documentForOwnerOrThrow(prisma, req.params.id, ownerId(req), {
    include: { signers: true }
  });
  const signer = document.signers.find(item => item.id === req.params.signerId);
  if (!signer) {
    const error = new Error('Assinante não encontrado.');
    error.statusCode = 404;
    throw error;
  }
  if (document.batchId && signer.batchSignerId) return res.json(await batchInviteAction(prisma, document.batchId, signer.batchSignerId, ownerId(req), 'link'));
  return res.json(await recoverInviteLink(prisma, document, signer, ownerId(req)));
}));

defineRoute(router, opsRoute('POST /documentos/:id/assinantes/:signerId/renovar', { tag: 'assinaturas', summary: 'Assinaturas avulsas: Renovar link do assinante', body: publishSchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), asyncHandler(async (req, res) => {
  const expiry = publishSchema.parse(req.body);
  const result = await prisma.$transaction(async tx => {
    const document = await documentForOwnerOrThrow(tx, req.params.id, ownerId(req), { include: { signers: true } });
    const signer = document.signers.find(item => item.id === req.params.signerId);
    if (!signer) {
      const error = new Error('Assinante não encontrado.');
      error.statusCode = 404;
      throw error;
    }
    if (document.batchId && signer.batchSignerId) return { batchId: document.batchId, batchSignerId: signer.batchSignerId };
    return renewInvite(tx, document, signer, publicationExpiresAt(expiry), { actorUserId: ownerId(req) });
  });
  if (result.batchId) return res.json(await batchInviteAction(prisma, result.batchId, result.batchSignerId, ownerId(req), 'renovar', expiry));
  if (result.signer.email) {
    await sendInviteEmail(prisma, result.signer.id).catch(() => {});
  }
  return res.json({ url: result.url, expiresAt: result.expiresAt });
}));

defineRoute(router, opsRoute('POST /documentos/:id/assinantes/:signerId/revogar', { tag: 'assinaturas', summary: 'Assinaturas avulsas: Revogar link do assinante', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), asyncHandler(async (req, res) => {
  const result = await revokeDocumentInvite(prisma, req.params.id, req.params.signerId, ownerId(req));
  return res.json({ id: result.id, status: result.status, revokedAt: result.revokedAt });
}));

defineRoute(router, opsRoute('POST /documentos/:id/assinantes/:signerId/reenviar-email', { tag: 'assinaturas', summary: 'Assinaturas avulsas: Reenviar e-mail ao assinante', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), asyncHandler(async (req, res) => {
  const document = await documentForOwnerOrThrow(prisma, req.params.id, ownerId(req), { include: { signers: true } });
  const signer = document.signers.find(item => item.id === req.params.signerId);
  if (!signer) {
    const error = new Error('Assinante não encontrado.');
    error.statusCode = 404;
    throw error;
  }
  if (document.batchId && signer.batchSignerId) return res.json(await batchInviteAction(prisma, document.batchId, signer.batchSignerId, ownerId(req), 'reenviar-email'));
  return res.json(await resendInviteEmail(prisma, document, signer));
}));

defineRoute(router, opsRoute('GET /documentos/:id/auditoria', { tag: 'assinaturas', summary: 'Assinaturas avulsas: Trilha de auditoria do documento', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), asyncHandler(async (req, res) => {
  return res.json(await listAudit(prisma, req.params.id, ownerId(req), {
    cursor: req.query.cursor,
    limit: req.query.limit
  }));
}));

defineRoute(router, opsRoute('POST /documentos/:id/cancelar', { tag: 'assinaturas', summary: 'Assinaturas avulsas: Cancelar documento', body: cancelSchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), asyncHandler(async (req, res) => {
  const body = cancelSchema.parse(req.body || {});
  return res.json(await cancelDocument(prisma, req.params.id, ownerId(req), body.reason));
}));

defineRoute(router, opsRoute('POST /documentos/:id/arquivar', { tag: 'assinaturas', summary: 'Assinaturas avulsas: Arquivar documento', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), asyncHandler(async (req, res) => {
  return res.json(await archiveDocument(prisma, req.params.id, ownerId(req)));
}));

defineRoute(router, opsRoute('POST /documentos/:id/restaurar', { tag: 'assinaturas', summary: 'Assinaturas avulsas: Restaurar documento arquivado', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), asyncHandler(async (req, res) => {
  return res.json(await restoreArchivedDocument(prisma, req.params.id, ownerId(req)));
}));

defineRoute(router, opsRoute('DELETE /documentos/:id', { tag: 'assinaturas', summary: 'Assinaturas avulsas: Excluir documento', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 204: EMPTY }, errors: [401, 403] }), asyncHandler(async (req, res) => {
  await softDeleteDocument(prisma, req.params.id, ownerId(req));
  return res.status(204).end();
}));

defineRoute(router, opsRoute('POST /documentos/:id/restaurar-excluido', { tag: 'assinaturas', summary: 'Assinaturas avulsas: Restaurar documento excluído', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), asyncHandler(async (req, res) => {
  return res.json(await restoreDeletedDocument(prisma, req.params.id, ownerId(req)));
}));

export default router;
