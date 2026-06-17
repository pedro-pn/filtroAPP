import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import {
  createEquipmentAttachment,
  equipmentAttachmentsInclude,
  withCurrentAttachments,
  EquipmentAttachmentKinds
} from '../../lib/equipment-attachments.js';
import { normalizeFieldSchema, slugifySystemKey } from '../../lib/equipment-categories.js';
import { getSlot, resolveRdoSlotMap } from '../../lib/rdo-equipment-slots.js';
import prisma from '../../lib/prisma.js';
import {
  clearEquipmentModuleCaches,
  clearRomaneioCatalogDependentCaches
} from '../../lib/resource-list-cache.js';
import { syncRomaneioCatalog } from '../../lib/romaneio-catalog.js';
import {
  requireAuth,
  requireEquipamentosAccess,
  requireEquipamentosManager
} from '../../middleware/auth.js';

const router = Router();
router.use(requireAuth);
router.use(requireEquipamentosAccess);

const pdfUploadSchema = z.object({
  fileName: z.string().min(1),
  mimeType: z.string().optional(),
  dataUrl: z.string().min(1)
}).optional().nullable();

const fieldDefinitionSchema = z.object({
  key: z.string().optional(),
  label: z.string().trim().min(1),
  type: z.enum(['text', 'number', 'date', 'select', 'textarea']).optional(),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  order: z.number().optional(),
  showInDashboard: z.boolean().optional()
});

const categorySchema = z.object({
  name: z.string().trim().min(1),
  order: z.number().int().optional(),
  fieldSchema: z.array(fieldDefinitionSchema).optional(),
  supportsCalibration: z.boolean().optional(),
  supportsTechnicalDoc: z.boolean().optional(),
  syncToRomaneio: z.boolean().optional()
});

const equipmentSchema = z.object({
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  categoryId: z.string().trim().min(1),
  attributes: z.record(z.any()).optional(),
  hasCalibration: z.boolean().optional(),
  calibratedAt: z.string().optional().nullable(),
  expiresAt: z.string().optional().nullable(),
  hasTechnicalDoc: z.boolean().optional(),
  calibrationCertificate: pdfUploadSchema,
  technicalDoc: pdfUploadSchema
});

async function uniqueSystemKey(name) {
  const base = slugifySystemKey(name);
  let candidate = base;
  let suffix = 1;
  // eslint-disable-next-line no-await-in-loop
  while (await prisma.equipmentCategory.findUnique({ where: { systemKey: candidate } })) {
    suffix += 1;
    candidate = `${base}_${suffix}`;
  }
  return candidate;
}

function invalidateCaches() {
  clearEquipmentModuleCaches();
  clearRomaneioCatalogDependentCaches();
}

function normalizeCategoryName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

// Ao criar uma categoria que sincroniza com o romaneio e cujo nome já existe lá,
// importa automaticamente os equipamentos manuais/de arquivo do romaneio para o
// módulo (evita redigitação). Os itens originais do romaneio são ocultados e
// passam a ser gerenciados pelo módulo (sourceType EQUIPAMENTOS na sincronização).
async function importRomaneioEquipmentIntoCategory(category) {
  if (!category.syncToRomaneio) return 0;
  const target = normalizeCategoryName(category.name);
  const candidates = await prisma.romaneioCatalogItem.findMany({
    where: { isActive: true, kind: 'EQUIPMENT', sourceType: { in: ['FILE', 'MANUAL'] } }
  });
  const matching = candidates.filter(item => normalizeCategoryName(item.categoryName) === target);
  if (!matching.length) return 0;

  let imported = 0;
  for (const item of matching) {
    const code = (item.code && item.code.trim()) || (item.name && item.name.trim());
    if (!code) continue;
    // eslint-disable-next-line no-await-in-loop
    const exists = await prisma.companyEquipment.findUnique({ where: { code } });
    if (exists) continue;
    // eslint-disable-next-line no-await-in-loop
    await prisma.$transaction([
      prisma.companyEquipment.create({
        data: { code, name: item.name || code, categoryId: category.id, attributes: {} }
      }),
      prisma.romaneioCatalogItem.update({
        where: { id: item.id },
        data: { isActive: false, hiddenInRomaneioAt: new Date() }
      })
    ]);
    imported += 1;
  }
  return imported;
}

