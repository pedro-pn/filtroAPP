import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { RomaneioItemKind, RomaneioMeasureType } from '@prisma/client';
import { z } from 'zod';

import env from '../../config/env.js';
import asyncHandler from '../../lib/async-handler.js';
import { buildRomaneioCreatedEmailTemplate } from '../../lib/email-templates.js';
import {
  createAutomaticRomaneioStockMovementsInTransaction,
  reverseMovementInTransaction
} from '../../lib/estoque/stock-movements.js';
import { getMissingMailerConfig, sendMail } from '../../lib/mailer.js';
import { hasModuleRole } from '../../lib/module-roles.js';
import prisma from '../../lib/prisma.js';
import {
  CHECKLIST_ITEM_STATUSES,
  checklistItemStatusFromSnapshot,
  normalizeChecklistItemStatus,
  normalizeChecklistItems,
  normalizeChecklistDisplayMode,
  resolveChecklistCategoryName,
  resolveChecklistDisplayName,
  resolveEffectiveChecklist
} from '../../lib/equipamentos/equipment-checklist.js';
import { normalizeSignatureValue } from '../../lib/signature-image.js';
import { ensureRomaneioCatalogSynced } from '../../lib/romaneio-catalog.js';
import { buildRomaneioCatalogPdf } from '../../lib/romaneio-catalog-pdf.js';
import {
  saveRomaneioChecklistPdf,
  shouldRegenerateChecklistPdf
} from '../../lib/romaneio/romaneio-checklist-docx.js';
import { saveRomaneioDocx } from '../../lib/romaneio-docx.js';
import { convertDocxToPdf } from '../../lib/report-pdf-from-docx.js';
import { requireAuth, requireModuleRole } from '../../middleware/auth.js';

const router = Router();
const ROMANEIO_DRAFT_MODULE = 'romaneio';
const ROMANEIO_EMAIL_PENDING_STATUS = 'pendente';
const CHECKLIST_SIGNATURE_REQUIRED_MESSAGE = 'Assinatura do responsável é obrigatória para romaneios com checklist.';
const requireRomaneioAccess = requireModuleRole('romaneio:manager', 'romaneio:operator');
const cargoWeightUnits = ['kg', 'ton'];
export const ROMANEIO_TYPES = ['OUTBOUND', 'INBOUND'];
const ROMANEIO_TYPE_LABELS = {
  OUTBOUND: 'Saída',
  INBOUND: 'Entrada'
};
const ROMANEIO_QUANTITY_EPSILON = 0.0005;

export function requireRomaneioManager(req, res, next) {
  if (hasModuleRole(req.auth?.user, 'romaneio:manager')) {
    return next();
  }
  return res.status(403).json({ error: 'Acesso restrito ao gestor do romaneio.' });
}

export function requireRomaneioEditor(req, res, next) {
  if (['MANAGER', 'COORDINATOR'].includes(req.auth?.user?.role)) {
    return next();
  }
  return res.status(403).json({ error: 'Apenas gerente e coordenador podem editar romaneios.' });
}

export function requireRomaneioModuleAccess(req, res, next) {
  return requireRomaneioAccess(req, res, next);
}

const cargoWeightSchema = z.preprocess(value => {
  if (value === '' || value === null || value === undefined) return null;
  return value;
}, z.coerce.number().positive().nullable().optional());
const projectCodeSchema = z.string()
  .trim()
  .optional()
  .nullable()
  .refine(value => !value || /^\d+$/.test(value), {
    message: 'Informe apenas números no código do projeto.'
  });

const itemSchema = z.object({
  catalogItemId: z.string().optional().nullable(),
  itemName: z.string().trim().optional(),
  itemCode: z.string().trim().optional().nullable(),
  categoryName: z.string().trim().optional(),
  kind: z.nativeEnum(RomaneioItemKind).default('EQUIPMENT'),
  measureType: z.nativeEnum(RomaneioMeasureType).default('UNIT'),
  quantity: z.coerce.number().positive(),
  unitLabel: z.string().trim().optional(),
  isCustom: z.boolean().default(false),
  isExtra: z.boolean().default(false)
});

const checklistPayloadSchema = z.object({
  catalogItemId: z.string().trim().min(1),
  checkedTexts: z.array(z.string()).optional(),
  statuses: z.array(z.object({
    text: z.string().trim().min(1),
    status: z.enum(CHECKLIST_ITEM_STATUSES)
  })).optional()
});

const createRomaneioSchema = z.object({
  projectId: z.string().trim().optional().nullable(),
  projectCode: projectCodeSchema,
  type: z.enum(ROMANEIO_TYPES).default('OUTBOUND'),
  romaneioDate: z.string().min(1),
  driverName: z.string().trim().min(1),
  vehiclePlate: z.string().trim().min(1),
  cargoWeight: cargoWeightSchema,
  cargoWeightUnit: z.enum(cargoWeightUnits).default('kg'),
  items: z.array(itemSchema).min(1),
  checklists: z.array(checklistPayloadSchema).optional(),
  checklistSignatureImage: z.string().startsWith('data:image/').max(2_000_000).optional().nullable()
}).superRefine((data, ctx) => {
  if (!data.projectId && !data.projectCode) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['projectId'],
      message: 'Informe o projeto ou o código do projeto.'
    });
  }
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
  projectCode: projectCodeSchema,
  title: z.string().nullable().optional(),
  reportDate: z.string().nullable().optional(),
  payload: z.any()
});

const returnItemsQuerySchema = z.object({
  projectId: z.string().trim().optional().nullable(),
  projectCode: projectCodeSchema,
  excludeRomaneioId: z.string().trim().optional().nullable()
}).superRefine((data, ctx) => {
  if (!data.projectId && !data.projectCode) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['projectId'],
      message: 'Informe o projeto ou o código do projeto.'
    });
  }
});

