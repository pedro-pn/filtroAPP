import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import { saveEpiPdf } from '../../lib/epi-docx.js';
import {
  decodableSignatureImageDataUrl,
  internalSignatureTokenExpiresAt,
  signatureEvidenceFromRequest
} from '../../lib/internal-report-signatures.js';
import { hasModuleRole } from '../../lib/module-roles.js';
import prisma from '../../lib/prisma.js';
import { createMemoryRateLimit } from '../../lib/rate-limit.js';
import { requireAuth } from '../../middleware/auth.js';
import env from '../../config/env.js';

const router = Router();
const EPI_SIGNATURE_TOKEN_DAYS = 7;
const EPI_SIGNED_PUBLIC_PDF_HOURS = 24;
const publicSignatureLimiter = createMemoryRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: 'Muitas tentativas. Tente novamente mais tarde.'
});
const publicPdfCache = new Map();
const PUBLIC_PDF_CACHE_MAX = 100;

const profileSchema = z.object({
  cpf: z.string().trim().max(40).optional().nullable(),
  registrationNumber: z.string().trim().max(80).optional().nullable(),
  admissionDate: z.string().trim().optional().nullable()
});

const optionalCaSchema = z.string().trim().max(80).optional().nullable().transform(value => value || '');

const catalogSchema = z.object({
  name: z.string().trim().min(1).max(180),
  ca: optionalCaSchema,
  isActive: z.boolean().default(true)
});

const recordSchema = z.object({
  catalogItemId: z.string().trim().optional().nullable(),
  epiName: z.string().trim().min(1, 'Informe o nome do EPI.').max(180),
  ca: optionalCaSchema,
  quantity: z.coerce.number().int('Quantidade deve ser um número inteiro.').positive('Quantidade deve ser maior que zero.').max(999).default(1),
  lendDate: z.string().trim().min(1, 'Informe a data de fornecimento.'),
  devolutionDate: z.string().trim().optional().nullable()
});

const signatureRequestSchema = z.object({
  recordIds: z.array(z.string().min(1)).min(1).max(100)
});

const archiveRecordsSchema = z.object({
  recordIds: z.array(z.string().min(1)).min(1).max(100),
  archived: z.boolean().default(true)
});

const publicSignatureConfirmSchema = z.object({
  signerName: z.string().trim().min(2).max(160),
  signatureImageDataUrl: z.string().trim().min(1).max(750_000)
});

function invalidSignatureImageError() {
  return new z.ZodError([{
    code: z.ZodIssueCode.custom,
    path: ['signatureImageDataUrl'],
    message: 'Assinatura visual invalida.'
  }]);
}

function epiReturnConflictError() {
  const error = new Error('Já existe uma devolução pendente ou assinada para este EPI.');
  error.status = 409;
  error.statusCode = 409;
  return error;
}

function isUniqueConstraintError(error) {
  return error?.code === 'P2002';
}

export function requireEpiAccess(req, res, next) {
  if (hasModuleRole(req.auth?.user, ['epi:technician', 'epi:collaborator'])) {
    return next();
  }
  return res.status(403).json({ error: 'Acesso restrito ao módulo de EPI.' });
}

export function requireEpiTechnician(req, res, next) {
  if (hasModuleRole(req.auth?.user, 'epi:technician')) {
    return next();
  }
  return res.status(403).json({ error: 'Acesso restrito aos técnicos de EPI.' });
}

export function isEpiTechnician(user) {
  return hasModuleRole(user, 'epi:technician');
}

function isEpiCollaborator(user) {
  return hasModuleRole(user, 'epi:collaborator');
}

export function parseDateOnly(value, fieldName) {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const invalid = () => {
    const error = new z.ZodError([{
      code: z.ZodIssueCode.custom,
      path: [fieldName],
      message: 'Data inválida. Use DD/MM/YYYY.'
    }]);
    throw error;
  };
  if (!match) invalid();

  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) invalid();
  if (year < 1900 || year > 2100 || month < 1 || month > 12) invalid();

  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > maxDay) invalid();

  const date = new Date(`${yearText}-${monthText}-${dayText}T12:00:00.000-03:00`);
  if (Number.isNaN(date.getTime())) {
    invalid();
  }
  return date;
}

export function assertEpiDateOrder(lendDate, devolutionDate) {
  if (!lendDate || !devolutionDate) return;
  if (new Date(devolutionDate).getTime() >= new Date(lendDate).getTime()) return;
  throw new z.ZodError([{
    code: z.ZodIssueCode.custom,
    path: ['devolutionDate'],
    message: 'Data de devolução não pode ser anterior à data de fornecimento.'
  }]);
}

