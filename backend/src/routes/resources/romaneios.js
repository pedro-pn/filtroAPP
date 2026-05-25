import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { RomaneioItemKind, RomaneioMeasureType } from '@prisma/client';
import { z } from 'zod';

import env from '../../config/env.js';
import asyncHandler from '../../lib/async-handler.js';
import { buildRomaneioCreatedEmailTemplate } from '../../lib/email-templates.js';
import { getMissingMailerConfig, sendMail } from '../../lib/mailer.js';
import { hasModuleRole } from '../../lib/module-roles.js';
import prisma from '../../lib/prisma.js';
import { syncRomaneioCatalog } from '../../lib/romaneio-catalog.js';
import { saveRomaneioDocx } from '../../lib/romaneio-docx.js';
import { convertDocxToPdf } from '../../lib/report-pdf-from-docx.js';
import { requireAuth, requireModuleRole } from '../../middleware/auth.js';

const router = Router();
const ROMANEIO_DRAFT_MODULE = 'romaneio';
const ROMANEIO_EMAIL_PENDING_STATUS = 'pendente';
const requireRomaneioAccess = requireModuleRole('romaneio:manager', 'romaneio:operator');

export function requireRomaneioManager(req, res, next) {
  if (hasModuleRole(req.auth?.user, 'romaneio:manager')) {
    return next();
  }
  return res.status(403).json({ error: 'Acesso restrito ao gestor do romaneio.' });
}

export function requireRomaneioModuleAccess(req, res, next) {
  return requireRomaneioAccess(req, res, next);
}

const itemSchema = z.object({
  catalogItemId: z.string().optional().nullable(),
  itemName: z.string().trim().optional(),
  itemCode: z.string().trim().optional().nullable(),
  categoryName: z.string().trim().optional(),
  kind: z.nativeEnum(RomaneioItemKind).default('EQUIPMENT'),
  measureType: z.nativeEnum(RomaneioMeasureType).default('UNIT'),
  quantity: z.coerce.number().positive(),
  unitLabel: z.string().trim().optional(),
  isCustom: z.boolean().default(false)
});

const createRomaneioSchema = z.object({
  projectId: z.string().min(1),
  romaneioDate: z.string().min(1),
  driverName: z.string().trim().min(1),
  vehiclePlate: z.string().trim().min(1),
  items: z.array(itemSchema).min(1)
});

const catalogSchema = z.object({
  code: z.string().trim().optional().nullable(),
  name: z.string().trim().min(1),
  categoryName: z.string().trim().min(1),
  kind: z.nativeEnum(RomaneioItemKind).default('EQUIPMENT'),
  measureType: z.nativeEnum(RomaneioMeasureType).default('UNIT'),
  defaultUnitLabel: z.string().trim().min(1).default('unidade'),
  isSerialized: z.boolean().default(true),
  isActive: z.boolean().default(true)
});

const catalogCategoryRenameSchema = z.object({
  currentName: z.string().trim().min(1),
  newName: z.string().trim().min(1)
});

const recipientSchema = z.object({
  name: z.string().trim().optional().nullable(),
  email: z.string().trim().email(),
  isActive: z.boolean().default(true)
});

const draftSchema = z.object({
  id: z.string().optional(),
  projectId: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  reportDate: z.string().nullable().optional(),
  payload: z.any()
});

const RDO_OWNED_CATALOG_SOURCES = new Set(['UNIT', 'PARTICLE_COUNTER']);