const MANAGED_CATALOG_SOURCES = new Set(['UNIT', 'PARTICLE_COUNTER', 'EQUIPAMENTOS', 'STOCK']);
const romaneioProjectSelect = {
  id: true,
  code: true,
  name: true,
  clientName: true,
  isActive: true,
  managerOnly: true
};
const romaneioDocumentProjectSelect = {
  ...romaneioProjectSelect,
  clientCnpj: true,
  contractCode: true,
  location: true
};

export function romaneioProjectWhereForUser(user, projectWhere = {}) {
  const where = {
    ...projectWhere,
    deletedAt: null
  };
  if (user && user.role !== 'MANAGER') {
    where.isActive = true;
    where.managerOnly = false;
  }
  return where;
}

function baseRomaneioProjectWhereForUser(user, projectWhere = {}) {
  const where = {
    ...projectWhere,
    deletedAt: null
  };
  if (user && user.role !== 'MANAGER') {
    where.managerOnly = false;
  }
  return where;
}

function archivedWithoutInboundRomaneioWhere(excludeRomaneioId = null) {
  return {
    isActive: false,
    romaneios: {
      none: {
        type: 'INBOUND',
        ...(excludeRomaneioId ? { id: { not: excludeRomaneioId } } : {})
      }
    }
  };
}

function romaneioProjectLookupWhereForUser(user, projectWhere = {}, {
  allowArchivedWithoutInbound = false,
  excludeInboundRomaneioId = null
} = {}) {
  if (!allowArchivedWithoutInbound) return romaneioProjectWhereForUser(user, projectWhere);
  return {
    ...baseRomaneioProjectWhereForUser(user, projectWhere),
    OR: [
      { isActive: true },
      archivedWithoutInboundRomaneioWhere(excludeInboundRomaneioId)
    ]
  };
}

function romaneioProjectListWhereForUser(user, activeParam) {
  const where = baseRomaneioProjectWhereForUser(user);
  if (activeParam === 'true') {
    where.OR = [
      { isActive: true },
      archivedWithoutInboundRomaneioWhere()
    ];
    return where;
  }
  if (activeParam === 'false' && user?.role === 'MANAGER') {
    where.isActive = false;
    return where;
  }
  if (activeParam === 'false' && user?.role !== 'MANAGER') {
    where.id = '__NO_MATCH__';
    return where;
  }
  if (user && user.role !== 'MANAGER') {
    where.isActive = true;
  }
  return where;
}

async function assertRomaneioProjectAccess(projectId, authUser, client = prisma, options = {}) {
  if (!projectId) return null;
  return client.project.findFirst({
    where: romaneioProjectLookupWhereForUser(authUser, { id: projectId }, options),
    select: { id: true }
  });
}

function normalizeProjectCode(value) {
  return String(value || '').trim();
}

function isNumericProjectCode(value) {
  return /^\d+$/.test(value);
}

function pendingRomaneioProjectData(projectCode) {
  return {
    code: projectCode,
    name: '',
    isActive: true,
    visibleToCollaborators: false,
    managerOnly: false,
    registrationPending: true,
    inhibitionServiceEnabled: false,
    clientName: '',
    clientCnpj: '',
    clientEmailPrimary: '',
    clientEmailCc: [],
    clientSigners: [],
    contractCode: '',
    location: ''
  };
}

export async function resolveRomaneioProjectReference(payload, authUser, client = prisma, options = {}) {
  const projectId = String(payload?.projectId || '').trim();
  const projectCode = normalizeProjectCode(payload?.projectCode);
  if (projectCode && !isNumericProjectCode(projectCode)) return null;
  const projectWhere = projectId
    ? { id: projectId }
    : projectCode
      ? { code: { equals: projectCode, mode: 'insensitive' } }
      : null;
  if (!projectWhere) return null;

  const project = await client.project.findFirst({
    where: romaneioProjectLookupWhereForUser(authUser, projectWhere, options),
    select: { id: true }
  });
  if (project || projectId || !projectCode || !options.createPending) return project;

  const existingProjectWithCode = await client.project.findFirst({
    where: { code: { equals: projectCode, mode: 'insensitive' } },
    select: { id: true }
  });
  if (existingProjectWithCode) return null;

  try {
    return await client.project.create({
      data: pendingRomaneioProjectData(projectCode),
      select: { id: true }
    });
  } catch (error) {
    if (error?.code !== 'P2002') throw error;
    return client.project.findFirst({
      where: romaneioProjectLookupWhereForUser(authUser, { code: { equals: projectCode, mode: 'insensitive' } }, options),
      select: { id: true }
    });
  }
}

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

function romaneioCargoWeightData(payload) {
  const weight = payload.cargoWeight == null ? null : payload.cargoWeight;
  return {
    cargoWeight: weight,
    cargoWeightUnit: weight == null ? null : payload.cargoWeightUnit
  };
}

export function romaneioTypeLabel(type) {
  return ROMANEIO_TYPE_LABELS[type] || ROMANEIO_TYPE_LABELS.OUTBOUND;
}

function normalizeReturnKeyPart(value) {
  return String(value || '').trim().toLowerCase();
}

export function romaneioItemReturnKey(item) {
  if (item.catalogItemId) return `catalog:${item.catalogItemId}`;
  return [
    'snapshot',
    normalizeReturnKeyPart(item.itemCode),
    normalizeReturnKeyPart(item.itemName),
    normalizeReturnKeyPart(item.categoryName),
    item.kind || 'EQUIPMENT',
    item.measureType || 'UNIT',
    normalizeReturnKeyPart(item.unitLabel)
  ].join('|');
}

function numericQuantity(value) {
  const quantity = Number(value);
  return Number.isFinite(quantity) ? quantity : 0;
}

function itemSnapshot(item, key, sortOrder) {
  return {
    key,
    catalogItemId: item.catalogItemId || null,
    itemCode: item.itemCode || null,
    itemName: item.itemName,
    categoryName: item.categoryName,
    kind: item.kind || 'EQUIPMENT',
    measureType: item.measureType || 'UNIT',
    quantity: 0,
    maxQuantity: 0,
    unitLabel: item.unitLabel,
    isCustom: Boolean(item.isCustom),
    isExtra: false,
    sortOrder
  };
}