function normalizeNullableText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function cpfDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function isValidCpf(value) {
  const digits = cpfDigits(value);
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;

  const numbers = digits.split('').map(Number);
  const calc = length => {
    const sum = numbers.slice(0, length).reduce((total, digit, index) => total + digit * (length + 1 - index), 0);
    const mod = (sum * 10) % 11;
    return mod === 10 ? 0 : mod;
  };

  return calc(9) === numbers[9] && calc(10) === numbers[10];
}

function formatCpf(value) {
  const digits = cpfDigits(value);
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
}

function normalizeCpf(value) {
  const digits = cpfDigits(value);
  if (!digits) return null;
  if (!isValidCpf(digits)) {
    const error = new Error('CPF inválido.');
    error.status = 400;
    error.statusCode = 400;
    throw error;
  }
  return formatCpf(digits);
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

function publicSignUrl(token) {
  const base = String(env.appUrl || '').replace(/\/+$/, '');
  const path = `/epi/assinar/${encodeURIComponent(token)}`;
  return base ? `${base}${path}` : path;
}

function publicSignatureResult(record, token) {
  return {
    record,
    token,
    signUrl: publicSignUrl(token)
  };
}

function signedPublicPdfExpiresAt(signedAt = new Date()) {
  return new Date(new Date(signedAt).getTime() + EPI_SIGNED_PUBLIC_PDF_HOURS * 60 * 60 * 1000);
}

function contentDisposition(fileName) {
  const ascii = fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ._\-]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function selectedCollaboratorFields() {
  return {
    include: {
      epiRecords: {
        select: {
          id: true,
          collaboratorId: true,
          catalogItemId: true,
          epiName: true,
          ca: true,
          quantity: true,
          lendDate: true,
          devolutionDate: true,
          signatureRequestId: true,
          signatureSignerName: true,
          signedAt: true,
          pendingReturn: true,
          returnSourceRecordId: true,
          archivedAt: true,
          createdAt: true,
          updatedAt: true,
          catalogItem: true,
          signatureRequest: { select: { id: true, status: true, expiresAt: true, signedAt: true } }
        },
        orderBy: [{ lendDate: 'desc' }, { createdAt: 'desc' }]
      }
    }
  };
}

export function epiCollaboratorAccessWhere(auth) {
  if (isEpiTechnician(auth?.user)) return {};
  if (isEpiCollaborator(auth?.user)) {
    return { id: auth?.user?.collaboratorId || '__NO_MATCH__' };
  }
  return { id: '__NO_MATCH__' };
}

export function canAccessEpiCollaborator(auth, collaboratorId) {
  if (isEpiTechnician(auth?.user)) return true;
  return isEpiCollaborator(auth?.user) && auth?.user?.collaboratorId === collaboratorId;
}

function assertEpiCollaboratorAccess(req, collaboratorId) {
  if (canAccessEpiCollaborator(req.auth, collaboratorId)) return;
  const error = new Error('Você não tem permissão para acessar este colaborador.');
  error.status = 403;
  error.statusCode = 403;
  throw error;
}

function documentRecordFilter({ archived = false, recordIds = null } = {}) {
  const where = {};
  if (Array.isArray(recordIds)) where.id = { in: recordIds };
  else {
    where.archivedAt = archived ? { not: null } : null;
    if (!archived) where.pendingReturn = false;
  }
  return where;
}

async function collaboratorForDocument(collaboratorId, options = {}, tx = prisma) {
  return tx.collaborator.findUniqueOrThrow({
    where: { id: collaboratorId },
    include: {
      epiRecords: {
        where: documentRecordFilter(options),
        orderBy: [{ lendDate: 'asc' }, { createdAt: 'asc' }],
        include: {
          signatureRequest: {
            select: {
              id: true,
              signatureImageDataUrl: true,
              signatureSignerName: true
            }
          }
        }
      }
    }
  });
}

async function findRequestByToken(rawToken, tx = prisma) {
  return tx.epiSignatureRequest.findUnique({
    where: { tokenHash: tokenHash(rawToken) },
    include: {
      collaborator: true,
      records: { orderBy: [{ lendDate: 'asc' }, { createdAt: 'asc' }] }
    }
  });
}

export function requestStatus(request) {
  if (!request) return 'INVALID';
  if (request.expiresAt <= new Date()) return 'EXPIRED';
  if (request.status === 'SIGNED') return 'SIGNED';
  if (request.status === 'EXPIRED') return 'EXPIRED';
  if ((request.records || []).some(record => record.archivedAt)) return 'EXPIRED';
  if (Array.isArray(request.records) && !request.records.length) return 'INVALID';
  return 'ACTIVE';
}

function isActivePendingRequest(request) {
  if (!request) return false;
  return request.status === 'PENDING' && request.expiresAt > new Date();
}

export function publicEpiSignaturePayload(request, status = requestStatus(request)) {
  if (!request || status === 'INVALID') return { status };
  if (status !== 'ACTIVE') {
    return {
      status,
      expiresAt: request.expiresAt || null,
      signedAt: request.signedAt || null,
      collaborator: null,
      records: []
    };
  }
  return {
    status,
    expiresAt: request.expiresAt || null,
    signedAt: request.signedAt || null,
    collaborator: {
      id: request.collaborator.id,
      name: request.collaborator.name,
      role: request.collaborator.role
    },
    records: (request.records || []).map(record => ({
      id: record.id,
      collaboratorId: record.collaboratorId,
      catalogItemId: record.catalogItemId,
      epiName: record.epiName,
      ca: record.ca,
      quantity: record.quantity,
      lendDate: record.lendDate,
      devolutionDate: record.devolutionDate,
      signatureRequestId: record.signatureRequestId,
      signedAt: record.signedAt,
      archivedAt: record.archivedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    }))
  };
}

export async function activePublicEpiRequestOrThrow(token, tx = prisma) {
  const request = await findRequestByToken(token, tx);
  const status = requestStatus(request);
  if (status !== 'ACTIVE') {
    const error = new Error('Link de assinatura indisponível.');
    error.status = status === 'INVALID' ? 404 : 410;
    error.statusCode = error.status;
    throw error;
  }
  return request;
}

export async function publicPdfEpiRequestOrThrow(token, tx = prisma) {
  const request = await findRequestByToken(token, tx);
  const status = requestStatus(request);
  if (status !== 'ACTIVE' && status !== 'SIGNED') {
    const error = new Error('Link de assinatura indisponível.');
    error.status = status === 'INVALID' ? 404 : 410;
    error.statusCode = error.status;
    throw error;
  }
  return request;
}

async function createEpiSignatureRequestAuditLog(tx, requestId, action, evidence = {}) {
  if (!requestId || !tx.epiSignatureRequestAuditLog?.create) return null;
  return tx.epiSignatureRequestAuditLog.create({
    data: {
      requestId,
      action,
      ipAddress: evidence.ipAddress || null,
      userAgent: evidence.userAgent || null
    }
  });
}

async function logEpiSignatureRequestEvent(tx, request, action, evidence = {}) {
  if (!request?.id) return;
  await createEpiSignatureRequestAuditLog(tx, request.id, action, evidence);
}

export function assertNoActivePendingEpiSignatureRequest(record) {
  if (!isActivePendingRequest(record?.signatureRequest)) return;
  const error = new Error('EPI com solicitação de assinatura ativa não pode ser alterado. Aguarde a assinatura ou expire a solicitação.');
  error.status = 409;
  error.statusCode = 409;
  throw error;
}

function assertNotPendingReturnRevision(record) {
  if (!record?.pendingReturn) return;
  const error = new Error('EPI com devolução pendente de assinatura não pode ser alterado ou removido. Reemita ou revogue a solicitação de devolução.');
  error.status = 409;
  error.statusCode = 409;
  throw error;
}

export function assertCanDeleteEpiRecord(record) {
  assertNotPendingReturnRevision(record);
  assertNoActivePendingEpiSignatureRequest(record);
  if (!record?.signedAt && !record?.signatureImageDataUrl) return;
  const error = new Error('EPI assinado não pode ser removido. Arquive o registro para preservá-lo.');
  error.status = 409;
  error.statusCode = 409;
  throw error;
}

export function assertCanUpdateEpiRecord(record) {
  assertNotPendingReturnRevision(record);
  assertNoActivePendingEpiSignatureRequest(record);
  if (!record?.signedAt && !record?.signatureImageDataUrl) return;
  const error = new Error('EPI assinado não pode ser alterado. Arquive o registro para preservar a evidência assinada.');
  error.status = 409;
  error.statusCode = 409;
  throw error;
}

export function isSignedEpiReturnUpdate(record, data) {
  if (!record || (!record.signedAt && !record.signatureImageDataUrl)) return false;
  const changedFields = Object.entries(data || {})
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);
  return changedFields.length === 1
    && changedFields[0] === 'devolutionDate'
    && !!data.devolutionDate
    && !record.devolutionDate;
}

