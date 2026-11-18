import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import { saveEpiPdf } from '../../lib/epi-docx.js';
import { internalSignatureTokenExpiresAt, parseSignatureImageDataUrl, signatureEvidenceFromRequest } from '../../lib/internal-report-signatures.js';
import { hasModuleRole } from '../../lib/module-roles.js';
import prisma from '../../lib/prisma.js';
import { requireAuth } from '../../middleware/auth.js';
import env from '../../config/env.js';

const router = Router();

const profileSchema = z.object({
  cpf: z.string().trim().max(40).optional().nullable(),
  registrationNumber: z.string().trim().max(80).optional().nullable(),
  admissionDate: z.string().trim().optional().nullable()
});

const catalogSchema = z.object({
  name: z.string().trim().min(1).max(180),
  ca: z.string().trim().min(1).max(80),
  isActive: z.boolean().default(true)
});

const recordSchema = z.object({
  catalogItemId: z.string().trim().optional().nullable(),
  epiName: z.string().trim().min(1).max(180),
  ca: z.string().trim().min(1).max(80),
  quantity: z.coerce.number().int().positive().max(999).default(1),
  lendDate: z.string().trim().min(1),
  devolutionDate: z.string().trim().optional().nullable()
});

const signatureRequestSchema = z.object({
  recordIds: z.array(z.string().min(1)).min(1).max(100)
});

const publicSignatureConfirmSchema = z.object({
  signerName: z.string().trim().min(2).max(160),
  signatureImageDataUrl: z.string().trim().min(1).max(2_100_000)
    .refine(value => !!parseSignatureImageDataUrl(value), 'Assinatura visual invalida.')
});

function requireEpiAccess(req, res, next) {
  if (
    req.auth?.user?.accountType === 'ADMIN'
    || hasModuleRole(req.auth?.user, ['epi:technician', 'epi:collaborator'])
  ) {
    return next();
  }
  return res.status(403).json({ error: 'Acesso restrito ao módulo de EPI.' });
}

function requireEpiTechnician(req, res, next) {
  if (req.auth?.user?.accountType === 'ADMIN' || hasModuleRole(req.auth?.user, 'epi:technician')) {
    return next();
  }
  return res.status(403).json({ error: 'Acesso restrito aos técnicos de EPI.' });
}