export function aggregateReturnableRomaneioItems(romaneios, { excludeRomaneioId = null } = {}) {
  const byKey = new Map();
  let sortOrder = 0;

  (romaneios || []).forEach(romaneio => {
    if (excludeRomaneioId && romaneio.id === excludeRomaneioId) return;
    const multiplier = (romaneio.type || 'OUTBOUND') === 'INBOUND' ? -1 : 1;
    (romaneio.items || []).forEach(item => {
      if (item.isExtra) return;
      const quantity = numericQuantity(item.quantity);
      if (quantity <= 0) return;
      const key = romaneioItemReturnKey(item);
      const existing = byKey.get(key);
      const entry = existing || itemSnapshot(item, key, sortOrder++);
      if (!existing || multiplier > 0) {
        Object.assign(entry, {
          catalogItemId: item.catalogItemId || null,
          itemCode: item.itemCode || null,
          itemName: item.itemName,
          categoryName: item.categoryName,
          kind: item.kind || 'EQUIPMENT',
          measureType: item.measureType || 'UNIT',
          unitLabel: item.unitLabel,
          isCustom: Boolean(item.isCustom)
        });
      }
      entry.maxQuantity += multiplier * quantity;
      entry.quantity = entry.maxQuantity;
      byKey.set(key, entry);
    });
  });

  return Array.from(byKey.values())
    .filter(item => item.maxQuantity > ROMANEIO_QUANTITY_EPSILON)
    .map(item => ({
      ...item,
      quantity: Number(item.quantity.toFixed(3)),
      maxQuantity: Number(item.maxQuantity.toFixed(3))
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function buildInboundRomaneioItems(inputItems, availableItems) {
  const availableByKey = new Map((availableItems || []).map(item => [romaneioItemReturnKey(item), item]));
  const requestedByKey = new Map();
  const extraItems = [];

  (inputItems || []).forEach((input, inputIndex) => {
    const quantity = numericQuantity(input.quantity);
    if (input.isExtra) {
      if (quantity <= 0) {
        const error = new Error('Quantidade de entrada inválida.');
        error.statusCode = 400;
        throw error;
      }
      extraItems.push({
        catalogItemId: input.catalogItemId || null,
        itemName: input.itemName,
        itemCode: input.itemCode || null,
        categoryName: input.categoryName,
        kind: input.kind || 'EQUIPMENT',
        measureType: input.measureType || 'UNIT',
        quantity: Number(quantity.toFixed(3)),
        unitLabel: input.unitLabel,
        isCustom: Boolean(input.isCustom),
        isExtra: true,
        sortOrder: inputIndex
      });
      return;
    }

    const key = romaneioItemReturnKey(input);
    const available = availableByKey.get(key);
    if (!available) {
      const error = new Error('Item de entrada não consta nas saídas disponíveis para esta missão.');
      error.statusCode = 400;
      throw error;
    }
    const current = requestedByKey.get(key);
    if (current) {
      current.quantity += quantity;
      return;
    }
    requestedByKey.set(key, { available, quantity, sortOrder: inputIndex });
  });

  return [
    ...Array.from(requestedByKey.values()).map(({ available, quantity, sortOrder }) => {
      if (quantity <= 0) {
        const error = new Error('Quantidade de entrada inválida.');
        error.statusCode = 400;
        throw error;
      }
      if (quantity - numericQuantity(available.maxQuantity) > ROMANEIO_QUANTITY_EPSILON) {
        const error = new Error('Quantidade de entrada maior que a quantidade disponível na saída.');
        error.statusCode = 400;
        throw error;
      }
      return {
        catalogItemId: available.catalogItemId || null,
        itemName: available.itemName,
        itemCode: available.itemCode || null,
        categoryName: available.categoryName,
        kind: available.kind,
        measureType: available.measureType,
        quantity: Number(quantity.toFixed(3)),
        unitLabel: available.unitLabel,
        isCustom: available.isCustom,
        isExtra: false,
        sortOrder
      };
    }),
    ...extraItems
  ]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((item, index) => ({ ...item, sortOrder: index }));
}

export async function getReturnableRomaneioItemsForProject(projectId, authUser, { excludeRomaneioId = null } = {}) {
  const romaneios = await prisma.romaneio.findMany({
    where: {
      projectId,
      project: romaneioProjectLookupWhereForUser(authUser, {}, {
        allowArchivedWithoutInbound: true,
        excludeInboundRomaneioId: excludeRomaneioId
      })
    },
    ...selectedFields(),
    orderBy: [{ romaneioDate: 'asc' }, { createdAt: 'asc' }]
  });
  return aggregateReturnableRomaneioItems(romaneios, { excludeRomaneioId });
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

async function removeStoredFile(publicUrl) {
  const targetPath = storagePathFromPublicUrl(publicUrl);
  if (!targetPath) return;
  await fs.unlink(targetPath).catch(() => undefined);
}

async function removeGeneratedRomaneioFiles(files) {
  const paths = [
    files?.docx?.targetPath,
    files?.pdf?.targetPath,
    files?.checklist?.targetPath,
    ...(files?.checklists || []).map(item => item.targetPath)
  ].filter(Boolean);
  await Promise.all(paths.map(filePath => fs.unlink(filePath).catch(() => undefined)));
}

function selectedFields() {
  return {
    include: {
      project: {
        select: romaneioDocumentProjectSelect
      },
      createdBy: {
        select: { id: true, name: true, email: true }
      },
      items: {
        orderBy: { sortOrder: 'asc' },
        include: { catalogItem: true }
      },
      checklists: {
        orderBy: { sortOrder: 'asc' }
      }
    }
  };
}

export function visibleRomaneioWhere(where = {}, authUser = null) {
  return {
    ...where,
    project: romaneioProjectWhereForUser(authUser, where.project || {})
  };
}

function romaneioDraftProjectWhere(user) {
  return {
    OR: [
      { projectId: null },
      { project: romaneioProjectWhereForUser(user) }
    ]
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
    projectCode: data.projectCode || null,
    reportDate: data.reportDate || null
  };
}

export async function buildRomaneioItems(inputItems, { allowedInactiveCatalogItemIds = [] } = {}) {
  const catalogIds = inputItems.map(item => item.catalogItemId).filter(Boolean);
  const allowedInactiveIds = [...new Set(allowedInactiveCatalogItemIds.filter(Boolean))];
  const catalogItems = catalogIds.length
    ? await prisma.romaneioCatalogItem.findMany({
        where: {
          id: { in: catalogIds },
          OR: [
            { isActive: true },
            ...(allowedInactiveIds.length ? [{ id: { in: allowedInactiveIds } }] : [])
          ]
        }
      })
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
      isExtra: Boolean(input.isExtra),
      sortOrder: index
    };
  });
}

async function hasSavedChecklistSignature(authUser, client = prisma) {
  if (!authUser?.collaboratorId) return false;
  const collaborator = await client.collaborator.findUnique({
    where: { id: authUser.collaboratorId },
    select: { signatureImage: true }
  });
  return Boolean(collaborator?.signatureImage);
}

export async function resolveChecklistSignatureImage(authUser, payloadSignatureImage, client = prisma) {
  if (payloadSignatureImage) return payloadSignatureImage;
  if (!authUser?.collaboratorId) return null;
  const collaborator = await client.collaborator.findUnique({
    where: { id: authUser.collaboratorId },
    select: { signatureImage: true }
  });
  return normalizeSignatureValue(collaborator?.signatureImage || null);
}

export async function resolveRequiredChecklistSignatureImage(authUser, payloadSignatureImage, fallbackSignatureImage = null, client = prisma) {
  if (payloadSignatureImage) return payloadSignatureImage;
  const fallbackSignature = await normalizeSignatureValue(fallbackSignatureImage || null);
  if (fallbackSignature) return fallbackSignature;
  const savedSignature = await resolveChecklistSignatureImage(authUser, null, client);
  if (savedSignature) return savedSignature;

  const error = new Error(CHECKLIST_SIGNATURE_REQUIRED_MESSAGE);
  error.statusCode = 400;
  throw error;
}

export async function buildRomaneioChecklistMap(client = prisma) {
  const catalogItems = await client.romaneioCatalogItem.findMany({
    where: {
      isActive: true,
      sourceType: { in: ['EQUIPAMENTOS', 'STOCK'] }
    },
    orderBy: [{ categoryName: 'asc' }, { code: 'asc' }, { name: 'asc' }]
  });
  const equipmentCatalogItems = catalogItems.filter(item => item.sourceType === 'EQUIPAMENTOS');
  const stockCatalogItems = catalogItems.filter(item => item.sourceType === 'STOCK');
  const equipmentIds = [...new Set(equipmentCatalogItems.map(item => item.sourceId).filter(Boolean))];
  const stockItemIds = [...new Set(stockCatalogItems.map(item => item.sourceId).filter(Boolean))];
  const equipmentRows = equipmentIds.length
    ? await client.companyEquipment.findMany({
        where: { id: { in: equipmentIds }, isActive: true },
        include: { category: true }
      })
    : [];
  const equipmentById = new Map(equipmentRows.map(item => [item.id, item]));
  const stockRows = stockItemIds.length
    ? await client.stockItem.findMany({
        where: {
          id: { in: stockItemIds },
          isActive: true
        },
        include: { category: true }
      })
    : [];
  const stockById = new Map(stockRows.map(item => [item.id, item]));
  const map = {};
  for (const catalogItem of catalogItems) {
    const equipment = catalogItem.sourceType === 'EQUIPAMENTOS' && catalogItem.sourceId
      ? equipmentById.get(catalogItem.sourceId)
      : null;
    const stockItem = catalogItem.sourceType === 'STOCK' && catalogItem.sourceId
      ? stockById.get(catalogItem.sourceId)
      : null;
    const category = equipment?.category || null;
    const stockCategory = stockItem?.category || null;
    const items = equipment
      ? resolveEffectiveChecklist(equipment, category)
      : (stockCategory
          ? (stockCategory.checklistEnabled
              ? normalizeChecklistItems(stockItem?.checklistItems ?? stockCategory.checklistItems)
              : [])
          : (stockItem?.checklistEnabled ? normalizeChecklistItems(stockItem.checklistItems) : []));
    if (!items.length) continue;
    const displayMode = normalizeChecklistDisplayMode(category?.checklistDisplayMode);
    const displayContext = { catalogItem, equipment, category: category || stockCategory };
    map[catalogItem.id] = {
      equipmentId: equipment?.id || stockItem?.id || catalogItem.sourceId || catalogItem.id,
      equipmentCode: equipment?.code || stockItem?.code || catalogItem.code || '',
      equipmentName: equipment?.name || stockItem?.name || catalogItem.name || '',
      categoryName: resolveChecklistCategoryName(displayContext),
      displayNameOrTag: resolveChecklistDisplayName({ ...displayContext, displayMode }),
      displayMode,
      items
    };
  }
  return map;
}

function checklistPayloadState(checklistPayloads = []) {
  return new Map(
    (Array.isArray(checklistPayloads) ? checklistPayloads : [])
      .filter(item => item?.catalogItemId)
      .map(item => {
        const statuses = new Map();
        for (const entry of Array.isArray(item.statuses) ? item.statuses : []) {
          const text = String(entry?.text || '').trim();
          if (text) statuses.set(text, normalizeChecklistItemStatus(entry.status));
        }
        const checkedTexts = Array.isArray(item.checkedTexts)
          ? new Set(item.checkedTexts.map(text => String(text)))
          : null;
        return [item.catalogItemId, {
          statuses,
          checkedTexts,
          hasLegacyCheckedTexts: Array.isArray(item.checkedTexts)
        }];
      })
  );
}

function checklistTextStatus(text, payloadState, defaultStatuses) {
  const key = String(text);
  if (payloadState?.statuses?.has(key)) return payloadState.statuses.get(key);
  if (payloadState?.hasLegacyCheckedTexts) return payloadState.checkedTexts?.has(key) ? 'CONFORME' : 'NAO_CONFORME';
  if (defaultStatuses?.has(key)) return defaultStatuses.get(key);
  return 'CONFORME';
}

export function buildRomaneioChecklistSnapshots(itemData, checklistMap, checklistPayloads = []) {
  const payloadByCatalogItemId = checklistPayloadState(checklistPayloads);

  return (itemData || []).flatMap((item, index) => {
    if (!item.catalogItemId) return [];
    const checklist = checklistMap[item.catalogItemId];
    if (!checklist?.items?.length) return [];
    const payloadState = payloadByCatalogItemId.get(item.catalogItemId);
    return [{
      catalogItemId: item.catalogItemId,
      equipmentId: checklist.equipmentId,
      equipmentCode: checklist.equipmentCode || item.itemCode || '',
      equipmentName: checklist.equipmentName || item.itemName || '',
      categoryName: checklist.categoryName || item.categoryName || '',
      displayNameOrTag: checklist.displayNameOrTag || resolveChecklistDisplayName({
        romaneioItem: item,
        displayMode: checklist.displayMode
      }),
      displayMode: normalizeChecklistDisplayMode(checklist.displayMode),
      items: checklist.items.map(text => {
        const status = checklistTextStatus(text, payloadState, checklist.defaultStatuses);
        return { text, status, checked: status === 'CONFORME' };
      }),
      sortOrder: index
    }];
  });
}

export function buildRomaneioChecklistUpdateSnapshots(itemData, existingChecklists = [], checklistMap = {}, checklistPayloads = []) {
  const mergedMap = { ...checklistMap };
  for (const checklist of existingChecklists || []) {
    if (!checklist.catalogItemId) continue;
    const items = Array.isArray(checklist.items) ? checklist.items : [];
    mergedMap[checklist.catalogItemId] = {
      equipmentId: checklist.equipmentId || '',
      equipmentCode: checklist.equipmentCode,
      equipmentName: checklist.equipmentName,
      categoryName: checklist.categoryName || '',
      displayNameOrTag: checklist.displayNameOrTag || checklist.equipmentCode || checklist.equipmentName || '',
      displayMode: normalizeChecklistDisplayMode(checklist.displayMode),
      items: items.map(item => item.text).filter(Boolean),
      defaultStatuses: new Map(items
        .filter(item => item?.text)
        .map(item => [item.text, checklistItemStatusFromSnapshot(item)]))
    };
  }
  return buildRomaneioChecklistSnapshots(itemData, mergedMap, checklistPayloads);
}

async function saveRomaneioChecklistPdfFile(romaneio, checklistSnapshots) {
  if (!checklistSnapshots?.length) return null;
  return saveRomaneioChecklistPdf(romaneio, checklistSnapshots);
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

async function notifyRecipients(romaneio, pdfPath, checklistPdfPaths = []) {
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
    romaneioType: romaneioTypeLabel(romaneio.type),
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
    attachments: [
      {
        filename: path.basename(pdfPath),
        path: pdfPath,
        contentType: 'application/pdf'
      },
      ...checklistPdfPaths.filter(Boolean).map(itemPath => ({
        filename: path.basename(itemPath),
        path: itemPath,
        contentType: 'application/pdf'
      }))
    ]
  });
  return { status: 'enviado', error: null };
}

export function romaneioEmailFailureResult(error) {
  return {
    status: 'erro no envio',
    error: String(error?.message || error || 'Falha ao enviar e-mail.').slice(0, 1000)
  };
}

function authUserLabel(user) {
  return String(user?.name || user?.email || user?.username || 'Conta autenticada').trim();
}

function stockMovementNoteForRomaneio(romaneio) {
  return `Movimentação automática do romaneio ${romaneioTypeLabel(romaneio.type).toLowerCase()} ${romaneio.id}.`;
}

async function createRomaneioStockMovements(tx, romaneio, authUser) {
  const stockItems = (romaneio.items || []).filter(item => item.catalogItem?.sourceType === 'STOCK');
  if (!stockItems.length) return [];

  const movements = [];
  for (const item of stockItems) {
    const created = await createAutomaticRomaneioStockMovementsInTransaction(tx, {
      romaneioType: romaneio.type,
      itemId: item.catalogItem.sourceId,
      quantity: item.quantity,
      date: romaneio.romaneioDate,
      projectId: romaneio.projectId,
      requestedBy: authUserLabel(authUser),
      notes: stockMovementNoteForRomaneio(romaneio),
      excludeFromProjectCost: romaneio.type === 'INBOUND' && item.isExtra,
      createdById: authUser.id,
      romaneioId: romaneio.id
    });
    movements.push(...created);
  }
  return movements;
}

async function reverseRomaneioStockMovements(tx, romaneioId, createdById) {
  if (typeof tx.stockMovement?.findMany !== 'function') return [];
  const movements = await tx.stockMovement.findMany({
    where: {
      romaneioId,
      reason: { not: 'ESTORNO' }
    },
    include: {
      reversedBy: { select: { id: true } }
    },
    orderBy: { createdAt: 'asc' }
  });
  const reversed = [];
  for (const movement of movements) {
    if (movement.reversedBy) continue;
    reversed.push(await reverseMovementInTransaction(tx, {
      movementId: movement.id,
      notes: `Estorno automático por edição do romaneio ${romaneioId}.`,
      createdById
    }));
  }
  return reversed;
}

export async function cleanupFailedRomaneioCreate({
  romaneioId,
  files,
  client = prisma
}) {
  const paths = [
    files?.docx?.targetPath,
    files?.pdf?.targetPath,
    files?.checklist?.targetPath,
    ...(files?.checklists || []).map(item => item.targetPath)
  ].filter(Boolean);
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
  const where = romaneioProjectListWhereForUser(req.auth.user, activeParam);
  const items = await prisma.project.findMany({
    where,
    select: {
      ...romaneioProjectSelect,
      operator: {
        select: { id: true, name: true, jobRoleId: true, jobRole: { select: { id: true, name: true } } }
      }
    },
    orderBy: [{ code: 'asc' }, { name: 'asc' }]
  });
  res.json(items.map(item => ({
    ...item,
    operator: item.operator ? { ...item.operator, role: item.operator.jobRole?.name || '' } : null
  })));
}));