// === Categorias ===

router.get('/categories', asyncHandler(async (_req, res) => {
  const categories = await prisma.equipmentCategory.findMany({
    where: { isActive: true },
    orderBy: [{ order: 'asc' }, { name: 'asc' }]
  });
  res.json(categories);
}));

router.post('/categories', requireEquipamentosManager, asyncHandler(async (req, res) => {
  const data = categorySchema.parse(req.body);
  const systemKey = await uniqueSystemKey(data.name);
  const category = await prisma.equipmentCategory.create({
    data: {
      systemKey,
      name: data.name,
      order: data.order ?? 0,
      fieldSchema: normalizeFieldSchema(data.fieldSchema),
      supportsCalibration: data.supportsCalibration ?? false,
      supportsTechnicalDoc: data.supportsTechnicalDoc ?? true,
      syncToRomaneio: data.syncToRomaneio ?? false
    }
  });
  const importedFromRomaneio = await importRomaneioEquipmentIntoCategory(category);
  invalidateCaches();
  if (category.syncToRomaneio) await syncRomaneioCatalog();
  res.status(201).json({ ...category, importedFromRomaneio });
}));

router.put('/categories/:id', requireEquipamentosManager, asyncHandler(async (req, res) => {
  const data = categorySchema.partial().parse(req.body);
  const payload = {
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.order !== undefined ? { order: data.order } : {}),
    ...(data.fieldSchema !== undefined ? { fieldSchema: normalizeFieldSchema(data.fieldSchema) } : {}),
    ...(data.supportsCalibration !== undefined ? { supportsCalibration: data.supportsCalibration } : {}),
    ...(data.supportsTechnicalDoc !== undefined ? { supportsTechnicalDoc: data.supportsTechnicalDoc } : {}),
    ...(data.syncToRomaneio !== undefined ? { syncToRomaneio: data.syncToRomaneio } : {})
  };
  const category = await prisma.equipmentCategory.update({ where: { id: req.params.id }, data: payload });
  invalidateCaches();
  // A ordem das abas não afeta o romaneio; só ressincroniza quando muda nome ou flag de sync.
  if (data.name !== undefined || data.syncToRomaneio !== undefined) {
    await syncRomaneioCatalog();
  }
  res.json(category);
}));

router.delete('/categories/:id', requireEquipamentosManager, asyncHandler(async (req, res) => {
  const category = await prisma.equipmentCategory.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { equipment: true } } }
  });
  if (!category) return res.status(404).json({ error: 'Categoria não encontrada.' });
  if (category.isSystemManaged) {
    return res.status(409).json({ error: 'Categorias do sistema (consumidas pelo RDO) não podem ser excluídas.' });
  }
  if (category._count.equipment > 0) {
    return res.status(409).json({ error: 'Remova ou mova os equipamentos antes de excluir a categoria.' });
  }
  const { map } = await resolveRdoSlotMap();
  if (Object.values(map).includes(category.id)) {
    return res.status(409).json({ error: 'Categoria vinculada a um slot de relatório (RDO). Remova o vínculo na configuração antes de excluir.' });
  }
  await prisma.equipmentCategory.update({ where: { id: req.params.id }, data: { isActive: false } });
  invalidateCaches();
  res.status(204).end();
}));

// === Equipamentos ===

router.get('/', asyncHandler(async (req, res) => {
  const where = { isActive: true };
  if (req.query.categoryId) where.categoryId = String(req.query.categoryId);
  const items = await prisma.companyEquipment.findMany({
    where,
    orderBy: [{ code: 'asc' }],
    include: equipmentAttachmentsInclude
  });
  res.json(items.map(withCurrentAttachments));
}));

async function persistAttachments(equipmentId, { calibrationCertificate, technicalDoc }) {
  if (calibrationCertificate) {
    await createEquipmentAttachment(prisma, {
      equipmentId,
      kind: EquipmentAttachmentKinds.CALIBRATION_CERTIFICATE,
      upload: calibrationCertificate
    });
  }
  if (technicalDoc) {
    await createEquipmentAttachment(prisma, {
      equipmentId,
      kind: EquipmentAttachmentKinds.TECHNICAL_DOC,
      upload: technicalDoc
    });
  }
}

