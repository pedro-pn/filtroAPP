import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import {
  createEquipmentAttachment,
  createEquipmentPhoto,
  createGeneratedEquipmentAttachment,
  equipmentAttachmentsInclude,
  removeEquipmentAttachments,
  removeEquipmentAttachmentsByIds,
  resolveEquipmentPhotoAssets,
  serializeEquipmentAttachment,
  withCurrentAttachments,
  EquipmentAttachmentKinds
} from '../../lib/equipment-attachments.js';
import { generateTechnicalDatasheetPdf } from '../../lib/equipment-technical-docx.js';
import { notifyCalibrationUpdatedSafely } from '../../lib/calibration-reminders.js';
import { normalizeFieldSchema, normalizeTechnicalSchema, slugifySystemKey } from '../../lib/equipment-categories.js';
import {
  getEquipmentNotificationConfig,
  listEquipmentNotificationRecipients,
  normalizeEmail,
  updateEquipmentNotificationConfig
} from '../../lib/equipment-notifications.js';
import { getSlot, resolveRdoSlotMap } from '../../lib/rdo-equipment-slots.js';
import { measurementCatalog } from '../../lib/equipment-units.js';
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

const imageUploadSchema = z.object({
  fileName: z.string().optional(),
  mimeType: z.string().optional(),
  dataUrl: z.string().min(1)
});

const fieldDefinitionSchema = z.object({
  key: z.string().optional(),
  label: z.string().trim().min(1),
  type: z.enum(['text', 'number', 'date', 'select', 'textarea']).optional(),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  order: z.number().optional(),
  showInDashboard: z.boolean().optional()
});

// Campos do datasheet (Dados Técnicos): validação pesada fica em normalizeTechnicalSchema;
// aqui o schema é permissivo para não duplicar regras (tipos/grupos/unidades).
const technicalFieldSchema = z.record(z.any());

const categorySchema = z.object({
  name: z.string().trim().min(1),
  order: z.number().int().optional(),
  fieldSchema: z.array(fieldDefinitionSchema).optional(),
  technicalSchema: z.array(technicalFieldSchema).optional(),
  technicalDocEnabled: z.boolean().optional(),
  supportsCalibration: z.boolean().optional(),
  supportsTechnicalDoc: z.boolean().optional(),
  syncToRomaneio: z.boolean().optional()
});