router.get('/drafts', requireAuth, requireRomaneioAccess, asyncHandler(async (req, res) => {
  const items = await prisma.reportDraft.findMany({
    where: {
      ...romaneioDraftWhere(req.auth.user.id),
      ...romaneioDraftProjectWhere(req.auth.user)
    },
    include: {
      project: {
        select: romaneioProjectSelect
      }
    },
    orderBy: { updatedAt: 'desc' }
  });
  res.json(items);
}));

router.post('/drafts', requireAuth, requireRomaneioAccess, asyncHandler(async (req, res) => {
  const data = draftSchema.parse(req.body);
  const payload = normalizeDraftPayload(data);
  if (data.projectId) {
    const project = await assertRomaneioProjectAccess(data.projectId, req.auth.user, prisma, {
      allowArchivedWithoutInbound: data.payload?.romaneioType === 'INBOUND'
    });
    if (!project) return res.status(400).json({ error: 'Projeto inválido.' });
  }
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
    include: {
      project: {
        select: romaneioProjectSelect
      }
    }
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
  if (data.projectId) {
    const project = await assertRomaneioProjectAccess(data.projectId, req.auth.user, prisma, {
      allowArchivedWithoutInbound: data.payload?.romaneioType === 'INBOUND'
    });
    if (!project) return res.status(400).json({ error: 'Projeto inválido.' });
  }
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
    include: {
      project: {
        select: romaneioProjectSelect
      }
    }
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

router.get('/catalog/pdf', requireAuth, requireRomaneioAccess, asyncHandler(async (_req, res) => {
  await ensureRomaneioCatalogSynced();
  const items = await prisma.romaneioCatalogItem.findMany({
    where: { isActive: true },
    orderBy: [{ categoryName: 'asc' }, { code: 'asc' }, { name: 'asc' }]
  });
  const pdf = await buildRomaneioCatalogPdf(items);
  const fileName = `Lista de materiais romaneio ${new Date().toISOString().slice(0, 10)}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', contentDisposition(fileName));
  return res.send(pdf);
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
        sourceType: { in: Array.from(MANAGED_CATALOG_SOURCES) }
      }
    });
    if (rdoOwnedCount) {
      const error = new Error('Categorias com itens sincronizados devem ser alteradas no módulo de origem.');
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
    if (MANAGED_CATALOG_SOURCES.has(existing.sourceType)) {
      const error = new Error('Itens sincronizados devem ser alterados no módulo de origem.');
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
    const existing = await tx.romaneioCatalogItem.findUniqueOrThrow({ where: { id: req.params.id } });
    if (MANAGED_CATALOG_SOURCES.has(existing.sourceType)) {
      const error = new Error('Itens sincronizados devem ser removidos no módulo de origem.');
      error.statusCode = 409;
      throw error;
    }
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

router.get('/return-items', requireAuth, requireRomaneioAccess, asyncHandler(async (req, res) => {
  const query = returnItemsQuerySchema.parse(req.query);
  const project = await resolveRomaneioProjectReference(query, req.auth.user, prisma, {
    createPending: false,
    allowArchivedWithoutInbound: true,
    excludeInboundRomaneioId: query.excludeRomaneioId || null
  });
  if (!project) {
    return res.json({ projectId: null, items: [] });
  }
  const items = await getReturnableRomaneioItemsForProject(project.id, req.auth.user, {
    excludeRomaneioId: query.excludeRomaneioId || null
  });
  return res.json({ projectId: project.id, items });
}));

router.get('/checklist-map', requireAuth, requireRomaneioAccess, asyncHandler(async (req, res) => {
  await ensureRomaneioCatalogSynced();
  const [map, hasSavedSignature] = await Promise.all([
    buildRomaneioChecklistMap(),
    hasSavedChecklistSignature(req.auth.user)
  ]);
  res.json({ hasSavedSignature, map });
}));

async function ensureConsolidatedChecklistPdf(romaneio) {
  if (!romaneio.checklists?.length) return romaneio;
  const shouldGenerate = !romaneio.checklistPdfUrl || shouldRegenerateChecklistPdf(romaneio, romaneio);
  if (!shouldGenerate) return romaneio;

  const previousUrl = romaneio.checklistPdfUrl;
  try {
    const file = await saveRomaneioChecklistPdf(romaneio, romaneio.checklists);
    const updated = await prisma.romaneio.update({
      where: { id: romaneio.id },
      data: {
        checklistPdfUrl: file.publicUrl,
        checklistProjectLabel: file.projectLabel
      },
      ...selectedFields()
    });
    if (previousUrl && previousUrl !== file.publicUrl) {
      await removeStoredFile(previousUrl);
    }
    return updated;
  } catch (error) {
    console.error('Falha ao regenerar PDF consolidado do checklist do romaneio:', error);
    return romaneio;
  }
}

async function sendConsolidatedChecklistPdf(res, romaneio) {
  const current = await ensureConsolidatedChecklistPdf(romaneio);
  if (!current.checklists?.length) {
    return res.status(404).json({ error: 'Checklist não encontrado.' });
  }
  return sendRomaneioStoredFile(res, current, 'checklistPdfUrl', 'application/pdf', 'pdf');
}

router.get('/:id/checklist/pdf', requireAuth, requireRomaneioAccess, asyncHandler(async (req, res) => {
  const romaneio = await prisma.romaneio.findFirstOrThrow({
    where: visibleRomaneioWhere({ id: req.params.id }, req.auth.user),
    ...selectedFields()
  });
  return sendConsolidatedChecklistPdf(res, romaneio);
}));

router.get('/:id/checklists/:checklistId/pdf', requireAuth, requireRomaneioAccess, asyncHandler(async (req, res) => {
  const romaneio = await prisma.romaneio.findFirstOrThrow({
    where: visibleRomaneioWhere({ id: req.params.id }, req.auth.user),
    ...selectedFields()
  });
  const checklist = romaneio.checklists.find(item => item.id === req.params.checklistId);
  if (!checklist) return res.status(404).json({ error: 'Checklist não encontrado.' });
  return sendConsolidatedChecklistPdf(res, romaneio);
}));

router.get('/:id/pdf', requireAuth, requireRomaneioAccess, asyncHandler(async (req, res) => {
  const item = await prisma.romaneio.findFirstOrThrow({
    where: visibleRomaneioWhere({ id: req.params.id }, req.auth.user),
    ...selectedFields()
  });
  return sendRomaneioStoredFile(res, item, 'pdfUrl', 'application/pdf', 'pdf');
}));

router.get('/:id/docx', requireAuth, requireRomaneioAccess, asyncHandler(async (req, res) => {
  const item = await prisma.romaneio.findFirstOrThrow({
    where: visibleRomaneioWhere({ id: req.params.id }, req.auth.user),
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
  const where = visibleRomaneioWhere({}, req.auth.user);
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

router.get('/:id', requireAuth, requireRomaneioAccess, asyncHandler(async (req, res) => {
  const item = await prisma.romaneio.findFirstOrThrow({
    where: visibleRomaneioWhere({ id: req.params.id }, req.auth.user),
    ...selectedFields()
  });
  res.json(item);
}));

router.post('/', requireAuth, requireRomaneioAccess, asyncHandler(async (req, res) => {
  await ensureRomaneioCatalogSynced();
  const payload = createRomaneioSchema.parse(req.body);
  if (payload.type !== 'INBOUND' && payload.items.some(item => item.isExtra)) {
    return res.status(400).json({ error: 'Item extra só é permitido em romaneio de entrada.' });
  }

  const project = await resolveRomaneioProjectReference(payload, req.auth.user, prisma, {
    createPending: payload.type !== 'INBOUND',
    allowArchivedWithoutInbound: payload.type === 'INBOUND'
  });
  if (!project) return res.status(400).json({ error: 'Projeto inválido.' });
  const resolvedProjectId = project.id;

  const availableReturnItems = payload.type === 'INBOUND'
    ? await getReturnableRomaneioItemsForProject(resolvedProjectId, req.auth.user)
    : [];
  const itemData = payload.type === 'INBOUND'
    ? buildInboundRomaneioItems(
        await buildRomaneioItems(payload.items, {
          allowedInactiveCatalogItemIds: availableReturnItems.map(item => item.catalogItemId).filter(Boolean)
        }),
        availableReturnItems
      )
    : await buildRomaneioItems(payload.items);
  if (itemData.some(item => !item.itemName || !item.categoryName)) {
    return res.status(400).json({ error: 'Todos os itens precisam de nome e categoria.' });
  }
  const romaneioDate = parseDateOnly(payload.romaneioDate);
  const previewProject = await prisma.project.findUniqueOrThrow({
    where: { id: resolvedProjectId },
    select: romaneioDocumentProjectSelect
  });
  const preview = {
    id: 'preview',
    projectId: resolvedProjectId,
    project: previewProject,
    createdByUserId: req.auth.user.id,
    type: payload.type,
    romaneioDate,
    driverName: payload.driverName,
    vehiclePlate: payload.vehiclePlate.toUpperCase(),
    ...romaneioCargoWeightData(payload),
    items: itemData
  };
  const checklistMap = payload.type === 'OUTBOUND' ? await buildRomaneioChecklistMap() : {};
  const checklistSnapshots = payload.type === 'OUTBOUND'
    ? buildRomaneioChecklistSnapshots(itemData, checklistMap, payload.checklists)
    : [];
  if (checklistSnapshots.length) {
    preview.checklistResponsibleName = authUserLabel(req.auth.user);
    preview.checklistSignatureImage = await resolveRequiredChecklistSignatureImage(req.auth.user, payload.checklistSignatureImage);
    preview.checklists = checklistSnapshots;
  }

  let created = null;
  let files = null;
  let completed = false;
  let filesPersisted = false;
  try {
    files = await saveRomaneioPdf(preview);
    files.checklist = await saveRomaneioChecklistPdfFile(preview, checklistSnapshots);
    created = await prisma.$transaction(async tx => {
      const romaneio = await tx.romaneio.create({
        data: {
          projectId: resolvedProjectId,
          createdByUserId: req.auth.user.id,
          type: payload.type,
          romaneioDate,
          driverName: payload.driverName,
          vehiclePlate: payload.vehiclePlate.toUpperCase(),
          ...romaneioCargoWeightData(payload),
          docxUrl: files.docx.publicUrl,
          pdfUrl: files.pdf.publicUrl,
          checklistResponsibleName: checklistSnapshots.length ? preview.checklistResponsibleName : null,
          checklistSignatureImage: checklistSnapshots.length ? preview.checklistSignatureImage : null,
          checklistPdfUrl: files.checklist?.publicUrl || null,
          checklistProjectLabel: files.checklist?.projectLabel || null,
          emailStatus: ROMANEIO_EMAIL_PENDING_STATUS,
          emailError: null,
          items: { create: itemData },
          ...(checklistSnapshots.length ? {
            checklists: {
              create: checklistSnapshots.map(item => ({
                catalogItemId: item.catalogItemId,
                equipmentId: item.equipmentId,
                equipmentCode: item.equipmentCode,
                equipmentName: item.equipmentName,
                categoryName: item.categoryName,
                displayNameOrTag: item.displayNameOrTag,
                displayMode: item.displayMode,
                items: item.items,
                sortOrder: item.sortOrder
              }))
            }
          } : {})
        },
        ...selectedFields()
      });
      await createRomaneioStockMovements(tx, romaneio, req.auth.user);
      return romaneio;
    });
    filesPersisted = true;

    let emailResult;
    try {
      emailResult = await notifyRecipients(created, files.pdf.targetPath, [files.checklist?.targetPath]);
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

router.put('/:id', requireAuth, requireRomaneioAccess, requireRomaneioEditor, asyncHandler(async (req, res) => {
  await ensureRomaneioCatalogSynced();
  const payload = createRomaneioSchema.parse(req.body);
  if (payload.type !== 'INBOUND' && payload.items.some(item => item.isExtra)) {
    return res.status(400).json({ error: 'Item extra só é permitido em romaneio de entrada.' });
  }
  const existing = await prisma.romaneio.findFirstOrThrow({
    where: visibleRomaneioWhere({ id: req.params.id }, req.auth.user),
    ...selectedFields()
  });

  const project = await resolveRomaneioProjectReference(payload, req.auth.user, prisma, {
    createPending: payload.type !== 'INBOUND',
    allowArchivedWithoutInbound: payload.type === 'INBOUND',
    excludeInboundRomaneioId: existing.id
  });
  if (!project) return res.status(400).json({ error: 'Projeto inválido.' });
  const resolvedProjectId = project.id;

  const availableReturnItems = payload.type === 'INBOUND'
    ? await getReturnableRomaneioItemsForProject(resolvedProjectId, req.auth.user, {
        excludeRomaneioId: existing.id
      })
    : [];
  const allowedInactiveCatalogItemIds = [
    ...existing.items.map(item => item.catalogItemId).filter(Boolean),
    ...availableReturnItems.map(item => item.catalogItemId).filter(Boolean)
  ];
  const itemData = payload.type === 'INBOUND'
    ? buildInboundRomaneioItems(
        await buildRomaneioItems(payload.items, { allowedInactiveCatalogItemIds }),
        availableReturnItems
      )
    : await buildRomaneioItems(payload.items, { allowedInactiveCatalogItemIds });
  if (itemData.some(item => !item.itemName || !item.categoryName)) {
    return res.status(400).json({ error: 'Todos os itens precisam de nome e categoria.' });
  }

  const preview = {
    ...existing,
    projectId: resolvedProjectId,
    project: resolvedProjectId === existing.projectId
      ? existing.project
      : await prisma.project.findUniqueOrThrow({ where: { id: resolvedProjectId }, select: romaneioDocumentProjectSelect }),
    type: payload.type,
    romaneioDate: parseDateOnly(payload.romaneioDate),
    driverName: payload.driverName,
    vehiclePlate: payload.vehiclePlate.toUpperCase(),
    ...romaneioCargoWeightData(payload),
    items: itemData
  };
  const checklistMap = payload.type === 'OUTBOUND' ? await buildRomaneioChecklistMap() : {};
  const checklistSnapshots = payload.type === 'OUTBOUND'
    ? buildRomaneioChecklistUpdateSnapshots(itemData, existing.checklists, checklistMap, payload.checklists)
    : [];
  if (checklistSnapshots.length) {
    preview.checklistResponsibleName = existing.checklistResponsibleName || authUserLabel(req.auth.user);
    preview.checklistSignatureImage = await resolveRequiredChecklistSignatureImage(
      req.auth.user,
      payload.checklistSignatureImage,
      existing.checklistSignatureImage
    );
    preview.checklists = checklistSnapshots;
  } else {
    preview.checklistResponsibleName = null;
    preview.checklistSignatureImage = null;
    preview.checklists = [];
  }

  let files = null;
  try {
    files = await saveRomaneioPdf(preview);
    files.checklist = await saveRomaneioChecklistPdfFile(preview, checklistSnapshots);
    const updated = await prisma.$transaction(async tx => {
      await reverseRomaneioStockMovements(tx, existing.id, req.auth.user.id);
      await tx.romaneioItem.deleteMany({ where: { romaneioId: existing.id } });
      await tx.romaneioChecklist.deleteMany({ where: { romaneioId: existing.id } });
      const romaneio = await tx.romaneio.update({
        where: { id: existing.id },
        data: {
          projectId: resolvedProjectId,
          type: payload.type,
          romaneioDate: preview.romaneioDate,
          driverName: payload.driverName,
          vehiclePlate: payload.vehiclePlate.toUpperCase(),
          ...romaneioCargoWeightData(payload),
          docxUrl: files.docx.publicUrl,
          pdfUrl: files.pdf.publicUrl,
          checklistResponsibleName: checklistSnapshots.length ? preview.checklistResponsibleName : null,
          checklistSignatureImage: checklistSnapshots.length ? preview.checklistSignatureImage : null,
          checklistPdfUrl: files.checklist?.publicUrl || null,
          checklistProjectLabel: files.checklist?.projectLabel || null,
          items: { create: itemData },
          ...(checklistSnapshots.length ? {
            checklists: {
              create: checklistSnapshots.map(item => ({
                catalogItemId: item.catalogItemId,
                equipmentId: item.equipmentId,
                equipmentCode: item.equipmentCode,
                equipmentName: item.equipmentName,
                categoryName: item.categoryName,
                displayNameOrTag: item.displayNameOrTag,
                displayMode: item.displayMode,
                items: item.items,
                sortOrder: item.sortOrder
              }))
            }
          } : {})
        },
        ...selectedFields()
      });
      await createRomaneioStockMovements(tx, romaneio, req.auth.user);
      return romaneio;
    });

    await Promise.all([
      existing.docxUrl && existing.docxUrl !== files.docx.publicUrl ? removeStoredFile(existing.docxUrl) : undefined,
      existing.pdfUrl && existing.pdfUrl !== files.pdf.publicUrl ? removeStoredFile(existing.pdfUrl) : undefined,
      existing.checklistPdfUrl && existing.checklistPdfUrl !== files.checklist?.publicUrl ? removeStoredFile(existing.checklistPdfUrl) : undefined,
      ...(existing.checklists || [])
        .filter(checklist => checklist.pdfUrl)
        .map(checklist => removeStoredFile(checklist.pdfUrl))
    ]);

    res.json(updated);
  } catch (error) {
    await removeGeneratedRomaneioFiles(files);
    throw error;
  }
}));

export default router;