function signedEpiReturnRevisionData(record, devolutionDate, userId) {
  return {
    collaboratorId: record.collaboratorId,
    catalogItemId: record.catalogItemId || null,
    epiName: record.epiName,
    ca: record.ca,
    quantity: record.quantity,
    lendDate: record.lendDate,
    devolutionDate,
    pendingReturn: true,
    returnSourceRecordId: record.id,
    createdByUserId: userId || null
  };
}

function recordSignatureRequestStatus(record) {
  if (!record?.signatureRequest) return null;
  return requestStatus({ ...record.signatureRequest, records: [{}] });
}

export function expiredEpiSignatureRequestIdsForRecords(records) {
  return records
    .map(record => record.signatureRequest)
    .filter(requestItem => requestItem && requestStatus({ ...requestItem, records: [{}] }) === 'EXPIRED')
    .map(requestItem => requestItem.id);
}

export function activePendingEpiSignatureRequestIdsForRecords(records) {
  return records
    .map(record => record.signatureRequest)
    .filter(isActivePendingRequest)
    .map(request => request.id);
}

export function assertCanCreateEpiSignatureRequest(records, selectedCount) {
  if (records.length !== selectedCount) {
    const error = new Error('Selecione apenas EPIs ativos e sem assinatura.');
    error.status = 400;
    error.statusCode = 400;
    throw error;
  }

  const blocked = records.find(record => {
    const status = recordSignatureRequestStatus(record);
    return status && status !== 'EXPIRED';
  });
  if (blocked || records.some(record => isActivePendingRequest(record.signatureRequest))) {
    const error = new Error('Já existe uma solicitação de assinatura ativa para um dos EPIs selecionados.');
    error.status = 409;
    error.statusCode = 409;
    throw error;
  }
}