const equipmentSchema = z.object({
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  categoryId: z.string().trim().min(1),
  attributes: z.record(z.any()).optional(),
  technicalData: z.record(z.any()).optional(),
  technicalFieldOverrides: z.record(z.boolean()).optional(),
  bumpRevision: z.boolean().optional(),
  hasCalibration: z.boolean().optional(),
  calibratedAt: z.string().optional().nullable(),
  expiresAt: z.string().optional().nullable(),
  hasTechnicalDoc: z.boolean().optional(),
  calibrationCertificate: pdfUploadSchema,
  technicalDoc: pdfUploadSchema,
  technicalPhotos: z.array(imageUploadSchema).optional(),
  removeTechnicalPhotoIds: z.array(z.string()).optional(),
  removeCalibrationCertificate: z.boolean().optional(),
  removeTechnicalDoc: z.boolean().optional()
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
// módulo (evita redigitação). A própria linha do romaneio é reaproveitada e passa
// a apontar para o módulo (sourceType EQUIPAMENTOS): CONTINUA visível e utilizável
// no romaneio, mas não pode mais ser editada/excluída direto lá.
async function importRomaneioEquipmentIntoCategory(category) {
  if (!category.syncToRomaneio) return 0;
  const target = normalizeCategoryName(category.name);
  // Inclui também itens ocultados (recupera estado de importações anteriores).
  const candidates = await prisma.romaneioCatalogItem.findMany({
    where: { kind: 'EQUIPMENT', sourceType: { in: ['FILE', 'MANUAL'] } }
  });
  const matching = candidates.filter(item => normalizeCategoryName(item.categoryName) === target);
  if (!matching.length) return 0;

  let imported = 0;
  for (const item of matching) {
    const code = (item.code && item.code.trim()) || (item.name && item.name.trim());
    if (!code) continue;
    // eslint-disable-next-line no-await-in-loop
    const done = await prisma.$transaction(async tx => {
      let equipment = await tx.companyEquipment.findUnique({ where: { code } });
      if (equipment && equipment.categoryId !== category.id) return false; // código já usado por outra categoria
      if (!equipment) {
        equipment = await tx.companyEquipment.create({
          data: { code, name: item.name || code, categoryId: category.id, attributes: {} }
        });
      }
      // Se já existe uma linha do romaneio gerenciada por este equipamento, a linha
      // atual é redundante (estado quebrado anterior) — remove para não duplicar.
      const managed = await tx.romaneioCatalogItem.findUnique({
        where: { sourceType_sourceId: { sourceType: 'EQUIPAMENTOS', sourceId: equipment.id } },
        select: { id: true }
      });
      if (managed && managed.id !== item.id) {
        await tx.romaneioCatalogItem.delete({ where: { id: item.id } });
        return false;
      }
      // Outra linha já ocupa a chave natural (categoria + código + nome) com o nome
      // novo da categoria — atualizar esta colidiria no índice único
      // @@unique([categoryName, code, name]). Isso acontece quando a categoria foi
      // renomeada e já existe uma linha equivalente (ex.: derivada de arquivo) com o
      // nome novo. A linha atual é redundante: remove em vez de quebrar o salvamento.
      const naturalConflict = await tx.romaneioCatalogItem.findFirst({
        where: {
          categoryName: category.name,
          code: item.code,
          name: item.name,
          NOT: { id: item.id }
        },
        select: { id: true }
      });
      if (naturalConflict) {
        await tx.romaneioCatalogItem.delete({ where: { id: item.id } });
        return false;
      }
      // A própria linha passa a ser gerenciada pelo módulo: continua visível.
      await tx.romaneioCatalogItem.update({
        where: { id: item.id },
        data: {
          sourceType: 'EQUIPAMENTOS',
          sourceId: equipment.id,
          categoryName: category.name,
          isActive: true,
          hiddenInRomaneioAt: null
        }
      });
      return true;
    });
    if (done) imported += 1;
  }
  return imported;
}

// Catálogo de grandezas/unidades para os campos `measure` do datasheet.
router.get('/units-catalog', asyncHandler(async (_req, res) => {
  res.json(measurementCatalog());
}));

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
      technicalSchema: normalizeTechnicalSchema(data.technicalSchema),
      technicalDocEnabled: data.technicalDocEnabled ?? false,
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
    ...(data.technicalSchema !== undefined ? { technicalSchema: normalizeTechnicalSchema(data.technicalSchema) } : {}),
    ...(data.technicalDocEnabled !== undefined ? { technicalDocEnabled: data.technicalDocEnabled } : {}),
    ...(data.supportsCalibration !== undefined ? { supportsCalibration: data.supportsCalibration } : {}),
    ...(data.supportsTechnicalDoc !== undefined ? { supportsTechnicalDoc: data.supportsTechnicalDoc } : {}),
    ...(data.syncToRomaneio !== undefined ? { syncToRomaneio: data.syncToRomaneio } : {})
  };
  // Compara com o estado anterior: o front reenvia `name` em toda edição (inclusive ao
  // mexer só nos Dados Técnicos), então só dispara a migração/sync do romaneio quando o
  // nome REALMENTE muda ou o flag de sync é alterado — evita re-sincronizar à toa (e bater
  // na colisão de chave natural do catálogo) a cada salvamento.
  const previous = await prisma.equipmentCategory.findUnique({
    where: { id: req.params.id },
    select: { name: true, syncToRomaneio: true }
  });
  const category = await prisma.equipmentCategory.update({ where: { id: req.params.id }, data: payload });
  const nameChanged = data.name !== undefined && previous && data.name !== previous.name;
  const syncChanged = data.syncToRomaneio !== undefined && previous && data.syncToRomaneio !== previous.syncToRomaneio;
  // Ao mudar nome/sync, reaproveita equipamentos do romaneio que casem com a categoria
  // (também recupera categorias importadas em estado anterior).
  let importedFromRomaneio = 0;
  if (nameChanged || syncChanged) {
    importedFromRomaneio = await importRomaneioEquipmentIntoCategory(category);
  }
  invalidateCaches();
  // A ordem das abas não afeta o romaneio; só ressincroniza quando muda nome ou flag de sync.
  if (nameChanged || syncChanged) {
    await syncRomaneioCatalog();
  }
  res.json({ ...category, importedFromRomaneio });
}));