function parseDateOnly(value) {
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00.000-03:00`);
  if (Number.isNaN(date.getTime())) {
    const error = new z.ZodError([{
      code: z.ZodIssueCode.custom,
      path: ['romaneioDate'],
      message: 'Data inválida.'
    }]);
    throw error;
  }
  return date;
}

function formatDatePt(value, withTime = false) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {})
  });
}

function contentDisposition(fileName) {
  const ascii = fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ._\-]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function storagePathFromPublicUrl(publicUrl) {
  const raw = String(publicUrl || '');
  if (!raw.startsWith('/relatorios/')) return null;
  const relative = decodeURIComponent(raw.slice('/relatorios/'.length));
  const targetPath = path.resolve(env.uploadDir, relative);
  const root = path.resolve(env.uploadDir);
  if (targetPath !== root && !targetPath.startsWith(`${root}${path.sep}`)) return null;
  return targetPath;
}

async function sendRomaneioStoredFile(res, romaneio, field, contentType, fallbackExtension) {
  const publicUrl = romaneio[field];
  const targetPath = storagePathFromPublicUrl(publicUrl);
  if (!targetPath) {
    return res.status(404).json({ error: 'Arquivo do romaneio não encontrado.' });
  }
  let buffer;
  try {
    buffer = await fs.readFile(targetPath);
  } catch {
    return res.status(404).json({ error: 'Arquivo do romaneio não encontrado.' });
  }
  const fileName = path.basename(targetPath) || `romaneio-${romaneio.id}.${fallbackExtension}`;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', contentDisposition(fileName));
  return res.send(buffer);
}

function selectedFields() {
  return {
    include: {
      project: true,
      createdBy: {
        select: { id: true, name: true, email: true }
      },
      items: {
        orderBy: { sortOrder: 'asc' },
        include: { catalogItem: true }
      }
    }
  };
}

export function visibleRomaneioWhere(where = {}) {
  return {
    ...where,
    project: {
      ...(where.project || {}),
      deletedAt: null
    }
  };
}

function romaneioDraftWhere(userId) {
  return {
    userId,
    payload: {
      path: ['__module'],
      equals: ROMANEIO_DRAFT_MODULE
    }
  };
}

function normalizeDraftPayload(data) {
  return {
    ...(data.payload && typeof data.payload === 'object' ? data.payload : {}),
    __module: ROMANEIO_DRAFT_MODULE,
    projectId: data.projectId || null,
    reportDate: data.reportDate || null
  };
}

async function buildRomaneioItems(inputItems) {
  const catalogIds = inputItems.map(item => item.catalogItemId).filter(Boolean);
  const catalogItems = catalogIds.length
    ? await prisma.romaneioCatalogItem.findMany({ where: { id: { in: catalogIds }, isActive: true } })
    : [];
  const byId = new Map(catalogItems.map(item => [item.id, item]));

  return inputItems.map((input, index) => {
    const catalog = input.catalogItemId ? byId.get(input.catalogItemId) : null;
    if (input.catalogItemId && !catalog) {
      const error = new Error('Item do catálogo inválido ou inativo.');
      error.statusCode = 400;
      throw error;
    }
    const measureType = catalog?.measureType || input.measureType;
    const unitLabel = input.unitLabel || catalog?.defaultUnitLabel || (measureType === 'WEIGHT' ? 'kg' : measureType === 'LENGTH' ? 'm' : 'unidade');
    return {
      catalogItemId: catalog?.id || null,
      itemName: catalog?.name || input.itemName,
      itemCode: catalog?.code || input.itemCode || null,
      categoryName: catalog?.categoryName || input.categoryName,
      kind: catalog?.kind || input.kind,
      measureType,
      quantity: input.quantity,
      unitLabel,
      isCustom: !catalog || input.isCustom,
      sortOrder: index
    };
  });
}

async function saveRomaneioPdf(romaneio) {
  const docx = await saveRomaneioDocx(romaneio);
  const pdfFileName = docx.fileName.replace(/\.docx$/i, '.pdf');
  const pdfPath = path.join(path.dirname(docx.targetPath), pdfFileName);
  await convertDocxToPdf(docx.targetPath, pdfPath);
  return {
    docx,
    pdf: {
      fileName: pdfFileName,
      targetPath: pdfPath,
      publicUrl: docx.publicUrl.replace(/\.docx$/i, '.pdf')
    }
  };
}

async function notifyRecipients(romaneio, pdfPath) {
  const recipients = await prisma.romaneioNotificationRecipient.findMany({
    where: { isActive: true },
    orderBy: { email: 'asc' }
  });
  if (!recipients.length) return { status: 'sem destinatarios', error: null };

  const missing = getMissingMailerConfig();
  if (missing.length) {
    return { status: 'nao enviado', error: `Configuração SMTP ausente: ${missing.join(', ')}` };
  }

  const categoryMap = new Map();
  (romaneio.items || []).forEach(item => {
    const categoryName = item.categoryName || 'Itens';
    categoryMap.set(categoryName, (categoryMap.get(categoryName) || 0) + 1);
  });
  const template = buildRomaneioCreatedEmailTemplate({
    projectCode: romaneio.project?.code || '',
    projectName: romaneio.project?.name || '',
    clientName: romaneio.project?.clientName || '',
    romaneioDate: formatDatePt(romaneio.romaneioDate, true),
    driverName: romaneio.driverName || '',
    vehiclePlate: romaneio.vehiclePlate || '',
    itemCount: romaneio.items?.length || 0,
    categorySummary: Array.from(categoryMap.entries()).map(([categoryName, count]) => ({ categoryName, count })),
    appUrl: env.appUrl
  });

  await sendMail({
    to: recipients.map(item => item.email).join(', '),
    subject: template.subject,
    text: template.text,
    html: template.html,
    attachments: [{
      filename: path.basename(pdfPath),
      path: pdfPath,
      contentType: 'application/pdf'
    }]
  });
  return { status: 'enviado', error: null };
}

export function romaneioEmailFailureResult(error) {
  return {
    status: 'erro no envio',
    error: String(error?.message || error || 'Falha ao enviar e-mail.').slice(0, 1000)
  };
}

export async function cleanupFailedRomaneioCreate({
  romaneioId,
  files,
  client = prisma
}) {
  const paths = [files?.docx?.targetPath, files?.pdf?.targetPath].filter(Boolean);
  await Promise.all(paths.map(filePath => fs.rm(filePath, { force: true }).catch(() => undefined)));
  if (romaneioId) {
    await client.romaneio.delete({ where: { id: romaneioId } }).catch(() => undefined);
  }
}

export function shouldCleanupFailedRomaneioCreate({ completed = false, filesPersisted = false } = {}) {
  return !completed && !filesPersisted;
}

router.get('/projects', requireAuth, requireRomaneioAccess, asyncHandler(async (req, res) => {
  const activeParam = req.query.active;
  const where = { deletedAt: null };
  if (activeParam === 'true') where.isActive = true;
  if (activeParam === 'false') where.isActive = false;
  const items = await prisma.project.findMany({
    where,
    include: { operator: true },
    orderBy: [{ code: 'asc' }, { name: 'asc' }]
  });
  res.json(items);
}));

router.get('/drafts', requireAuth, requireRomaneioAccess, asyncHandler(async (req, res) => {
  const items = await prisma.reportDraft.findMany({
    where: romaneioDraftWhere(req.auth.user.id),
    include: { project: true },
    orderBy: { updatedAt: 'desc' }
  });
  res.json(items);
}));

router.post('/drafts', requireAuth, requireRomaneioAccess, asyncHandler(async (req, res) => {
  const data = draftSchema.parse(req.body);
  const payload = normalizeDraftPayload(data);
  if (data.projectId && data.reportDate) {
    await prisma.reportDraft.deleteMany({
      where: {
        ...romaneioDraftWhere(req.auth.user.id),
        projectId: data.projectId,
        reportDate: data.reportDate
      }
    });
  }
  const item = await prisma.reportDraft.create({
    data: {
      userId: req.auth.user.id,
      projectId: data.projectId || null,
      title: data.title || null,
      reportDate: data.reportDate || null,
      payload
    },
    include: { project: true }
  });
  res.status(201).json(item);
}));

router.put('/drafts/:id', requireAuth, requireRomaneioAccess, asyncHandler(async (req, res) => {
  const data = draftSchema.omit({ id: true }).parse(req.body);
  const current = await prisma.reportDraft.findUniqueOrThrow({ where: { id: req.params.id } });
  if (current.userId !== req.auth.user.id || current.payload?.__module !== ROMANEIO_DRAFT_MODULE) {
    return res.status(403).json({ error: 'Você não tem permissão para alterar este rascunho.' });
  }
  const payload = normalizeDraftPayload(data);
  if (data.projectId && data.reportDate) {
    await prisma.reportDraft.deleteMany({
      where: {
        ...romaneioDraftWhere(req.auth.user.id),
        projectId: data.projectId,
        reportDate: data.reportDate,
        id: { not: req.params.id }
      }
    });
  }
  const item = await prisma.reportDraft.update({
    where: { id: req.params.id },
    data: {
      projectId: data.projectId || null,
      title: data.title || null,
      reportDate: data.reportDate || null,
      payload
    },
    include: { project: true }
  });
  res.json(item);
}));

router.delete('/drafts/:id', requireAuth, requireRomaneioAccess, asyncHandler(async (req, res) => {
  const current = await prisma.reportDraft.findUniqueOrThrow({ where: { id: req.params.id } });
  if (current.userId !== req.auth.user.id || current.payload?.__module !== ROMANEIO_DRAFT_MODULE) {
    return res.status(403).json({ error: 'Você não tem permissão para excluir este rascunho.' });
  }
  await prisma.reportDraft.delete({ where: { id: req.params.id } });
  res.status(204).end();
}));

router.get('/catalog', requireAuth, requireRomaneioAccess, asyncHandler(async (_req, res) => {
  const items = await prisma.romaneioCatalogItem.findMany({
    where: { isActive: true },
    orderBy: [{ categoryName: 'asc' }, { code: 'asc' }, { name: 'asc' }]
  });
  res.json(items);
}));

router.post('/catalog', requireAuth, requireRomaneioAccess, requireRomaneioManager, asyncHandler(async (req, res) => {
  const data = catalogSchema.parse(req.body);
  const item = await prisma.romaneioCatalogItem.create({
    data: {
      ...data,
      sourceType: 'MANUAL',
      sourceId: null,
      code: data.code || null
    }
  });
  res.status(201).json(item);
}));

router.put('/catalog/categories', requireAuth, requireRomaneioAccess, requireRomaneioManager, asyncHandler(async (req, res) => {
  const data = catalogCategoryRenameSchema.parse(req.body);
  const result = await prisma.$transaction(async tx => {
    const rdoOwnedCount = await tx.romaneioCatalogItem.count({
      where: {
        categoryName: data.currentName,
        sourceType: { in: Array.from(RDO_OWNED_CATALOG_SOURCES) }
      }
    });
    if (rdoOwnedCount) {
      const error = new Error('Categorias com itens sincronizados do RDO devem ser alteradas no módulo RDO.');
      error.statusCode = 409;
      throw error;
    }

    const update = await tx.romaneioCatalogItem.updateMany({
      where: { categoryName: data.currentName },
      data: { categoryName: data.newName }
    });
    return { categoryName: data.newName, updatedCount: update.count };
  });
  res.json(result);
}));

router.put('/catalog/:id', requireAuth, requireRomaneioAccess, requireRomaneioManager, asyncHandler(async (req, res) => {
  const data = catalogSchema.partial().parse(req.body);
  const item = await prisma.$transaction(async tx => {
    const existing = await tx.romaneioCatalogItem.findUniqueOrThrow({ where: { id: req.params.id } });
    if (RDO_OWNED_CATALOG_SOURCES.has(existing.sourceType)) {
      const error = new Error('Itens sincronizados do RDO devem ser alterados no módulo RDO.');
      error.statusCode = 409;
      throw error;
    }
    const payload = {
      ...data,
      code: data.code === undefined ? undefined : data.code || null
    };

    return tx.romaneioCatalogItem.update({
      where: { id: req.params.id },
      data: payload
    });
  });
  res.json(item);
}));

router.delete('/catalog/:id', requireAuth, requireRomaneioAccess, requireRomaneioManager, asyncHandler(async (req, res) => {
  await prisma.$transaction(async tx => {
    await tx.romaneioCatalogItem.findUniqueOrThrow({ where: { id: req.params.id } });
    await tx.romaneioCatalogItem.update({
      where: { id: req.params.id },
      data: { isActive: false, hiddenInRomaneioAt: new Date() }
    });
  });
  res.status(204).send();
}));

router.get('/notifications', requireAuth, requireRomaneioAccess, requireRomaneioManager, asyncHandler(async (_req, res) => {
  const items = await prisma.romaneioNotificationRecipient.findMany({ orderBy: { email: 'asc' } });
  res.json(items);
}));

router.post('/notifications', requireAuth, requireRomaneioAccess, requireRomaneioManager, asyncHandler(async (req, res) => {
  const data = recipientSchema.parse(req.body);
  const item = await prisma.romaneioNotificationRecipient.upsert({
    where: { email: data.email.toLowerCase() },
    create: { ...data, email: data.email.toLowerCase() },
    update: { ...data, email: data.email.toLowerCase() }
  });
  res.status(201).json(item);
}));

router.delete('/notifications/:id', requireAuth, requireRomaneioAccess, requireRomaneioManager, asyncHandler(async (req, res) => {
  await prisma.romaneioNotificationRecipient.update({
    where: { id: req.params.id },
    data: { isActive: false }
  });
  res.status(204).send();
}));

router.get('/:id/pdf', requireAuth, requireRomaneioAccess, asyncHandler(async (req, res) => {
  const item = await prisma.romaneio.findFirstOrThrow({
    where: visibleRomaneioWhere({ id: req.params.id }),
    ...selectedFields()
  });
  return sendRomaneioStoredFile(res, item, 'pdfUrl', 'application/pdf', 'pdf');
}));

router.get('/:id/docx', requireAuth, requireRomaneioAccess, asyncHandler(async (req, res) => {
  const item = await prisma.romaneio.findFirstOrThrow({
    where: visibleRomaneioWhere({ id: req.params.id }),
    ...selectedFields()
  });
  return sendRomaneioStoredFile(
    res,
    item,
    'docxUrl',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'docx'
  );
}));

router.get('/', requireAuth, requireRomaneioAccess, asyncHandler(async (req, res) => {
  const search = String(req.query.search || '').trim();
  const projectId = String(req.query.projectId || '').trim();
  const where = visibleRomaneioWhere();
  if (projectId) where.projectId = projectId;
  if (search) {
    where.OR = [
      { driverName: { contains: search, mode: 'insensitive' } },
      { vehiclePlate: { contains: search, mode: 'insensitive' } },
      { project: { code: { contains: search, mode: 'insensitive' } } },
      { project: { name: { contains: search, mode: 'insensitive' } } },
      { items: { some: { itemName: { contains: search, mode: 'insensitive' } } } },
      { items: { some: { itemCode: { contains: search, mode: 'insensitive' } } } }
    ];
  }

  const items = await prisma.romaneio.findMany({
    where,
    ...selectedFields(),
    orderBy: [{ romaneioDate: 'desc' }, { createdAt: 'desc' }]
  });
  res.json(items);
}));

router.post('/', requireAuth, requireRomaneioAccess, asyncHandler(async (req, res) => {
  await syncRomaneioCatalog();
  const payload = createRomaneioSchema.parse(req.body);
  const project = await prisma.project.findFirst({
    where: { id: payload.projectId, deletedAt: null },
    select: { id: true }
  });
  if (!project) return res.status(400).json({ error: 'Projeto inválido.' });

  const itemData = await buildRomaneioItems(payload.items);
  if (itemData.some(item => !item.itemName || !item.categoryName)) {
    return res.status(400).json({ error: 'Todos os itens precisam de nome e categoria.' });
  }

  let created = null;
  let files = null;
  let completed = false;
  let filesPersisted = false;
  try {
    created = await prisma.romaneio.create({
      data: {
        projectId: payload.projectId,
        createdByUserId: req.auth.user.id,
        romaneioDate: parseDateOnly(payload.romaneioDate),
        driverName: payload.driverName,
        vehiclePlate: payload.vehiclePlate.toUpperCase(),
        items: { create: itemData }
      },
      ...selectedFields()
    });

    files = await saveRomaneioPdf(created);
    created = await prisma.romaneio.update({
      where: { id: created.id },
      data: {
        docxUrl: files.docx.publicUrl,
        pdfUrl: files.pdf.publicUrl,
        emailStatus: ROMANEIO_EMAIL_PENDING_STATUS,
        emailError: null
      },
      ...selectedFields()
    });
    filesPersisted = true;

    let emailResult;
    try {
      emailResult = await notifyRecipients(created, files.pdf.targetPath);
    } catch (error) {
      emailResult = romaneioEmailFailureResult(error);
    }

    created = await prisma.romaneio.update({
      where: { id: created.id },
      data: {
        emailStatus: emailResult.status,
        emailError: emailResult.error
      },
      ...selectedFields()
    });
    completed = true;
  } catch (error) {
    if (shouldCleanupFailedRomaneioCreate({ completed, filesPersisted })) {
      await cleanupFailedRomaneioCreate({ romaneioId: created?.id, files });
    }
    throw error;
  }

  res.status(201).json(created);
}));

export default router;