function parseDateOnly(value, fieldName) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00.000-03:00`);
  if (Number.isNaN(date.getTime())) {
    const error = new z.ZodError([{
      code: z.ZodIssueCode.custom,
      path: [fieldName],
      message: 'Data inválida.'
    }]);
    throw error;
  }
  return date;
}

function normalizeNullableText(value) {
  const text = String(value || '').trim();
  return text || null;
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
        include: {
          catalogItem: true,
          signatureRequest: { select: { id: true, status: true, expiresAt: true, signedAt: true } }
        },
        orderBy: [{ lendDate: 'desc' }, { createdAt: 'desc' }]
      }
    }
  };
}

async function collaboratorForDocument(collaboratorId, tx = prisma) {
  return tx.collaborator.findUniqueOrThrow({
    where: { id: collaboratorId },
    include: {
      epiRecords: {
        orderBy: [{ lendDate: 'asc' }, { createdAt: 'asc' }]
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

function requestStatus(request) {
  if (!request) return 'INVALID';
  if (request.status === 'SIGNED') return 'SIGNED';
  if (request.status === 'EXPIRED' || request.expiresAt <= new Date()) return 'EXPIRED';
  return 'ACTIVE';
}

async function ensureCatalogForRecord(data, tx = prisma) {
  if (data.catalogItemId) {
    const item = await tx.epiCatalogItem.findFirst({ where: { id: data.catalogItemId, isActive: true } });
    if (!item) {
      const error = new Error('EPI do catálogo inválido ou inativo.');
      error.statusCode = 400;
      throw error;
    }
    return item;
  }

  return tx.epiCatalogItem.upsert({
    where: { name_ca: { name: data.epiName, ca: data.ca } },
    create: { name: data.epiName, ca: data.ca, isActive: true },
    update: { isActive: true }
  });
}

async function sendCollaboratorPdf(res, collaboratorId) {
  const collaborator = await collaboratorForDocument(collaboratorId);
  const file = await saveEpiPdf(collaborator);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', contentDisposition(file.fileName));
  res.send(await fs.readFile(file.pdfPath));
}

router.get('/public-sign/:token', asyncHandler(async (req, res) => {
  const request = await findRequestByToken(req.params.token);
  const status = requestStatus(request);
  if (request && status === 'EXPIRED' && request.status === 'PENDING') {
    await prisma.epiSignatureRequest.update({ where: { id: request.id }, data: { status: 'EXPIRED' } });
  }
  res.json({
    status,
    expiresAt: request?.expiresAt || null,
    signedAt: request?.signedAt || null,
    collaborator: request ? {
      id: request.collaborator.id,
      name: request.collaborator.name,
      role: request.collaborator.role,
      cpf: request.collaborator.cpf,
      registrationNumber: request.collaborator.registrationNumber,
      admissionDate: request.collaborator.admissionDate
    } : null,
    records: request?.records || []
  });
}));

router.get('/public-sign/:token/pdf', asyncHandler(async (req, res) => {
  const request = await findRequestByToken(req.params.token);
  if (!request) return res.status(404).json({ error: 'Link de assinatura inválido.' });
  return sendCollaboratorPdf(res, request.collaboratorId);
}));

router.post('/public-sign/:token/confirm', asyncHandler(async (req, res) => {
  const data = publicSignatureConfirmSchema.parse(req.body || {});
  const evidence = signatureEvidenceFromRequest(req);
  const signed = await prisma.$transaction(async tx => {
    const request = await findRequestByToken(req.params.token, tx);
    const status = requestStatus(request);
    if (!request || status === 'INVALID') {
      const error = new Error('Link de assinatura inválido.');
      error.statusCode = 404;
      throw error;
    }
    if (status === 'EXPIRED') {
      const error = new Error('Link de assinatura expirado.');
      error.statusCode = 410;
      throw error;
    }
    if (status === 'SIGNED') return request;

    await tx.epiRecord.updateMany({
      where: { signatureRequestId: request.id, signedAt: null },
      data: {
        signatureImageDataUrl: data.signatureImageDataUrl,
        signatureSignerName: data.signerName,
        signedAt: new Date()
      }
    });
    return tx.epiSignatureRequest.update({
      where: { id: request.id },
      data: {
        status: 'SIGNED',
        signedAt: new Date(),
        // Evidence is intentionally light for EPI because the requested output does not include an audit report.
        requestedByUserId: request.requestedByUserId || null
      },
      include: { collaborator: true, records: true }
    });
  });

  res.json({ success: true, evidence: { ipAddress: evidence.ipAddress }, request: signed });
}));

router.use(requireAuth, requireEpiAccess);

router.get('/collaborators', asyncHandler(async (_req, res) => {
  const items = await prisma.collaborator.findMany({
    where: { isActive: true },
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
      cpf: normalizeNullableText(data.cpf),
      registrationNumber: normalizeNullableText(data.registrationNumber),
      admissionDate: data.admissionDate ? parseDateOnly(data.admissionDate, 'admissionDate') : null
    },
    ...selectedCollaboratorFields()
  });
  res.json(item);
}));

router.get('/collaborators/:id/pdf', asyncHandler(async (req, res) => sendCollaboratorPdf(res, req.params.id)));

router.post('/collaborators/:id/records', requireEpiTechnician, asyncHandler(async (req, res) => {
  const data = recordSchema.parse(req.body || {});
  const item = await prisma.$transaction(async tx => {
    const collaborator = await tx.collaborator.findFirst({ where: { id: req.params.id, isActive: true } });
    if (!collaborator) {
      const error = new Error('Colaborador inválido.');
      error.statusCode = 400;
      throw error;
    }
    const catalogItem = await ensureCatalogForRecord(data, tx);
    return tx.epiRecord.create({
      data: {
        collaboratorId: req.params.id,
        catalogItemId: catalogItem.id,
        epiName: catalogItem.name,
        ca: catalogItem.ca,
        quantity: data.quantity,
        lendDate: parseDateOnly(data.lendDate, 'lendDate'),
        devolutionDate: data.devolutionDate ? parseDateOnly(data.devolutionDate, 'devolutionDate') : null,
        createdByUserId: req.auth.user.id
      },
      include: { catalogItem: true, signatureRequest: true }
    });
  });
  res.status(201).json(item);
}));

router.put('/records/:id', requireEpiTechnician, asyncHandler(async (req, res) => {
  const data = recordSchema.partial().parse(req.body || {});
  const catalogItem = data.catalogItemId || (data.epiName && data.ca) ? await ensureCatalogForRecord({
    catalogItemId: data.catalogItemId,
    epiName: data.epiName,
    ca: data.ca
  }, prisma) : null;
  const item = await prisma.epiRecord.update({
    where: { id: req.params.id },
    data: {
      catalogItemId: catalogItem?.id,
      epiName: catalogItem?.name ?? data.epiName,
      ca: catalogItem?.ca ?? data.ca,
      quantity: data.quantity,
      lendDate: data.lendDate ? parseDateOnly(data.lendDate, 'lendDate') : undefined,
      devolutionDate: data.devolutionDate === undefined ? undefined : (data.devolutionDate ? parseDateOnly(data.devolutionDate, 'devolutionDate') : null)
    },
    include: { catalogItem: true, signatureRequest: true }
  });
  res.json(item);
}));

router.delete('/records/:id', requireEpiTechnician, asyncHandler(async (req, res) => {
  await prisma.epiRecord.delete({ where: { id: req.params.id } });
  res.status(204).send();
}));

router.post('/collaborators/:id/signature-requests', requireEpiTechnician, asyncHandler(async (req, res) => {
  const data = signatureRequestSchema.parse(req.body || {});
  const uniqueIds = Array.from(new Set(data.recordIds));
  const records = await prisma.epiRecord.findMany({
    where: { id: { in: uniqueIds }, collaboratorId: req.params.id, signedAt: null }
  });
  if (!records.length) return res.status(400).json({ error: 'Selecione ao menos um EPI sem assinatura.' });

  const token = createToken();
  const request = await prisma.$transaction(async tx => {
    const created = await tx.epiSignatureRequest.create({
      data: {
        collaboratorId: req.params.id,
        requestedByUserId: req.auth.user.id,
        tokenHash: tokenHash(token),
        expiresAt: internalSignatureTokenExpiresAt()
      }
    });
    await tx.epiRecord.updateMany({
      where: { id: { in: records.map(record => record.id) } },
      data: { signatureRequestId: created.id }
    });
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