router.delete('/categories/:id', requireEquipamentosManager, asyncHandler(async (req, res) => {
  const category = await prisma.equipmentCategory.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { equipment: true } } }
  });
  if (!category) return res.status(404).json({ error: 'Categoria não encontrada.' });
  if (category._count.equipment > 0) {
    return res.status(409).json({ error: 'Remova ou mova os equipamentos antes de excluir a categoria.' });
  }
  // A proteção segue o VÍNCULO com o RDO (slot), não a origem (isSystemManaged):
  // uma categoria só não pode ser excluída se algum slot de relatório a usa.
  // Relatórios já criados não são afetados (guardam snapshot dos equipamentos).
  const { map } = await resolveRdoSlotMap();
  if (Object.values(map).flat().includes(category.id)) {
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

async function persistAttachments(equipmentId, { calibrationCertificate, technicalDoc, technicalPhotos, removeTechnicalPhotoIds }) {
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
  if (Array.isArray(removeTechnicalPhotoIds) && removeTechnicalPhotoIds.length) {
    await removeEquipmentAttachmentsByIds(prisma, equipmentId, removeTechnicalPhotoIds);
  }
  if (Array.isArray(technicalPhotos)) {
    for (const upload of technicalPhotos) {
      // eslint-disable-next-line no-await-in-loop
      await createEquipmentPhoto(prisma, { equipmentId, upload });
    }
  }
}

router.post('/', requireEquipamentosManager, asyncHandler(async (req, res) => {
  const data = equipmentSchema.parse(req.body);
  const { calibrationCertificate, technicalDoc, technicalPhotos, ...fields } = data;
  const baseData = {
    code: fields.code,
    name: fields.name,
    categoryId: fields.categoryId,
    attributes: fields.attributes ?? {},
    technicalData: fields.technicalData ?? {},
    technicalFieldOverrides: fields.technicalFieldOverrides ?? {},
    technicalRevision: fields.technicalData ? 1 : 0,
    technicalUpdatedAt: fields.technicalData ? new Date() : null,
    hasCalibration: fields.hasCalibration ?? false,
    calibratedAt: fields.hasCalibration && fields.calibratedAt ? new Date(fields.calibratedAt) : null,
    expiresAt: fields.hasCalibration && fields.expiresAt ? new Date(fields.expiresAt) : null,
    hasTechnicalDoc: fields.hasTechnicalDoc ?? false
  };
  // "Remover" é soft delete (isActive=false), então o código continua reservado.
  // Reaproveita o registro removido com o mesmo código: reativa e reescreve (permite
  // recriar/mover um equipamento excluído sem o erro de "código duplicado").
  const existing = await prisma.companyEquipment.findUnique({
    where: { code: fields.code },
    select: { id: true, isActive: true }
  });
  if (existing && existing.isActive) {
    return res.status(409).json({ error: 'Já existe um equipamento ativo com este código.' });
  }
  const item = existing
    ? await prisma.companyEquipment.update({ where: { id: existing.id }, data: { ...baseData, isActive: true } })
    : await prisma.companyEquipment.create({ data: baseData });
  await persistAttachments(item.id, { calibrationCertificate, technicalDoc, technicalPhotos });
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
  const {
    calibrationCertificate, technicalDoc, technicalPhotos, removeTechnicalPhotoIds,
    removeCalibrationCertificate, removeTechnicalDoc, ...fields
  } = data;
  const payload = {
    ...(fields.code !== undefined ? { code: fields.code } : {}),
    ...(fields.name !== undefined ? { name: fields.name } : {}),
    ...(fields.categoryId !== undefined ? { categoryId: fields.categoryId } : {}),
    ...(fields.attributes !== undefined ? { attributes: fields.attributes } : {}),
    ...(fields.technicalFieldOverrides !== undefined ? { technicalFieldOverrides: fields.technicalFieldOverrides } : {}),
    ...(fields.hasTechnicalDoc !== undefined ? { hasTechnicalDoc: fields.hasTechnicalDoc } : {})
  };
  // Editar o datasheet marca a data (sinaliza "PDF desatualizado"); a revisão só sobe
  // quando o gestor liga o toggle "Incrementar revisão" (bumpRevision).
  if (fields.technicalData !== undefined) {
    payload.technicalData = fields.technicalData;
    payload.technicalUpdatedAt = new Date();
  }
  if (fields.bumpRevision) {
    payload.technicalRevision = { increment: 1 };
    payload.technicalUpdatedAt = new Date();
  }
  if (fields.hasCalibration !== undefined) {
    payload.hasCalibration = fields.hasCalibration;
    payload.calibratedAt = fields.hasCalibration && fields.calibratedAt ? new Date(fields.calibratedAt) : null;
    payload.expiresAt = fields.hasCalibration && fields.expiresAt ? new Date(fields.expiresAt) : null;
  } else {
    if (fields.calibratedAt !== undefined) payload.calibratedAt = fields.calibratedAt ? new Date(fields.calibratedAt) : null;
    if (fields.expiresAt !== undefined) payload.expiresAt = fields.expiresAt ? new Date(fields.expiresAt) : null;
  }
  const previous = await prisma.companyEquipment.findUnique({ where: { id: req.params.id }, select: { expiresAt: true } });
  const item = await prisma.companyEquipment.update({ where: { id: req.params.id }, data: payload });
  await persistAttachments(item.id, { calibrationCertificate, technicalDoc, technicalPhotos, removeTechnicalPhotoIds });
  if (removeCalibrationCertificate && !calibrationCertificate) {
    await removeEquipmentAttachments(prisma, item.id, EquipmentAttachmentKinds.CALIBRATION_CERTIFICATE);
  }
  if (removeTechnicalDoc && !technicalDoc) {
    await removeEquipmentAttachments(prisma, item.id, EquipmentAttachmentKinds.TECHNICAL_DOC);
  }
  // Ao incrementar a revisão, o datasheet anterior é descartado (não fica arquivado):
  // a nova revisão começa limpa e o próximo PDF gerado é o oficial.
  if (fields.bumpRevision) {
    await removeEquipmentAttachments(prisma, item.id, EquipmentAttachmentKinds.TECHNICAL_DOC_GENERATED);
  }
  invalidateCaches();
  await syncRomaneioCatalog();
  const fresh = await prisma.companyEquipment.findUnique({
    where: { id: item.id },
    include: { ...equipmentAttachmentsInclude, category: { select: { name: true } } }
  });
  if (fresh?.hasCalibration) {
    await notifyCalibrationUpdatedSafely({ equipment: fresh, previousExpiresAt: previous?.expiresAt });
  }
  res.json(withCurrentAttachments(fresh));
}));

// Gera (ou regenera) o datasheet em PDF a partir dos Dados Técnicos preenchidos.
// Substitui o datasheet gerado anterior e devolve o anexo já com a URL pública.
router.post('/:id/technical-doc', requireEquipamentosManager, asyncHandler(async (req, res) => {
  const equipment = await prisma.companyEquipment.findUnique({
    where: { id: req.params.id },
    include: { category: true }
  });
  if (!equipment) {
    return res.status(404).json({ error: 'Equipamento não encontrado.' });
  }
  if (!equipment.category?.technicalDocEnabled) {
    return res.status(400).json({ error: 'A categoria deste equipamento não tem Dados Técnicos habilitados.' });
  }

  const photoAssets = await resolveEquipmentPhotoAssets(prisma, equipment.id);
  const { bytes, fileName } = await generateTechnicalDatasheetPdf(equipment, equipment.category, photoAssets);

  // Não apaga os datasheets anteriores: ficam ARQUIVADOS (histórico). O botão
  // "Doc. técnica" serve sempre o mais recente; os antigos ficam em "arquivados".
  const attachment = await createGeneratedEquipmentAttachment(prisma, {
    equipmentId: equipment.id,
    kind: EquipmentAttachmentKinds.TECHNICAL_DOC_GENERATED,
    fileName,
    bytes
  });
  invalidateCaches();
  return res.status(201).json(serializeEquipmentAttachment(attachment));
}));

router.delete('/:id', requireEquipamentosManager, asyncHandler(async (req, res) => {
  await prisma.companyEquipment.update({ where: { id: req.params.id }, data: { isActive: false } });
  invalidateCaches();
  await syncRomaneioCatalog();
  res.status(204).end();
}));

// === Vínculo dos slots de equipamento do RDO com categorias ===

// Aceita o formato novo (categoryIds[]) e o legado (categoryId) — normaliza para array.
const slotMappingSchema = z.object({
  categoryIds: z.array(z.string().trim().min(1)).optional(),
  categoryId: z.string().trim().min(1).nullable().optional()
});

router.get('/rdo-slots', asyncHandler(async (_req, res) => {
  const { slots } = await resolveRdoSlotMap();
  res.json(slots);
}));

router.put('/rdo-slots/:slotKey', requireEquipamentosManager, asyncHandler(async (req, res) => {
  const slot = getSlot(req.params.slotKey);
  if (!slot) return res.status(404).json({ error: 'Slot de relatório não encontrado.' });
  const parsed = slotMappingSchema.parse(req.body);
  // Normaliza para lista (sem duplicados); aceita o legado categoryId.
  const categoryIds = [...new Set([
    ...(parsed.categoryIds || []),
    ...(parsed.categoryId ? [parsed.categoryId] : [])
  ])];
  if (categoryIds.length) {
    const valid = await prisma.equipmentCategory.findMany({
      where: { id: { in: categoryIds }, isActive: true },
      select: { id: true }
    });
    if (valid.length !== categoryIds.length) {
      return res.status(400).json({ error: 'Categoria inválida.' });
    }
  }
  await prisma.rdoEquipmentSlot.upsert({
    where: { slotKey: slot.key },
    create: { slotKey: slot.key, categoryIds, categoryId: categoryIds[0] || null },
    update: { categoryIds, categoryId: categoryIds[0] || null }
  });
  invalidateCaches();
  const { slots } = await resolveRdoSlotMap();
  res.json(slots.find(item => item.key === slot.key));
}));

// === Notificações de calibração (destinatários + configuração) ===

const notificationConfigSchema = z.object({
  enabled: z.boolean().optional(),
  milestoneDays: z.array(z.number()).optional(),
  notifyOnDueDay: z.boolean().optional(),
  repeatExpired: z.boolean().optional(),
  repeatGapDays: z.number().int().positive().optional()
});

const recipientSchema = z.object({
  userId: z.string().trim().min(1).optional().nullable(),
  email: z.string().trim().email().optional()
}).refine(data => data.userId || data.email, { message: 'Informe uma conta ou um e-mail.' });

router.get('/notifications/config', asyncHandler(async (_req, res) => {
  res.json(await getEquipmentNotificationConfig());
}));

router.put('/notifications/config', requireEquipamentosManager, asyncHandler(async (req, res) => {
  const data = notificationConfigSchema.parse(req.body);
  res.json(await updateEquipmentNotificationConfig(prisma, data));
}));

// Contas internas elegíveis a receber notificações (para o seletor da UI).
router.get('/notifications/accounts', asyncHandler(async (_req, res) => {
  const users = await prisma.user.findMany({
    where: { isActive: true, accountType: { in: ['ADMIN', 'INTERNAL'] } },
    select: { id: true, name: true, email: true, username: true },
    orderBy: { name: 'asc' }
  });
  res.json(users
    .map(user => ({ id: user.id, name: user.name, email: normalizeEmail(user.email) || (user.username.includes('@') ? normalizeEmail(user.username) : '') }))
    .filter(user => user.email));
}));

router.get('/notifications/recipients', asyncHandler(async (_req, res) => {
  res.json(await listEquipmentNotificationRecipients());
}));

router.post('/notifications/recipients', requireEquipamentosManager, asyncHandler(async (req, res) => {
  const data = recipientSchema.parse(req.body);
  let email = data.email ? normalizeEmail(data.email) : '';
  let userId = data.userId || null;
  if (userId) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, username: true, isActive: true } });
    if (!user || !user.isActive) return res.status(400).json({ error: 'Conta inválida.' });
    email = normalizeEmail(user.email) || (user.username.includes('@') ? normalizeEmail(user.username) : '');
    if (!email) return res.status(400).json({ error: 'A conta não possui e-mail válido.' });
  }
  if (!email) return res.status(400).json({ error: 'Informe um e-mail válido.' });
  const recipient = await prisma.equipmentNotificationRecipient.upsert({
    where: { email },
    create: { email, userId, isActive: true },
    update: { userId, isActive: true }
  });
  res.status(201).json(recipient);
}));

router.put('/notifications/recipients/:id', requireEquipamentosManager, asyncHandler(async (req, res) => {
  const isActive = Boolean(req.body?.isActive);
  const recipient = await prisma.equipmentNotificationRecipient.update({
    where: { id: req.params.id },
    data: { isActive }
  });
  res.json(recipient);
}));

router.delete('/notifications/recipients/:id', requireEquipamentosManager, asyncHandler(async (req, res) => {
  await prisma.equipmentNotificationRecipient.delete({ where: { id: req.params.id } });
  res.status(204).end();
}));

export default router;