router.post('/', requireEquipamentosManager, asyncHandler(async (req, res) => {
  const data = equipmentSchema.parse(req.body);
  const { calibrationCertificate, technicalDoc, ...fields } = data;
  const item = await prisma.companyEquipment.create({
    data: {
      code: fields.code,
      name: fields.name,
      categoryId: fields.categoryId,
      attributes: fields.attributes ?? {},
      hasCalibration: fields.hasCalibration ?? false,
      calibratedAt: fields.hasCalibration && fields.calibratedAt ? new Date(fields.calibratedAt) : null,
      expiresAt: fields.hasCalibration && fields.expiresAt ? new Date(fields.expiresAt) : null,
      hasTechnicalDoc: fields.hasTechnicalDoc ?? false
    }
  });
  await persistAttachments(item.id, { calibrationCertificate, technicalDoc });
  invalidateCaches();
  await syncRomaneioCatalog();
  const fresh = await prisma.companyEquipment.findUnique({
    where: { id: item.id },
    include: equipmentAttachmentsInclude
  });
  res.status(201).json(withCurrentAttachments(fresh));
}));

router.put('/:id', requireEquipamentosManager, asyncHandler(async (req, res) => {
  const data = equipmentSchema.partial().parse(req.body);
  const { calibrationCertificate, technicalDoc, ...fields } = data;
  const payload = {
    ...(fields.code !== undefined ? { code: fields.code } : {}),
    ...(fields.name !== undefined ? { name: fields.name } : {}),
    ...(fields.categoryId !== undefined ? { categoryId: fields.categoryId } : {}),
    ...(fields.attributes !== undefined ? { attributes: fields.attributes } : {}),
    ...(fields.hasTechnicalDoc !== undefined ? { hasTechnicalDoc: fields.hasTechnicalDoc } : {})
  };
  if (fields.hasCalibration !== undefined) {
    payload.hasCalibration = fields.hasCalibration;
    payload.calibratedAt = fields.hasCalibration && fields.calibratedAt ? new Date(fields.calibratedAt) : null;
    payload.expiresAt = fields.hasCalibration && fields.expiresAt ? new Date(fields.expiresAt) : null;
  } else {
    if (fields.calibratedAt !== undefined) payload.calibratedAt = fields.calibratedAt ? new Date(fields.calibratedAt) : null;
    if (fields.expiresAt !== undefined) payload.expiresAt = fields.expiresAt ? new Date(fields.expiresAt) : null;
  }
  const item = await prisma.companyEquipment.update({ where: { id: req.params.id }, data: payload });
  await persistAttachments(item.id, { calibrationCertificate, technicalDoc });
  invalidateCaches();
  await syncRomaneioCatalog();
  const fresh = await prisma.companyEquipment.findUnique({
    where: { id: item.id },
    include: equipmentAttachmentsInclude
  });
  res.json(withCurrentAttachments(fresh));
}));

router.delete('/:id', requireEquipamentosManager, asyncHandler(async (req, res) => {
  await prisma.companyEquipment.update({ where: { id: req.params.id }, data: { isActive: false } });
  invalidateCaches();
  await syncRomaneioCatalog();
  res.status(204).end();
}));

// === Vínculo dos slots de equipamento do RDO com categorias ===

const slotMappingSchema = z.object({
  categoryId: z.string().trim().min(1).nullable()
});

router.get('/rdo-slots', asyncHandler(async (_req, res) => {
  const { slots } = await resolveRdoSlotMap();
  res.json(slots);
}));

router.put('/rdo-slots/:slotKey', requireEquipamentosManager, asyncHandler(async (req, res) => {
  const slot = getSlot(req.params.slotKey);
  if (!slot) return res.status(404).json({ error: 'Slot de relatório não encontrado.' });
  const { categoryId } = slotMappingSchema.parse(req.body);
  if (categoryId) {
    const category = await prisma.equipmentCategory.findFirst({ where: { id: categoryId, isActive: true } });
    if (!category) return res.status(400).json({ error: 'Categoria inválida.' });
  }
  await prisma.rdoEquipmentSlot.upsert({
    where: { slotKey: slot.key },
    create: { slotKey: slot.key, categoryId },
    update: { categoryId }
  });
  invalidateCaches();
  const { slots } = await resolveRdoSlotMap();
  res.json(slots.find(item => item.key === slot.key));
}));

export default router;