export function assertCanUnarchiveEpiRecords(records, activeSuccessors = []) {
  const successorSourceIds = new Set(
    activeSuccessors
      .map(record => record.returnSourceRecordId)
      .filter(Boolean)
  );
  const blocked = records.find(record => successorSourceIds.has(record.id));
  if (!blocked) return;
  const error = new Error('EPI devolvido não pode ser restaurado enquanto a revisão de devolução assinada estiver ativa.');
  error.status = 409;
  error.statusCode = 409;
  throw error;
}

async function createPendingReturnSignatureRequest(tx, { current, returnedAt, userId, collaboratorId }) {
  assertEpiDateOrder(current.lendDate, returnedAt);
  const pending = await tx.epiRecord.findFirst({
    where: {
      returnSourceRecordId: current.id,
      pendingReturn: true,
      archivedAt: null
    },
    include: { signatureRequest: true, catalogItem: true }
  });
  const token = createToken();

  if (pending) {
    const status = recordSignatureRequestStatus(pending);
    if (status && status !== 'EXPIRED') {
      assertNoActivePendingEpiSignatureRequest(pending);
      const error = new Error('Já existe uma devolução pendente de assinatura para este EPI.');
      error.status = 409;
      error.statusCode = 409;
      throw error;
    }
    if (pending.signatureRequestId) {
      await tx.epiSignatureRequest.updateMany({
        where: { id: pending.signatureRequestId, status: 'PENDING' },
        data: { status: 'EXPIRED' }
      });
    }
    const created = await tx.epiSignatureRequest.create({
      data: {
        collaboratorId,
        requestedByUserId: userId,
        tokenHash: tokenHash(token),
        expiresAt: internalSignatureTokenExpiresAt(EPI_SIGNATURE_TOKEN_DAYS)
      }
    });
    const record = await tx.epiRecord.update({
      where: { id: pending.id },
      data: {
        devolutionDate: returnedAt,
        signatureRequestId: created.id
      },
      include: { catalogItem: true, signatureRequest: true }
    });
    return publicSignatureResult(record, token);
  }

  const created = await tx.epiSignatureRequest.create({
    data: {
      collaboratorId,
      requestedByUserId: userId,
      tokenHash: tokenHash(token),
      expiresAt: internalSignatureTokenExpiresAt(EPI_SIGNATURE_TOKEN_DAYS)
    }
  });
  let record;
  try {
    record = await tx.epiRecord.create({
      data: {
        ...signedEpiReturnRevisionData(current, returnedAt, userId),
        signatureRequestId: created.id
      },
      include: { catalogItem: true, signatureRequest: true }
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw epiReturnConflictError();
    throw error;
  }
  return publicSignatureResult(record, token);
}

async function ensureCatalogForRecord(data, tx = prisma) {
  const ca = data.ca || '';
  if (data.catalogItemId) {
    const item = await tx.epiCatalogItem.findFirst({ where: { id: data.catalogItemId, isActive: true } });
    if (!item) {
      const error = new Error('EPI do catálogo inválido ou inativo.');
      error.status = 400;
      error.statusCode = 400;
      throw error;
    }
    return item;
  }

  return tx.epiCatalogItem.upsert({
    where: { name_ca: { name: data.epiName, ca } },
    create: { name: data.epiName, ca, isActive: true },
    update: { isActive: true }
  });
}

async function sendCollaboratorPdf(res, collaboratorId, options = {}) {
  const collaborator = await collaboratorForDocument(collaboratorId, options);
  const file = await saveEpiPdf(collaborator, {
    variantLabel: options.archived ? 'Arquivados' : ''
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', contentDisposition(file.fileName));
  res.send(await fs.readFile(file.pdfPath));
}

function publicPdfCacheKey(request) {
  const recordStamp = (request.records || [])
    .map(record => `${record.id}:${new Date(record.updatedAt || record.createdAt || 0).getTime()}`)
    .join('|');
  return `${request.id}:${new Date(request.updatedAt || request.createdAt || 0).getTime()}:${recordStamp}`;
}

function signedPdfHash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function signedPdfSnapshotCollaborator(request, { signerName, signatureImageDataUrl, signedAt }) {
  const signatureRequest = {
    id: request.id,
    signatureImageDataUrl,
    signatureSignerName: signerName
  };
  return {
    ...request.collaborator,
    epiRecords: (request.records || []).map(record => ({
      ...record,
      signedAt,
      signatureSignerName: signerName,
      signatureRequest
    }))
  };
}

export async function createSignedPublicPdfArtifact(request, { signerName, signatureImageDataUrl, signedAt }) {
  const file = await saveEpiPdf(signedPdfSnapshotCollaborator(request, { signerName, signatureImageDataUrl, signedAt }), {
    variantLabel: 'Assinado',
    redactCollaboratorFields: true
  });
  const bytes = await fs.readFile(file.pdfPath);
  return {
    signedPdfPath: file.pdfPath,
    signedPdfHash: signedPdfHash(bytes),
    signedPdfFileName: file.fileName
  };
}

async function cachedPublicPdfFile(request) {
  const key = publicPdfCacheKey(request);
  const cached = publicPdfCache.get(key);
  if (cached) {
    try {
      await fs.access(cached.pdfPath);
      return cached;
    } catch {
      publicPdfCache.delete(key);
    }
  }

  const collaborator = await collaboratorForDocument(request.collaboratorId, {
    recordIds: request.records.map(record => record.id)
  });
  const file = await saveEpiPdf(collaborator, {
    variantLabel: 'Solicitação de assinatura',
    redactCollaboratorFields: true
  });
  publicPdfCache.set(key, file);
  if (publicPdfCache.size > PUBLIC_PDF_CACHE_MAX) {
    const oldestKey = publicPdfCache.keys().next().value;
    if (oldestKey) publicPdfCache.delete(oldestKey);
  }
  return file;
}

export async function signedPublicPdfFileOrThrow(request) {
  const status = requestStatus(request);
  if (status !== 'SIGNED') return null;
  if (!request.signedPdfPath) {
    const error = new Error('PDF assinado indisponível.');
    error.status = 410;
    error.statusCode = 410;
    throw error;
  }
  const bytes = await fs.readFile(request.signedPdfPath);
  const hash = signedPdfHash(bytes);
  if (request.signedPdfHash && hash !== request.signedPdfHash) {
    const error = new Error('PDF assinado não corresponde mais ao hash registrado.');
    error.status = 409;
    error.statusCode = 409;
    throw error;
  }
  return {
    pdfPath: request.signedPdfPath,
    fileName: request.signedPdfFileName || path.basename(request.signedPdfPath),
    hash
  };
}

async function sendPublicRequestPdf(res, request) {
  const signedFile = await signedPublicPdfFileOrThrow(request);
  if (signedFile) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', contentDisposition(signedFile.fileName));
    res.setHeader('X-Content-SHA256', signedFile.hash);
    res.send(await fs.readFile(signedFile.pdfPath));
    return;
  }
  const file = await cachedPublicPdfFile(request);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', contentDisposition(file.fileName));
  res.send(await fs.readFile(file.pdfPath));
}

router.get('/public-sign/:token', publicSignatureLimiter, asyncHandler(async (req, res) => {
  const evidence = signatureEvidenceFromRequest(req);
  const request = await findRequestByToken(req.params.token);
  const status = requestStatus(request);
  if (request && status === 'EXPIRED' && request.status === 'PENDING') {
    await prisma.$transaction(async tx => {
      await tx.epiSignatureRequest.update({ where: { id: request.id }, data: { status: 'EXPIRED' } });
      await logEpiSignatureRequestEvent(tx, request, 'EXPIRED', evidence);
    });
  } else if (request && status === 'ACTIVE') {
    await logEpiSignatureRequestEvent(prisma, request, 'VIEWED', evidence);
  }
  res.json(publicEpiSignaturePayload(request, status));
}));

router.get('/public-sign/:token/pdf', publicSignatureLimiter, asyncHandler(async (req, res) => {
  const evidence = signatureEvidenceFromRequest(req);
  const request = await publicPdfEpiRequestOrThrow(req.params.token);
  await logEpiSignatureRequestEvent(prisma, request, 'PDF_DOWNLOADED', evidence);
  return sendPublicRequestPdf(res, request);
}));

export async function confirmPublicEpiSignatureRequest({
  token,
  body,
  req = { headers: {} },
  client = prisma,
  pdfArtifactFactory = createSignedPublicPdfArtifact
}) {
  const data = publicSignatureConfirmSchema.parse(body || {});
  const evidence = signatureEvidenceFromRequest(req);
  const preflightRequest = await findRequestByToken(token, client);
  const preflightStatus = requestStatus(preflightRequest);
  if (!preflightRequest || preflightStatus === 'INVALID') {
    const error = new Error('Link de assinatura inválido.');
    error.status = 404;
    error.statusCode = 404;
    throw error;
  }
  if (preflightStatus === 'EXPIRED') {
    const error = new Error('Link de assinatura expirado.');
    error.status = 410;
    error.statusCode = 410;
    throw error;
  }
  if (preflightStatus === 'SIGNED') {
    const error = new Error('Link de assinatura já utilizado.');
    error.status = 410;
    error.statusCode = 410;
    throw error;
  }
  const signatureImage = await decodableSignatureImageDataUrl(data.signatureImageDataUrl);
  if (!signatureImage) throw invalidSignatureImageError();
  const signedAt = new Date();
  const signedPdfArtifact = await pdfArtifactFactory(preflightRequest, {
    signerName: data.signerName,
    signatureImageDataUrl: data.signatureImageDataUrl,
    signedAt
  });

  const signed = await client.$transaction(async tx => {
    const request = await findRequestByToken(token, tx);
    const status = requestStatus(request);
    if (!request || status === 'INVALID') {
      const error = new Error('Link de assinatura inválido.');
      error.status = 404;
      error.statusCode = 404;
      throw error;
    }
    if (status === 'EXPIRED') {
      const error = new Error('Link de assinatura expirado.');
      error.status = 410;
      error.statusCode = 410;
      throw error;
    }
    if (status === 'SIGNED') {
      const error = new Error('Link de assinatura já utilizado.');
      error.status = 410;
      error.statusCode = 410;
      throw error;
    }

    const result = await tx.epiRecord.updateMany({
      where: { signatureRequestId: request.id, signedAt: null, archivedAt: null },
      data: {
        signatureSignerName: data.signerName,
        signedAt
      }
    });
    if (result.count !== request.records.length) {
      const error = new Error('Solicitação de assinatura não corresponde mais aos EPIs selecionados.');
      error.status = 409;
      error.statusCode = 409;
      throw error;
    }
    const pendingReturnRecords = request.records.filter(record => record.pendingReturn && record.returnSourceRecordId);
    if (pendingReturnRecords.length) {
      const sourceIds = Array.from(new Set(pendingReturnRecords.map(record => record.returnSourceRecordId).filter(Boolean)));
      const archivedSources = await tx.epiRecord.updateMany({
        where: {
          id: { in: sourceIds },
          signedAt: { not: null },
          archivedAt: null
        },
        data: { archivedAt: signedAt }
      });
      if (archivedSources.count !== sourceIds.length) {
        const error = new Error('Solicitação de devolução não corresponde mais ao EPI assinado original.');
        error.status = 409;
        error.statusCode = 409;
        throw error;
      }
      const promotedReturns = await tx.epiRecord.updateMany({
        where: {
          id: { in: pendingReturnRecords.map(record => record.id) },
          pendingReturn: true
        },
        data: { pendingReturn: false }
      });
      if (promotedReturns.count !== pendingReturnRecords.length) {
        const error = new Error('Solicitação de devolução não corresponde mais ao EPI pendente.');
        error.status = 409;
        error.statusCode = 409;
        throw error;
      }
    }
    const signedRequest = await tx.epiSignatureRequest.update({
      where: { id: request.id },
      data: {
        status: 'SIGNED',
        signedAt,
        expiresAt: signedPublicPdfExpiresAt(signedAt),
        signatureImageDataUrl: data.signatureImageDataUrl,
        signatureSignerName: data.signerName,
        signedPdfPath: signedPdfArtifact.signedPdfPath || null,
        signedPdfHash: signedPdfArtifact.signedPdfHash || null,
        signedPdfFileName: signedPdfArtifact.signedPdfFileName || null,
        ipAddress: evidence.ipAddress || null,
        userAgent: evidence.userAgent || null,
        requestedByUserId: request.requestedByUserId || null
      },
      include: { collaborator: true, records: true }
    });
    await createEpiSignatureRequestAuditLog(tx, request.id, 'SIGNED', evidence);
    return signedRequest;
  });

  return { signed, evidence };
}

router.post('/public-sign/:token/confirm', publicSignatureLimiter, asyncHandler(async (req, res) => {
  const { signed, evidence } = await confirmPublicEpiSignatureRequest({
    token: req.params.token,
    body: req.body || {},
    req,
    client: prisma
  });

  res.json({ success: true, evidence: { ipAddress: evidence.ipAddress }, request: publicEpiSignaturePayload(signed, 'SIGNED') });
}));

router.use(requireAuth, requireEpiAccess);

router.get('/collaborators', asyncHandler(async (_req, res) => {
  const items = await prisma.collaborator.findMany({
    where: { isActive: true, ...epiCollaboratorAccessWhere(_req.auth) },
    ...selectedCollaboratorFields(),
    orderBy: { name: 'asc' }
  });
  res.json(items);
}));

router.put('/collaborators/:id/profile', requireEpiTechnician, asyncHandler(async (req, res) => {
  const data = profileSchema.parse(req.body || {});
  const item = await prisma.collaborator.update({
    where: { id: req.params.id },
    data: {
      cpf: normalizeCpf(data.cpf),
      registrationNumber: normalizeNullableText(data.registrationNumber),
      admissionDate: data.admissionDate ? parseDateOnly(data.admissionDate, 'admissionDate') : null
    },
    ...selectedCollaboratorFields()
  });
  res.json(item);
}));

router.get('/collaborators/:id/pdf', asyncHandler(async (req, res) => {
  assertEpiCollaboratorAccess(req, req.params.id);
  const archived = String(req.query.archived || '').toLowerCase() === 'true';
  return sendCollaboratorPdf(res, req.params.id, { archived });
}));

router.post('/collaborators/:id/records', requireEpiTechnician, asyncHandler(async (req, res) => {
  const data = recordSchema.parse(req.body || {});
  const item = await prisma.$transaction(async tx => {
    const collaborator = await tx.collaborator.findFirst({ where: { id: req.params.id, isActive: true } });
    if (!collaborator) {
      const error = new Error('Colaborador inválido.');
      error.status = 400;
      error.statusCode = 400;
      throw error;
    }
    const catalogItem = await ensureCatalogForRecord(data, tx);
    const lendDate = parseDateOnly(data.lendDate, 'lendDate');
    const devolutionDate = data.devolutionDate ? parseDateOnly(data.devolutionDate, 'devolutionDate') : null;
    assertEpiDateOrder(lendDate, devolutionDate);
    return tx.epiRecord.create({
      data: {
        collaboratorId: req.params.id,
        catalogItemId: catalogItem.id,
        epiName: catalogItem.name,
        ca: catalogItem.ca,
        quantity: data.quantity,
        lendDate,
        devolutionDate,
        createdByUserId: req.auth.user.id
      },
      include: { catalogItem: true, signatureRequest: true }
    });
  });
  res.status(201).json(item);
}));

router.put('/records/:id', requireEpiTechnician, asyncHandler(async (req, res) => {
  const data = recordSchema.partial().parse(req.body || {});
  const item = await prisma.$transaction(async tx => {
    const current = await tx.epiRecord.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { signatureRequest: true }
    });
    if (isSignedEpiReturnUpdate(current, data)) {
      assertNoActivePendingEpiSignatureRequest(current);
      const returnedAt = parseDateOnly(data.devolutionDate, 'devolutionDate');
      return createPendingReturnSignatureRequest(tx, {
        current,
        returnedAt,
        userId: req.auth.user.id,
        collaboratorId: current.collaboratorId
      });
    }
    assertCanUpdateEpiRecord(current);
    const shouldResolveCatalog = data.catalogItemId !== undefined || data.epiName !== undefined || data.ca !== undefined;
    const catalogItem = shouldResolveCatalog ? await ensureCatalogForRecord({
      catalogItemId: data.catalogItemId,
      epiName: data.epiName ?? current.epiName,
      ca: data.ca ?? current.ca
    }, tx) : null;
    const lendDate = data.lendDate ? parseDateOnly(data.lendDate, 'lendDate') : undefined;
    const devolutionDate = data.devolutionDate === undefined ? undefined : (data.devolutionDate ? parseDateOnly(data.devolutionDate, 'devolutionDate') : null);
    assertEpiDateOrder(lendDate ?? current.lendDate, devolutionDate === undefined ? current.devolutionDate : devolutionDate);
    return tx.epiRecord.update({
      where: { id: req.params.id },
      data: {
        catalogItemId: catalogItem?.id,
        epiName: catalogItem?.name ?? data.epiName,
        ca: catalogItem?.ca ?? data.ca,
        quantity: data.quantity,
        lendDate,
        devolutionDate
      },
      include: { catalogItem: true, signatureRequest: true }
    });
  });
  res.json(item);
}));

router.post('/collaborators/:id/records/archive', requireEpiTechnician, asyncHandler(async (req, res) => {
  const data = archiveRecordsSchema.parse(req.body || {});
  const uniqueIds = Array.from(new Set(data.recordIds));
  await prisma.$transaction(async tx => {
    const records = await tx.epiRecord.findMany({
      where: { id: { in: uniqueIds }, collaboratorId: req.params.id },
      include: { signatureRequest: true }
    });
    if (!data.archived) {
      const successors = await tx.epiRecord.findMany({
        where: {
          returnSourceRecordId: { in: records.map(record => record.id) },
          archivedAt: null
        },
        select: { id: true, returnSourceRecordId: true }
      });
      assertCanUnarchiveEpiRecords(records, successors);
    }
    const activeRequestIds = activePendingEpiSignatureRequestIdsForRecords(records);

    if (data.archived && activeRequestIds.length) {
      await tx.epiSignatureRequest.updateMany({
        where: { id: { in: Array.from(new Set(activeRequestIds)) }, status: 'PENDING' },
        data: { status: 'EXPIRED' }
      });
    }

    await tx.epiRecord.updateMany({
      where: { id: { in: uniqueIds }, collaboratorId: req.params.id },
      data: { archivedAt: data.archived ? new Date() : null }
    });
  });
  const collaborator = await prisma.collaborator.findUniqueOrThrow({
    where: { id: req.params.id },
    ...selectedCollaboratorFields()
  });
  res.json(collaborator);
}));

router.delete('/records/:id', requireEpiTechnician, asyncHandler(async (req, res) => {
  const record = await prisma.epiRecord.findUniqueOrThrow({
    where: { id: req.params.id },
    include: { signatureRequest: true }
  });
  assertCanDeleteEpiRecord(record);
  await prisma.epiRecord.delete({ where: { id: req.params.id } });
  res.status(204).send();
}));

router.post('/collaborators/:id/signature-requests', requireEpiTechnician, asyncHandler(async (req, res) => {
  const data = signatureRequestSchema.parse(req.body || {});
  const uniqueIds = Array.from(new Set(data.recordIds));

  const token = createToken();
  const request = await prisma.$transaction(async tx => {
    const records = await tx.epiRecord.findMany({
      where: { id: { in: uniqueIds }, collaboratorId: req.params.id, signedAt: null, archivedAt: null },
      include: { signatureRequest: true }
    });
    assertCanCreateEpiSignatureRequest(records, uniqueIds.length);
    const expiredRequestIds = expiredEpiSignatureRequestIdsForRecords(records);

    if (expiredRequestIds.length) {
      await tx.epiSignatureRequest.updateMany({
        where: { id: { in: Array.from(new Set(expiredRequestIds)) }, status: 'PENDING' },
        data: { status: 'EXPIRED' }
      });
    }

    const created = await tx.epiSignatureRequest.create({
      data: {
        collaboratorId: req.params.id,
        requestedByUserId: req.auth.user.id,
        tokenHash: tokenHash(token),
        expiresAt: internalSignatureTokenExpiresAt(EPI_SIGNATURE_TOKEN_DAYS)
      }
    });
    const result = await tx.epiRecord.updateMany({
      where: {
        id: { in: records.map(record => record.id) },
        collaboratorId: req.params.id,
        signedAt: null,
        archivedAt: null,
        OR: [
          { signatureRequestId: null },
          { signatureRequestId: { in: expiredRequestIds } }
        ]
      },
      data: { signatureRequestId: created.id }
    });
    if (result.count !== records.length) {
      const error = new Error('Não foi possível vincular todos os EPIs à solicitação de assinatura.');
      error.status = 409;
      error.statusCode = 409;
      throw error;
    }
    return tx.epiSignatureRequest.findUniqueOrThrow({
      where: { id: created.id },
      include: { records: true, collaborator: true }
    });
  });

  res.status(201).json({ request, token, signUrl: publicSignUrl(token) });
}));

router.get('/catalog', asyncHandler(async (_req, res) => {
  const items = await prisma.epiCatalogItem.findMany({
    where: { isActive: true },
    orderBy: [{ name: 'asc' }, { ca: 'asc' }]
  });
  res.json(items);
}));

router.post('/catalog', requireEpiTechnician, asyncHandler(async (req, res) => {
  const data = catalogSchema.parse(req.body || {});
  const item = await prisma.epiCatalogItem.upsert({
    where: { name_ca: { name: data.name, ca: data.ca } },
    create: data,
    update: data
  });
  res.status(201).json(item);
}));

router.put('/catalog/:id', requireEpiTechnician, asyncHandler(async (req, res) => {
  const data = catalogSchema.partial().parse(req.body || {});
  const item = await prisma.epiCatalogItem.update({ where: { id: req.params.id }, data });
  res.json(item);
}));

router.delete('/catalog/:id', requireEpiTechnician, asyncHandler(async (req, res) => {
  await prisma.epiCatalogItem.update({ where: { id: req.params.id }, data: { isActive: false } });
  res.status(204).send();
}));

export default router;
