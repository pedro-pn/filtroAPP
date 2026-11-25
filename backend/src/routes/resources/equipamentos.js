import { collaboratorVisibilityWhere } from '../../lib/collaborators/workforce-policy.js';
import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import { createEquipmentAttachment, createEquipmentPhoto, createGeneratedEquipmentAttachment, equipmentAttachmentsInclude, removeEquipmentAttachments, removeEquipmentAttachmentsByIds, resolveEquipmentPhotoAssets, listCategoryOperationPhotos, resolveOperationPhotoAssets, serializeEquipmentAttachment, withCurrentAttachments, EquipmentAttachmentKinds } from '../../lib/equipment-attachments.js';
import { generateTechnicalDatasheetPdf } from '../../lib/equipment-technical-docx.js';
import { withRomaneioCatalogIds } from '../../lib/equipamentos/romaneio-link.js';
import { buildQrLinkSettings, normalizeQrAccess } from '../../lib/equipamentos/qr-link.js';
import { pruneOperationPhotos, resolveOperationStepItems } from '../../lib/equipamentos/operation-manual-photos.js';
import { generateOperationManualPdf, normalizeOperationStepItems, resolveEffectiveOperationSteps, serializeOperationStepItems, MAX_OPERATION_STEPS, MAX_OPERATION_STEP_LENGTH, MAX_OPERATION_STEP_PHOTOS } from '../../lib/equipamentos/operation-manual.js';
import { notifyCalibrationUpdatedSafely } from '../../lib/calibration-reminders.js';
import { notifyEquipmentCreatedSafely } from '../../lib/equipamentos/created-notification.js';
import { normalizeFieldSchema, normalizeTechnicalSchema, slugifySystemKey } from '../../lib/equipment-categories.js';
import { removeTechnicalStandard, saveCategoryTechnicalStandard, updateTechnicalStandard } from '../../lib/equipamentos/technical-standards.js';
import { normalizeChecklistDisplayMode, normalizeChecklistItems } from '../../lib/equipamentos/equipment-checklist.js';
import { getEquipmentNotificationConfig, listEquipmentNotificationRecipients, normalizeEmail, updateEquipmentNotificationConfig } from '../../lib/equipment-notifications.js';
import { getSlot, resolveRdoSlotMap } from '../../lib/rdo-equipment-slots.js';
import { measurementCatalog } from '../../lib/equipment-units.js';
import prisma from '../../lib/prisma.js';
import { Prisma } from '@prisma/client';
import { clearEquipmentModuleCaches, clearRomaneioCatalogDependentCaches } from '../../lib/resource-list-cache.js';
import { syncRomaneioCatalog } from '../../lib/romaneio-catalog.js';
import { requireAuth, requireEquipamentosAccess, requireEquipamentosManager } from '../../middleware/auth.js';
import { maintenanceConfigSchema, maintenanceProfileSchema, maintenanceRecordInclude } from '../../lib/operational-reports/domain.js';
import { serializeMaintenanceAttachment } from '../../lib/operational-reports/maintenance-attachments.js';
import { hasModuleRole } from '../../lib/module-roles.js';
import { inlineContentDisposition, removeEquipmentDocument } from '../../lib/equipment-attachments.js';
import { expensiveRouteLimit } from '../../lib/rate-limit.js';
import { functioningChecklistSchema, functioningChecklistFileName } from '../../lib/equipamentos/functioning-checklist.js';
import { buildFunctioningChecklistPdf } from '../../lib/equipamentos/functioning-checklist-pdf.js';
import { buildFunctioningChecklistXlsx, CHECKLIST_XLSX_MIME } from '../../lib/equipamentos/functioning-checklist-xlsx.js';
import { defineRoute } from '../../lib/api-contract/registry.js';

import { opsRoute, EMPTY, jsonResponseSchema, libValidatedBodySchema } from '../../lib/api-contract/domains/operacoes.js';
const functioningChecklistPayloadSchema = z.object({ template: functioningChecklistSchema.nullable() });

const router = Router();
router.use(requireAuth);
router.use(requireEquipamentosAccess);

const pdfUploadSchema = z
  .object({
    fileName: z.string().min(1),
    mimeType: z.string().optional(),
    dataUrl: z.string().min(1)
  })
  .optional()
  .nullable();

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
const technicalFieldSchema = z.record(z.string(), z.any());
const technicalStandardSchema = z.object({
  name: z.string().trim().min(1).max(150),
  technicalSchema: z.array(technicalFieldSchema)
});
const checklistItemsSchema = z.array(z.string().trim().min(1).max(300)).max(100);
// Passos do equipamento: texto puro ou { text, photos } — cada foto é uma já salva ({ id })
// ou uma nova enviada como dataURL.
const operationStepWithPhotosSchema = z.object({
  text: z.string().trim().min(1).max(MAX_OPERATION_STEP_LENGTH),
  photos: z.array(z.union([z.object({ id: z.string().min(1) }), imageUploadSchema])).max(MAX_OPERATION_STEP_PHOTOS).optional()
});
const equipmentOperationStepsSchema = z.array(
  z.union([z.string().trim().min(1).max(MAX_OPERATION_STEP_LENGTH), operationStepWithPhotosSchema])
).max(MAX_OPERATION_STEPS);

const categorySchema = z.object({
  name: z.string().trim().min(1),
  maintenanceProfileId: z.string().trim().min(1).nullable().optional(),
  maintenanceIntervalDays: z.number().int().min(1).max(3650).nullable().optional(),
  showInMaintenance: z.boolean().optional(),
  order: z.number().int().optional(),
  fieldSchema: z.array(fieldDefinitionSchema).optional(),
  technicalSchema: z.array(technicalFieldSchema).optional(),
  technicalStandardId: z.string().trim().min(1).nullable().optional(),
  technicalDocEnabled: z.boolean().optional(),
  checklistEnabled: z.boolean().optional(),
  checklistDisplayMode: z.enum(['AUTO', 'TAG', 'NAME']).optional(),
  checklistItems: checklistItemsSchema.optional(),
  functioningChecklist: functioningChecklistSchema.optional(),
  operationManualEnabled: z.boolean().optional(),
  operationSteps: equipmentOperationStepsSchema.optional(),
  supportsCalibration: z.boolean().optional(),
  supportsTechnicalDoc: z.boolean().optional(),
  attachmentsEnabled: z.boolean().optional(),
  syncToRomaneio: z.boolean().optional()
});

const equipmentSchema = z.object({
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  categoryId: z.string().trim().min(1),
  maintenanceProfileId: z.string().trim().min(1).nullable().optional(),
  maintenanceProfileOverride: z.boolean().optional(),
  attributes: z.record(z.string(), z.any()).optional(),
  technicalData: z.record(z.string(), z.any()).optional(),
  technicalFieldOverrides: z.record(z.string(), z.boolean()).optional(),
  checklistItems: checklistItemsSchema.nullable().optional(),
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

function technicalRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function stableTechnicalJson(value) {
  return JSON.stringify(technicalRecord(value));
}

function hasTechnicalRecordContent(value) {
  return Object.keys(technicalRecord(value)).length > 0;
}

export function hasTechnicalRevisionBaseline(equipment) {
  return Boolean(equipment?.technicalUpdatedAt || Number(equipment?.technicalRevision || 0) > 0 || hasTechnicalRecordContent(equipment?.technicalData) || hasTechnicalRecordContent(equipment?.technicalFieldOverrides));
}

export function technicalPayloadChanged(previous, fields, attachments = {}) {
  if (fields.technicalData !== undefined && stableTechnicalJson(fields.technicalData) !== stableTechnicalJson(previous?.technicalData)) {
    return true;
  }
  if (fields.technicalFieldOverrides !== undefined && stableTechnicalJson(fields.technicalFieldOverrides) !== stableTechnicalJson(previous?.technicalFieldOverrides)) {
    return true;
  }
  if (Array.isArray(attachments.technicalPhotos) && attachments.technicalPhotos.length > 0) return true;
  if (Array.isArray(attachments.removeTechnicalPhotoIds) && attachments.removeTechnicalPhotoIds.length > 0) return true;
  return false;
}

export function shouldIncrementTechnicalRevision(previous, fields, attachments = {}) {
  return fields?.bumpRevision === true && hasTechnicalRevisionBaseline(previous) && technicalPayloadChanged(previous, fields, attachments);
}

async function uniqueSystemKey(name) {
  const base = slugifySystemKey(name);
  let candidate = base;
  let suffix = 1;
  // eslint-disable-next-line no-await-in-loop
  while (
    await prisma.equipmentCategory.findUnique({
      where: { systemKey: candidate }
    })
  ) {
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
          data: {
            code,
            name: item.name || code,
            categoryId: category.id,
            attributes: {}
          }
        });
      }
      // Se já existe uma linha do romaneio gerenciada por este equipamento, a linha
      // atual é redundante (estado quebrado anterior) — remove para não duplicar.
      const managed = await tx.romaneioCatalogItem.findUnique({
        where: {
          sourceType_sourceId: {
            sourceType: 'EQUIPAMENTOS',
            sourceId: equipment.id
          }
        },
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
defineRoute(router, opsRoute('GET /units-catalog', { tag: 'equipamentos', summary: 'Equipamentos: Catálogo de grandezas/unidades para os campos `measure` do datasheet', responses: { 200: jsonResponseSchema }, errors: [401, 403] }),
  asyncHandler(async (_req, res) => {
    res.json(measurementCatalog());
  })
);

// === Categorias ===

defineRoute(router, opsRoute('GET /technical-standards', { tag: 'equipamentos', summary: 'Equipamentos: Listar normas técnicas', responses: { 200: jsonResponseSchema }, errors: [401, 403] }),
  asyncHandler(async (_req, res) => {
    const standards = await prisma.equipmentTechnicalStandard.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      include: {
        categories: {
          select: { id: true, name: true, isActive: true, _count: { select: { equipment: true } } },
          orderBy: { name: 'asc' }
        }
      }
    });
    res.json(standards);
  })
);

defineRoute(router, opsRoute('POST /technical-standards', { tag: 'equipamentos', summary: 'Equipamentos: Criar normas técnicas', body: technicalStandardSchema, responses: { 201: jsonResponseSchema }, errors: [400, 401, 403] }),
  requireEquipamentosManager,
  asyncHandler(async (req, res) => {
    const data = technicalStandardSchema.parse(req.body);
    const standard = await prisma.equipmentTechnicalStandard.create({
      data: { name: data.name, technicalSchema: normalizeTechnicalSchema(data.technicalSchema) }
    });
    invalidateCaches();
    res.status(201).json(standard);
  })
);

defineRoute(router, opsRoute('PUT /technical-standards/:id', { tag: 'equipamentos', summary: 'Equipamentos: Atualizar normas técnicas (por id)', body: libValidatedBodySchema, validatedBy: 'handler/serviço (corpo conferido fora do contrato)', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }),
  requireEquipamentosManager,
  asyncHandler(async (req, res) => {
    const data = technicalStandardSchema.partial().parse(req.body);
    const standard = await prisma.$transaction(tx => updateTechnicalStandard(tx, req.params.id, data));
    invalidateCaches();
    res.json(standard);
  })
);

defineRoute(router, opsRoute('DELETE /technical-standards/:id', { tag: 'equipamentos', summary: 'Equipamentos: Excluir normas técnicas (por id)', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 204: EMPTY }, errors: [401, 403] }),
  requireEquipamentosManager,
  asyncHandler(async (req, res) => {
    await prisma.$transaction(tx => removeTechnicalStandard(tx, req.params.id));
    invalidateCaches();
    res.status(204).end();
  })
);

defineRoute(router, opsRoute('GET /categories', { tag: 'equipamentos', summary: 'Equipamentos: Listar categorias', responses: { 200: jsonResponseSchema }, errors: [401, 403] }),
  asyncHandler(async (_req, res) => {
    const categories = await prisma.equipmentCategory.findMany({
      where: { isActive: true },
      orderBy: [{ order: 'asc' }, { name: 'asc' }]
    });
    const photos = await listCategoryOperationPhotos(prisma, categories.map(category => category.id));
    res.json(categories.map(category => ({ ...category, operationPhotos: photos.get(category.id) || [] })));
  })
);

defineRoute(router, opsRoute('POST /categories', { tag: 'equipamentos', summary: 'Equipamentos: Criar categorias', body: categorySchema, responses: { 201: jsonResponseSchema }, errors: [400, 401, 403] }),
  requireEquipamentosManager,
  asyncHandler(async (req, res) => {
    const data = categorySchema.parse(req.body);
    const systemKey = await uniqueSystemKey(data.name);
    const payload = {
      systemKey,
      name: data.name,
      maintenanceProfileId: data.maintenanceProfileId || null,
      maintenanceIntervalDays: data.maintenanceIntervalDays ?? null,
      showInMaintenance: data.showInMaintenance ?? true,
      order: data.order ?? 0,
      fieldSchema: normalizeFieldSchema(data.fieldSchema),
      technicalSchema: normalizeTechnicalSchema(data.technicalSchema),
      ...(data.technicalStandardId !== undefined ? { technicalStandardId: data.technicalStandardId } : {}),
      checklistEnabled: data.checklistEnabled ?? false,
      checklistDisplayMode: normalizeChecklistDisplayMode(data.checklistDisplayMode),
      checklistItems: normalizeChecklistItems(data.checklistItems),
      ...(data.functioningChecklist !== undefined ? { functioningChecklist: data.functioningChecklist } : {}),
      operationManualEnabled: data.operationManualEnabled ?? false,
      operationSteps: [], // gravados abaixo, depois de existir a categoria (as fotos pertencem a ela)
      technicalDocEnabled: data.technicalDocEnabled ?? false,
      supportsCalibration: data.supportsCalibration ?? false,
      supportsTechnicalDoc: data.supportsTechnicalDoc ?? true,
      attachmentsEnabled: data.attachmentsEnabled ?? false,
      syncToRomaneio: data.syncToRomaneio ?? false
    };
    let category = data.technicalSchema !== undefined || data.technicalStandardId !== undefined
      ? await prisma.$transaction(tx => saveCategoryTechnicalStandard(tx, null, payload))
      : await prisma.equipmentCategory.create({ data: payload });
    if (data.operationSteps?.length) {
      const items = await resolveOperationStepItems(prisma, { categoryId: category.id, steps: data.operationSteps });
      category = await prisma.equipmentCategory.update({
        where: { id: category.id },
        data: { operationSteps: serializeOperationStepItems(items) }
      });
    }
    const importedFromRomaneio = await importRomaneioEquipmentIntoCategory(category);
    invalidateCaches();
    if (category.syncToRomaneio) await syncRomaneioCatalog();
    const operationPhotos = (await listCategoryOperationPhotos(prisma, [category.id])).get(category.id) || [];
    res.status(201).json({ ...category, operationPhotos, importedFromRomaneio });
  })
);

defineRoute(router, opsRoute('PUT /categories/:id', { tag: 'equipamentos', summary: 'Equipamentos: Atualizar categorias (por id)', body: libValidatedBodySchema, validatedBy: 'handler/serviço (corpo conferido fora do contrato)', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }),
  requireEquipamentosManager,
  asyncHandler(async (req, res) => {
    const data = categorySchema.partial().parse(req.body);
    const payload = {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.maintenanceProfileId !== undefined
        ? { maintenanceProfileId: data.maintenanceProfileId || null }
        : {}),
      ...(data.maintenanceIntervalDays !== undefined
        ? { maintenanceIntervalDays: data.maintenanceIntervalDays }
        : {}),
      ...(data.showInMaintenance !== undefined
        ? { showInMaintenance: data.showInMaintenance }
        : {}),
      ...(data.order !== undefined ? { order: data.order } : {}),
      ...(data.fieldSchema !== undefined ? { fieldSchema: normalizeFieldSchema(data.fieldSchema) } : {}),
      ...(data.technicalSchema !== undefined ? { technicalSchema: normalizeTechnicalSchema(data.technicalSchema) } : {}),
      ...(data.technicalStandardId !== undefined ? { technicalStandardId: data.technicalStandardId } : {}),
      ...(data.checklistEnabled !== undefined ? { checklistEnabled: data.checklistEnabled } : {}),
      ...(data.checklistDisplayMode !== undefined
        ? {
            checklistDisplayMode: normalizeChecklistDisplayMode(data.checklistDisplayMode)
          }
        : {}),
      ...(data.checklistItems !== undefined ? { checklistItems: normalizeChecklistItems(data.checklistItems) } : {}),
      ...(data.functioningChecklist !== undefined ? { functioningChecklist: data.functioningChecklist } : {}),
      ...(data.operationManualEnabled !== undefined ? { operationManualEnabled: data.operationManualEnabled } : {}),
      ...(data.technicalDocEnabled !== undefined ? { technicalDocEnabled: data.technicalDocEnabled } : {}),
      ...(data.supportsCalibration !== undefined ? { supportsCalibration: data.supportsCalibration } : {}),
      ...(data.supportsTechnicalDoc !== undefined ? { supportsTechnicalDoc: data.supportsTechnicalDoc } : {}),
      ...(data.attachmentsEnabled !== undefined ? { attachmentsEnabled: data.attachmentsEnabled } : {}),
      ...(data.syncToRomaneio !== undefined ? { syncToRomaneio: data.syncToRomaneio } : {})
    };
    // Compara com o estado anterior: o front reenvia `name` em toda edição (inclusive ao
    // mexer só nos Dados Técnicos), então só dispara a migração/sync do romaneio quando o
    // nome REALMENTE muda ou o flag de sync é alterado — evita re-sincronizar à toa (e bater
    // na colisão de chave natural do catálogo) a cada salvamento.
    const previous = await prisma.equipmentCategory.findUnique({
      where: { id: req.params.id },
      select: { name: true, syncToRomaneio: true, operationSteps: true }
    });
    let category = data.technicalSchema !== undefined || data.technicalStandardId !== undefined
      ? await prisma.$transaction(tx => saveCategoryTechnicalStandard(tx, req.params.id, payload))
      : await prisma.equipmentCategory.update({ where: { id: req.params.id }, data: payload });
    if (data.operationSteps !== undefined) {
      // Modelo de passos (texto + fotos). Se mudou, os equipamentos que herdam (sem passos próprios)
      // ganham nova revisão e seu PDF anterior passa a constar como desatualizado.
      const items = await resolveOperationStepItems(prisma, { categoryId: category.id, steps: data.operationSteps });
      const changed = JSON.stringify(normalizeOperationStepItems(previous?.operationSteps)) !== JSON.stringify(items);
      category = await prisma.equipmentCategory.update({
        where: { id: category.id },
        data: { operationSteps: serializeOperationStepItems(items) }
      });
      await pruneOperationPhotos(prisma, { categoryId: category.id }, items);
      if (changed) {
        await prisma.companyEquipment.updateMany({
          where: { categoryId: category.id, operationSteps: { equals: Prisma.DbNull } },
          data: { operationRevision: { increment: 1 }, operationUpdatedAt: new Date() }
        });
      }
    }
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
    const operationPhotos = (await listCategoryOperationPhotos(prisma, [category.id])).get(category.id) || [];
    res.json({ ...category, operationPhotos, importedFromRomaneio });
  })
);

defineRoute(router, opsRoute('DELETE /categories/:id', { tag: 'equipamentos', summary: 'Equipamentos: Excluir categorias (por id)', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 204: EMPTY }, errors: [401, 403, 404, 409] }),
  requireEquipamentosManager,
  asyncHandler(async (req, res) => {
    const category = await prisma.equipmentCategory.findUnique({
      where: { id: req.params.id },
      // A remoção de equipamentos preserva o histórico com isActive=false.
      include: { _count: { select: { equipment: { where: { isActive: true } } } } }
    });
    if (!category) return res.status(404).json({ error: 'Categoria não encontrada.' });
    if (category._count.equipment > 0) {
      return res.status(409).json({
        error: 'Remova ou mova os equipamentos antes de excluir a categoria.'
      });
    }
    // A proteção segue o VÍNCULO com o RDO (slot), não a origem (isSystemManaged):
    // uma categoria só não pode ser excluída se algum slot de relatório a usa.
    // Relatórios já criados não são afetados (guardam snapshot dos equipamentos).
    const { map, secondaryMap } = await resolveRdoSlotMap();
    if ([...Object.values(map).flat(), ...Object.values(secondaryMap).flat()].includes(category.id)) {
      return res.status(409).json({
        error: 'Categoria vinculada a um slot de relatório (RDO). Remova o vínculo na configuração antes de excluir.'
      });
    }
    await prisma.equipmentCategory.update({
      where: { id: req.params.id },
      data: { isActive: false }
    });
    invalidateCaches();
    res.status(204).end();
  })
);

// === Configuração de manutenção ===

function maintenanceSupervisorSummary(config) {
  const collaborator = config?.supervisor || null;
  const user = collaborator?.user || null;
  const valid = Boolean(collaborator?.isActive && collaborator?.signatureImage && user?.isActive && user?.accountType === 'INTERNAL');
  return {
    id: collaborator?.id || null,
    name: collaborator?.name || null,
    userId: user?.id || null,
    valid,
    reason: valid ? null : 'Selecione um colaborador ativo, com conta interna ativa e assinatura cadastrada.'
  };
}

async function maintenanceProfileKey(name) {
  const base = slugifySystemKey(name) || 'PERFIL';
  let key = `MAINTENANCE_${base}`;
  let suffix = 1;
  while (await prisma.maintenanceProfile.findUnique({ where: { key } })) {
    suffix += 1;
    key = `MAINTENANCE_${base}_${suffix}`;
  }
  return key;
}

defineRoute(router, opsRoute('GET /maintenance/config', { tag: 'equipamentos', summary: 'Equipamentos: Listar manutenção › configuração', responses: { 200: jsonResponseSchema }, errors: [401, 403] }),
  asyncHandler(async (req, res) => {
    const canManage = hasModuleRole(req.auth.user, 'equipamentos:manager');
    const [config, profiles, candidates] = await Promise.all([
      prisma.maintenanceConfiguration.findUnique({
        where: { id: 'global' },
        include: { supervisor: { include: { user: true } } }
      }),
      prisma.maintenanceProfile.findMany({
        where: canManage ? {} : { isActive: true },
        include: {
          items: {
            where: canManage ? {} : { isActive: true },
            orderBy: { order: 'asc' }
          }
        },
        orderBy: [{ order: 'asc' }, { name: 'asc' }]
      }),
      canManage
        ? prisma.collaborator.findMany({
            where: {
              isActive: true,
              signatureImage: { not: null },
              ...collaboratorVisibilityWhere('EQUIPMENT'),
              user: { is: { isActive: true, accountType: 'INTERNAL' } }
            },
            select: {
              id: true,
              name: true,
              code: true,
              user: { select: { id: true, email: true } }
            },
            orderBy: { name: 'asc' }
          })
        : Promise.resolve([])
    ]);
    res.json({
      supervisor: maintenanceSupervisorSummary(config),
      candidates,
      profiles,
      canManage
    });
  })
);

defineRoute(router, opsRoute('PUT /maintenance/config', { tag: 'equipamentos', summary: 'Equipamentos: Atualizar manutenção › configuração', body: maintenanceConfigSchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }),
  requireEquipamentosManager,
  asyncHandler(async (req, res) => {
    const data = maintenanceConfigSchema.parse(req.body);
    if (data.supervisorCollaboratorId) {
      const candidate = await prisma.collaborator.findFirst({
        where: {
          id: data.supervisorCollaboratorId,
          isActive: true,
          signatureImage: { not: null },
              ...collaboratorVisibilityWhere('EQUIPMENT'),
          user: { is: { isActive: true, accountType: 'INTERNAL' } }
        },
        select: { id: true }
      });
      if (!candidate) {
        return res.status(400).json({
          error: 'O supervisor precisa estar ativo, possuir conta interna ativa e assinatura cadastrada.'
        });
      }
    }
    const config = await prisma.maintenanceConfiguration.upsert({
      where: { id: 'global' },
      create: {
        id: 'global',
        supervisorCollaboratorId: data.supervisorCollaboratorId,
        updatedByUserId: req.auth.user.id
      },
      update: {
        supervisorCollaboratorId: data.supervisorCollaboratorId,
        updatedByUserId: req.auth.user.id
      },
      include: { supervisor: { include: { user: true } } }
    });
    res.json({ supervisor: maintenanceSupervisorSummary(config) });
  })
);

defineRoute(router, opsRoute('POST /maintenance/profiles', { tag: 'equipamentos', summary: 'Equipamentos: Criar manutenção › perfis', body: maintenanceProfileSchema, responses: { 201: jsonResponseSchema }, errors: [400, 401, 403] }),
  requireEquipamentosManager,
  asyncHandler(async (req, res) => {
    const data = maintenanceProfileSchema.parse(req.body);
    const items = data.items
      .map((item, index) => ({ ...item, requestedOrder: item.order ?? index + 1, index }))
      .sort((left, right) => left.requestedOrder - right.requestedOrder || left.index - right.index);
    const profile = await prisma.maintenanceProfile.create({
      data: {
        key: await maintenanceProfileKey(data.name),
        name: data.name,
        order: data.order ?? 0,
        isActive: data.isActive ?? true,
        items: {
          create: items.map((item, index) => ({
            label: item.label,
            order: index + 1,
            isActive: item.isActive
          }))
        }
      },
      include: { items: { orderBy: { order: 'asc' } } }
    });
    res.status(201).json(profile);
  })
);

defineRoute(router, opsRoute('PUT /maintenance/profiles/:id', { tag: 'equipamentos', summary: 'Equipamentos: Atualizar manutenção › perfis (por id)', body: maintenanceProfileSchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }),
  requireEquipamentosManager,
  asyncHandler(async (req, res) => {
    const data = maintenanceProfileSchema.parse(req.body);
    const profile = await prisma.$transaction(async tx => {
      const existing = await tx.maintenanceProfile.findUniqueOrThrow({
        where: { id: req.params.id },
        include: { items: { orderBy: { order: 'asc' } } }
      });
      const existingIds = new Set(existing.items.map(item => item.id));
      const requestedIds = data.items.map(item => item.id).filter(Boolean);
      if (
        new Set(requestedIds).size !== requestedIds.length ||
        requestedIds.some(id => !existingIds.has(id))
      ) {
        const error = new Error('Um ou mais serviços não pertencem a este perfil.');
        error.statusCode = 400;
        throw error;
      }

      const orderedItems = data.items
        .map((item, index) => ({ ...item, requestedOrder: item.order ?? index + 1, index }))
        .sort((left, right) => left.requestedOrder - right.requestedOrder || left.index - right.index);
      const omittedItems = existing.items.filter(item => !requestedIds.includes(item.id));

      // Libera temporariamente a restrição única (perfil, ordem) antes do reordenamento.
      await tx.maintenanceProfileItem.updateMany({
        where: { profileId: req.params.id },
        data: { order: { increment: 10000 } }
      });

      for (const [index, item] of orderedItems.entries()) {
        const itemData = {
          label: item.label,
          order: index + 1,
          isActive: item.isActive
        };
        if (item.id) {
          await tx.maintenanceProfileItem.update({
            where: { id: item.id },
            data: itemData
          });
        } else {
          await tx.maintenanceProfileItem.create({
            data: { ...itemData, profileId: req.params.id }
          });
        }
      }

      for (const [index, item] of omittedItems.entries()) {
        await tx.maintenanceProfileItem.update({
          where: { id: item.id },
          data: {
            isActive: false,
            order: orderedItems.length + index + 1
          }
        });
      }

      await tx.maintenanceProfile.update({
        where: { id: req.params.id },
        data: {
          name: data.name,
          order: data.order ?? 0,
          isActive: data.isActive ?? true
        }
      });
      return tx.maintenanceProfile.findUniqueOrThrow({
        where: { id: req.params.id },
        include: { items: { orderBy: { order: 'asc' } } }
      });
    });
    res.json(profile);
  })
);

defineRoute(router, opsRoute('DELETE /maintenance/profiles/:id', { tag: 'equipamentos', summary: 'Equipamentos: Excluir manutenção › perfis (por id)', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 200: jsonResponseSchema }, errors: [401, 403, 404] }),
  requireEquipamentosManager,
  asyncHandler(async (req, res) => {
    const profile = await prisma.maintenanceProfile.findUnique({
      where: { id: req.params.id },
      include: {
        _count: {
          select: {
            categoryDefaults: true,
            equipment: true,
            maintenanceRecords: true
          }
        }
      }
    });
    if (!profile) return res.status(404).json({ error: 'Perfil de manutenção não encontrado.' });
    if (
      profile._count.categoryDefaults ||
      profile._count.equipment ||
      profile._count.maintenanceRecords
    ) {
      const disabled = await prisma.maintenanceProfile.update({
        where: { id: profile.id },
        data: { isActive: false },
        include: { items: { orderBy: { order: 'asc' } } }
      });
      return res.json(disabled);
    }
    await prisma.maintenanceProfile.delete({ where: { id: profile.id } });
    return res.status(204).end();
  })
);

// === Equipamentos ===

defineRoute(router, opsRoute('GET /', { tag: 'equipamentos', summary: 'Equipamentos: Listar registros', responses: { 200: jsonResponseSchema }, errors: [401, 403] }),
  asyncHandler(async (req, res) => {
    const where = { isActive: true };
    if (req.query.categoryId) where.categoryId = String(req.query.categoryId);
    const items = await prisma.companyEquipment.findMany({
      where,
      orderBy: [{ code: 'asc' }],
      include: {
        ...equipmentAttachmentsInclude,
        category: true,
        maintenanceProfile: {
          include: {
            items: { where: { isActive: true }, orderBy: { order: 'asc' } }
          }
        }
      }
    });
    res.json(await withRomaneioCatalogIds(prisma, items.map(withCurrentAttachments)));
  })
);

defineRoute(router, opsRoute('GET /:id/maintenance-history', { tag: 'equipamentos', summary: 'Equipamentos: Listar manutenção histórico', responses: { 200: jsonResponseSchema }, errors: [401, 403, 404] }),
  asyncHandler(async (req, res) => {
    const equipment = await prisma.companyEquipment.findUnique({
      where: { id: req.params.id },
      select: { id: true, code: true, name: true }
    });
    if (!equipment) return res.status(404).json({ error: 'Equipamento não encontrado.' });
    const records = await prisma.maintenanceRecord.findMany({
      where: { equipmentId: equipment.id, status: 'APPROVED' },
      include: maintenanceRecordInclude,
      orderBy: [{ maintenanceDate: 'desc' }, { createdAt: 'desc' }]
    });
    res.json({
      equipment,
      items: records.map(record => ({
        id: record.id,
        maintenanceDate: record.maintenanceDate.toISOString().slice(0, 10),
        responsibleName: record.responsibleNameSnapshot,
        profileName: record.profileNameSnapshot,
        selectedServices: Array.isArray(record.selectedServices) ? record.selectedServices : [],
        observations: record.observations,
        thirdPartyServices: record.thirdPartyServices.map(item => ({
          ...item,
          serviceDate: item.serviceDate.toISOString().slice(0, 10)
        })),
        approvedAt: record.approvedAt,
        supervisorName: record.supervisorNameSnapshot,
        document: serializeMaintenanceAttachment(record.attachments.find(item => item.kind === 'DOCUMENT'))
      }))
    });
  })
);

async function persistAttachments(equipmentId, { calibrationCertificate, technicalDoc, technicalPhotos, removeTechnicalPhotoIds }) {
  const created = {
    calibrationCertificate: null,
    technicalDoc: null,
    technicalPhotos: []
  };
  if (calibrationCertificate) {
    created.calibrationCertificate = await createEquipmentAttachment(prisma, {
      equipmentId,
      kind: EquipmentAttachmentKinds.CALIBRATION_CERTIFICATE,
      upload: calibrationCertificate
    });
  }
  if (technicalDoc) {
    created.technicalDoc = await createEquipmentAttachment(prisma, {
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
      const photo = await createEquipmentPhoto(prisma, { equipmentId, upload });
      if (photo) created.technicalPhotos.push(photo);
    }
  }
  return created;
}

// Gera o PDF "atual" dos Dados Técnicos com os dados recém-salvos e o guarda como o
// datasheet gerado mais recente (servido no botão de baixar do card). O PDF anterior
// continua existindo e passa automaticamente a constar como ARQUIVADO no histórico —
// cada revisão tem seu próprio PDF, com a revisão no nome ("… - Rev N.pdf").
// Chamado APÓS gravar dados e fotos, para o PDF refletir o estado final.
// Best-effort: uma falha na geração não bloqueia o salvamento dos dados técnicos.
async function regenerateCurrentTechnicalDoc(equipmentId) {
  const equipment = await prisma.companyEquipment.findUnique({
    where: { id: equipmentId },
    include: { category: true }
  });
  const category = equipment?.category;
  if (!category?.technicalDocEnabled) return;
  const data = equipment.technicalData;
  if (!data || typeof data !== 'object' || !Object.keys(data).length) return;
  const revision = equipment.technicalRevision ?? 0;
  try {
    const photoAssets = await resolveEquipmentPhotoAssets(prisma, equipment.id);
    const { bytes, fileName } = await generateTechnicalDatasheetPdf(equipment, category, photoAssets, revision);
    await createGeneratedEquipmentAttachment(prisma, {
      equipmentId: equipment.id,
      kind: EquipmentAttachmentKinds.TECHNICAL_DOC_GENERATED,
      fileName,
      bytes
    });
  } catch (error) {
    console.error('Falha ao gerar datasheet da revisão:', error);
  }
}

defineRoute(router, opsRoute('POST /', { tag: 'equipamentos', summary: 'Equipamentos: Criar registro', body: equipmentSchema, responses: { 201: jsonResponseSchema }, errors: [400, 401, 403, 409] }),
  requireEquipamentosManager,
  asyncHandler(async (req, res) => {
    const data = equipmentSchema.parse(req.body);
    const { calibrationCertificate, technicalDoc, technicalPhotos, ...fields } = data;
    const startsWithTechnicalContent = Boolean(hasTechnicalRecordContent(fields.technicalData) || hasTechnicalRecordContent(fields.technicalFieldOverrides) || (Array.isArray(technicalPhotos) && technicalPhotos.length > 0));
    const baseData = {
      code: fields.code,
      name: fields.name,
      categoryId: fields.categoryId,
      maintenanceProfileId: fields.maintenanceProfileId || null,
      maintenanceProfileOverride:
        fields.maintenanceProfileOverride ?? Boolean(fields.maintenanceProfileId),
      attributes: fields.attributes ?? {},
      technicalData: fields.technicalData ?? {},
      technicalFieldOverrides: fields.technicalFieldOverrides ?? {},
      checklistItems: fields.checklistItems == null ? null : normalizeChecklistItems(fields.checklistItems),
      technicalRevision: 0,
      technicalUpdatedAt: startsWithTechnicalContent ? new Date() : null,
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
      ? await prisma.companyEquipment.update({
          where: { id: existing.id },
          data: { ...baseData, isActive: true }
        })
      : await prisma.companyEquipment.create({ data: baseData });
    await persistAttachments(item.id, {
      calibrationCertificate,
      technicalDoc,
      technicalPhotos
    });
    if (startsWithTechnicalContent) {
      await regenerateCurrentTechnicalDoc(item.id);
    }
    invalidateCaches();
    await syncRomaneioCatalog();
    const fresh = await prisma.companyEquipment.findUnique({
      where: { id: item.id },
      include: { ...equipmentAttachmentsInclude, category: { select: { name: true } } }
    });
    await notifyEquipmentCreatedSafely({ equipment: fresh });
    res.status(201).json(await withRomaneioCatalogIds(prisma, withCurrentAttachments(fresh)));
  })
);

defineRoute(router, opsRoute('PUT /:id', { tag: 'equipamentos', summary: 'Equipamentos: Atualizar registro (por id)', body: libValidatedBodySchema, validatedBy: 'handler/serviço (corpo conferido fora do contrato)', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }),
  requireEquipamentosManager,
  asyncHandler(async (req, res) => {
    const data = equipmentSchema.partial().parse(req.body);
    const { calibrationCertificate, technicalDoc, technicalPhotos, removeTechnicalPhotoIds, removeCalibrationCertificate, removeTechnicalDoc, ...fields } = data;
    const previous = await prisma.companyEquipment.findUnique({
      where: { id: req.params.id },
      select: {
        expiresAt: true,
        technicalData: true,
        technicalFieldOverrides: true,
        technicalRevision: true,
        technicalUpdatedAt: true
      }
    });
    // Uma edição com outro padrão não deve apagar chaves que ficaram fora do formulário.
    if (fields.technicalData !== undefined) {
      fields.technicalData = { ...technicalRecord(previous?.technicalData), ...fields.technicalData };
    }
    if (fields.technicalFieldOverrides !== undefined) {
      fields.technicalFieldOverrides = { ...technicalRecord(previous?.technicalFieldOverrides), ...fields.technicalFieldOverrides };
    }
    const technicalChanged = technicalPayloadChanged(previous, fields, {
      technicalPhotos,
      removeTechnicalPhotoIds
    });
    const shouldBumpRevision = shouldIncrementTechnicalRevision(previous, fields, { technicalPhotos, removeTechnicalPhotoIds });
    const payload = {
      ...(fields.code !== undefined ? { code: fields.code } : {}),
      ...(fields.name !== undefined ? { name: fields.name } : {}),
      ...(fields.categoryId !== undefined ? { categoryId: fields.categoryId } : {}),
      ...(fields.maintenanceProfileId !== undefined ? { maintenanceProfileId: fields.maintenanceProfileId || null } : {}),
      ...(fields.maintenanceProfileOverride !== undefined
        ? { maintenanceProfileOverride: fields.maintenanceProfileOverride }
        : fields.maintenanceProfileId !== undefined
          ? { maintenanceProfileOverride: true }
          : {}),
      ...(fields.attributes !== undefined ? { attributes: fields.attributes } : {}),
      ...(fields.technicalFieldOverrides !== undefined ? { technicalFieldOverrides: fields.technicalFieldOverrides } : {}),
      ...(fields.checklistItems !== undefined
        ? {
            checklistItems: fields.checklistItems === null ? null : normalizeChecklistItems(fields.checklistItems)
          }
        : {}),
      ...(fields.hasTechnicalDoc !== undefined ? { hasTechnicalDoc: fields.hasTechnicalDoc } : {})
    };
    // Após o primeiro preenchimento, alterações nos Dados Técnicos geram nova revisão.
    // O primeiro preenchimento salva a linha-base como revisão 0.
    if (fields.technicalData !== undefined) {
      payload.technicalData = fields.technicalData;
    }
    if (technicalChanged) {
      payload.technicalUpdatedAt = new Date();
    }
    if (shouldBumpRevision) {
      payload.technicalRevision = { increment: 1 };
    }
    if (fields.hasCalibration !== undefined) {
      payload.hasCalibration = fields.hasCalibration;
      payload.calibratedAt = fields.hasCalibration && fields.calibratedAt ? new Date(fields.calibratedAt) : null;
      payload.expiresAt = fields.hasCalibration && fields.expiresAt ? new Date(fields.expiresAt) : null;
    } else {
      if (fields.calibratedAt !== undefined) payload.calibratedAt = fields.calibratedAt ? new Date(fields.calibratedAt) : null;
      if (fields.expiresAt !== undefined) payload.expiresAt = fields.expiresAt ? new Date(fields.expiresAt) : null;
    }
    const item = await prisma.companyEquipment.update({
      where: { id: req.params.id },
      data: payload
    });
    const createdAttachments = await persistAttachments(item.id, {
      calibrationCertificate,
      technicalDoc,
      technicalPhotos,
      removeTechnicalPhotoIds
    });
    if (removeCalibrationCertificate) {
      await removeEquipmentAttachments(prisma, item.id, EquipmentAttachmentKinds.CALIBRATION_CERTIFICATE, {
        exceptIds: [createdAttachments.calibrationCertificate?.id]
      });
    }
    if (removeTechnicalDoc && !technicalDoc) {
      await removeEquipmentAttachments(prisma, item.id, EquipmentAttachmentKinds.TECHNICAL_DOC);
    }
    // Gera o PDF da linha-base ou da nova revisão como datasheet atual. Quando há
    // revisão nova, o PDF anterior continua e vira "arquivado" no histórico.
    if (technicalChanged && (shouldBumpRevision || !hasTechnicalRevisionBaseline(previous))) {
      await regenerateCurrentTechnicalDoc(item.id);
    }
    invalidateCaches();
    await syncRomaneioCatalog();
    const fresh = await prisma.companyEquipment.findUnique({
      where: { id: item.id },
      include: {
        ...equipmentAttachmentsInclude,
        category: { select: { name: true } }
      }
    });
    if (fresh?.hasCalibration) {
      await notifyCalibrationUpdatedSafely({
        equipment: fresh,
        previousExpiresAt: previous?.expiresAt
      });
    }
    res.json(await withRomaneioCatalogIds(prisma, withCurrentAttachments(fresh)));
  })
);

defineRoute(router, opsRoute('GET /:id/documents', { tag: 'equipamentos', summary: 'Equipamentos: Listar documentos', responses: { 200: jsonResponseSchema }, errors: [401, 403, 404] }), asyncHandler(async (req, res) => {
  const equipment = await prisma.companyEquipment.findUnique({ where: { id: req.params.id } });
  if (!equipment?.isActive) return res.status(404).json({ error: 'Equipamento não encontrado.' });
  const documents = await prisma.equipmentAttachment.findMany({
    where: { equipmentId: equipment.id, kind: EquipmentAttachmentKinds.DOCUMENT },
    orderBy: { createdAt: 'desc' }
  });
  res.json(documents.map(serializeEquipmentAttachment));
}));

defineRoute(router, opsRoute('POST /:id/documents', { tag: 'equipamentos', summary: 'Equipamentos: Criar documentos', body: libValidatedBodySchema, validatedBy: 'handler/serviço (corpo conferido fora do contrato)', responses: { 201: jsonResponseSchema }, errors: [400, 401, 403, 404, 429] }), requireEquipamentosManager, ...expensiveRouteLimit('upload'), asyncHandler(async (req, res) => {
  const upload = pdfUploadSchema.unwrap().unwrap().parse(req.body);
  const equipment = await prisma.companyEquipment.findUnique({ where: { id: req.params.id }, include: { category: true } });
  if (!equipment?.isActive) return res.status(404).json({ error: 'Equipamento não encontrado.' });
  if (!equipment.category?.isActive || !equipment.category?.attachmentsEnabled) {
    return res.status(400).json({ error: 'Ative “Anexar documentos” na categoria deste equipamento.' });
  }
  const attachment = await createEquipmentAttachment(prisma, { equipmentId: equipment.id, kind: EquipmentAttachmentKinds.DOCUMENT, upload });
  if (!attachment) return res.status(400).json({ error: 'Informe um arquivo PDF.' });
  invalidateCaches();
  res.status(201).json(serializeEquipmentAttachment(attachment));
}));

defineRoute(router, opsRoute('DELETE /:id/documents/:documentId', { tag: 'equipamentos', summary: 'Equipamentos: Excluir documentos (por id)', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 204: EMPTY }, errors: [401, 403, 404] }), requireEquipamentosManager, asyncHandler(async (req, res) => {
  const equipment = await prisma.companyEquipment.findUnique({ where: { id: req.params.id } });
  if (!equipment?.isActive) return res.status(404).json({ error: 'Equipamento não encontrado.' });
  const removed = await removeEquipmentDocument(prisma, equipment.id, req.params.documentId);
  if (!removed) return res.status(404).json({ error: 'Documento não encontrado neste equipamento.' });
  invalidateCaches();
  res.status(204).end();
}));

// Gera (ou regenera) o datasheet em PDF a partir dos Dados Técnicos preenchidos.
// O PDF novo vira o atual; os anteriores permanecem no histórico.
defineRoute(router, opsRoute('POST /:id/technical-doc', { tag: 'equipamentos', summary: 'Equipamentos: Gera (ou regenera) o datasheet em PDF a partir dos Dados Técnicos preenchidos', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 201: jsonResponseSchema }, errors: [400, 401, 403, 404, 429] }),
  requireEquipamentosManager,
  ...expensiveRouteLimit('generation'),
  asyncHandler(async (req, res) => {
    const equipment = await prisma.companyEquipment.findUnique({
      where: { id: req.params.id },
      include: { category: true }
    });
    if (!equipment) {
      return res.status(404).json({ error: 'Equipamento não encontrado.' });
    }
    if (!equipment.category?.technicalDocEnabled) {
      return res.status(400).json({
        error: 'A categoria deste equipamento não tem Dados Técnicos habilitados.'
      });
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
  })
);

// Checklist impresso de funcionamento: modelo próprio ou herança da categoria.
defineRoute(router, {
  method: 'put', path: '/:id/functioning-checklist', auth: 'session', tags: ['Equipamentos'],
  summary: 'Salvar modelo próprio de funcionamento ou restaurar a herança da categoria',
  params: z.object({ id: z.string().min(1) }), body: functioningChecklistPayloadSchema,
  responses: { 200: z.looseObject({ id: z.string(), functioningChecklist: functioningChecklistSchema.nullable() }) },
  errors: [400, 401, 403, 404], validateInput: 'handler', validatedBy: 'functioningChecklistPayloadSchema'
}, requireEquipamentosManager, asyncHandler(async (req, res) => {
  const { template } = functioningChecklistPayloadSchema.parse(req.body);
  const equipment = await prisma.companyEquipment.findUnique({ where: { id: req.params.id } });
  if (!equipment?.isActive) return res.status(404).json({ error: 'Equipamento não encontrado.' });
  await prisma.companyEquipment.update({
    where: { id: equipment.id },
    data: { functioningChecklist: template === null ? Prisma.DbNull : template }
  });
  invalidateCaches();
  return res.json(await loadEquipmentWithAttachments(equipment.id));
}));

defineRoute(router, {
  method: 'get', path: '/:id/functioning-checklist/:format', auth: 'session', tags: ['Equipamentos'],
  summary: 'Baixar o modelo vigente de funcionamento para impressão (PDF ou XLSX)',
  params: z.object({ id: z.string().min(1), format: z.enum(['pdf', 'xlsx']) }),
  responses: { 200: null }, errors: [400, 401, 403, 404, 429]
}, ...expensiveRouteLimit('generation'), asyncHandler(async (req, res) => {
  const format = z.enum(['pdf', 'xlsx']).parse(req.params.format);
  const equipment = await prisma.companyEquipment.findUnique({ where: { id: req.params.id }, include: { category: true } });
  if (!equipment?.isActive) return res.status(404).json({ error: 'Equipamento não encontrado.' });
  const bytes = format === 'xlsx'
    ? buildFunctioningChecklistXlsx(equipment, equipment.category)
    : await buildFunctioningChecklistPdf(equipment, equipment.category);
  res.type(format === 'xlsx' ? CHECKLIST_XLSX_MIME : 'application/pdf');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Disposition', inlineContentDisposition(functioningChecklistFileName(equipment, format)));
  return res.send(bytes);
}));

// Link da página pública e acesso de cada documento; só o gestor altera o acesso.
defineRoute(router, opsRoute('GET /:id/qr-link', { tag: 'equipamentos', summary: 'Equipamentos: Link da página pública e acesso de cada documento', responses: { 200: jsonResponseSchema }, errors: [401, 403, 404] }), asyncHandler(async (req, res) => {
  const settings = await buildQrLinkSettings(prisma, req.params.id);
  if (!settings) return res.status(404).json({ error: 'Equipamento não encontrado.' });
  return res.json(settings);
}));

defineRoute(router, opsRoute('PUT /:id/qr-access', { tag: 'equipamentos', summary: 'Equipamentos: Atualizar qr access', body: libValidatedBodySchema, validatedBy: 'handler/serviço (corpo conferido fora do contrato)', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireEquipamentosManager, asyncHandler(async (req, res) => {
  const { access } = z.object({ access: z.record(z.string(), z.enum(['PUBLIC', 'LOGIN', 'HIDDEN'])) }).parse(req.body);
  const equipment = await prisma.companyEquipment.findUnique({ where: { id: req.params.id }, select: { id: true, isActive: true } });
  if (!equipment?.isActive) return res.status(404).json({ error: 'Equipamento não encontrado.' });
  await prisma.companyEquipment.update({ where: { id: equipment.id }, data: { qrDocumentAccess: normalizeQrAccess(access) } });
  invalidateCaches();
  return res.json(await buildQrLinkSettings(prisma, equipment.id));
}));

// Gera o PDF do Manual de Operação com os passos efetivos (próprios ou da categoria)
// e o guarda como o manual atual; o anterior é removido (sem histórico de PDFs).
async function regenerateOperationManual(equipmentId) {
  const equipment = await prisma.companyEquipment.findUnique({
    where: { id: equipmentId },
    include: { category: true }
  });
  if (!equipment) return null;
  if (!resolveEffectiveOperationSteps(equipment, equipment.category).length) return null;
  const photoAssets = await resolveOperationPhotoAssets(prisma, { equipmentId, categoryId: equipment.categoryId });
  const { bytes, fileName } = await generateOperationManualPdf(equipment, equipment.category, photoAssets);
  const attachment = await createGeneratedEquipmentAttachment(prisma, {
    equipmentId,
    kind: EquipmentAttachmentKinds.OPERATION_MANUAL_GENERATED,
    fileName,
    bytes
  });
  if (attachment) {
    await removeEquipmentAttachments(prisma, equipmentId, EquipmentAttachmentKinds.OPERATION_MANUAL_GENERATED, { exceptIds: [attachment.id] });
  }
  return attachment;
}

async function loadEquipmentWithAttachments(id) {
  const fresh = await prisma.companyEquipment.findUnique({
    where: { id },
    include: { ...equipmentAttachmentsInclude, category: { select: { name: true } } }
  });
  return withCurrentAttachments(fresh);
}

// Salva os passos próprios do equipamento (lista vazia = volta a herdar o modelo da
// categoria) e regenera o PDF do manual. Só gestor.
defineRoute(router, opsRoute('PUT /:id/operation-manual', { tag: 'equipamentos', summary: 'Equipamentos: Salva os passos próprios do equipamento (lista vazia = volta a herdar o modelo da categoria) e regenera o PDF do manual', body: libValidatedBodySchema, validatedBy: 'handler/serviço (corpo conferido fora do contrato)', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }),
  requireEquipamentosManager,
  asyncHandler(async (req, res) => {
    const { steps } = z.object({ steps: equipmentOperationStepsSchema }).parse(req.body);
    const equipment = await prisma.companyEquipment.findUnique({
      where: { id: req.params.id },
      include: { category: true }
    });
    if (!equipment?.isActive) return res.status(404).json({ error: 'Equipamento não encontrado.' });
    if (!equipment.category?.operationManualEnabled) {
      return res.status(400).json({ error: 'A categoria deste equipamento não tem o Manual de Operação habilitado.' });
    }

    // Fotos: reaproveita as já salvas deste equipamento, grava as novas e copia para o equipamento as
    // fotos do modelo da categoria quando os passos herdados passam a ser próprios.
    const nextItems = await resolveOperationStepItems(prisma, {
      equipmentId: equipment.id,
      categoryId: equipment.categoryId,
      steps
    });
    const previousItems = Array.isArray(equipment.operationSteps) ? normalizeOperationStepItems(equipment.operationSteps) : [];
    if (JSON.stringify(previousItems) !== JSON.stringify(nextItems)) {
      await prisma.companyEquipment.update({
        where: { id: equipment.id },
        data: {
          operationSteps: nextItems.length ? serializeOperationStepItems(nextItems) : Prisma.DbNull,
          operationRevision: { increment: 1 },
          operationUpdatedAt: new Date()
        }
      });
    }
    // Fotos que deixaram de ser referenciadas por algum passo são apagadas.
    await pruneOperationPhotos(prisma, { equipmentId: equipment.id }, nextItems);
    let pdfError = null;
    try {
      await regenerateOperationManual(equipment.id);
    } catch (error) {
      console.error('Falha ao gerar manual de operação:', error);
      pdfError = 'Os passos foram salvos, mas não foi possível gerar o PDF. Tente novamente.';
    }
    invalidateCaches();
    return res.json({ equipment: await loadEquipmentWithAttachments(equipment.id), pdfError });
  })
);

// Regenera apenas o PDF (ex.: manual desatualizado após mudança no modelo da categoria).
defineRoute(router, opsRoute('POST /:id/operation-manual/pdf', { tag: 'equipamentos', summary: 'Equipamentos: Regenera apenas o PDF (ex', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404, 429] }),
  requireEquipamentosManager,
  ...expensiveRouteLimit('generation'),
  asyncHandler(async (req, res) => {
    const equipment = await prisma.companyEquipment.findUnique({
      where: { id: req.params.id },
      include: { category: true }
    });
    if (!equipment?.isActive) return res.status(404).json({ error: 'Equipamento não encontrado.' });
    if (!equipment.category?.operationManualEnabled) {
      return res.status(400).json({ error: 'A categoria deste equipamento não tem o Manual de Operação habilitado.' });
    }
    if (!resolveEffectiveOperationSteps(equipment, equipment.category).length) {
      return res.status(400).json({ error: 'Cadastre os passos do manual (no equipamento ou no modelo da categoria) antes de gerar o PDF.' });
    }
    await regenerateOperationManual(equipment.id);
    invalidateCaches();
    return res.json({ equipment: await loadEquipmentWithAttachments(equipment.id), pdfError: null });
  })
);

defineRoute(router, opsRoute('DELETE /:id', { tag: 'equipamentos', summary: 'Equipamentos: Excluir registro (por id)', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 204: EMPTY }, errors: [401, 403] }),
  requireEquipamentosManager,
  asyncHandler(async (req, res) => {
    await prisma.companyEquipment.update({
      where: { id: req.params.id },
      data: { isActive: false }
    });
    invalidateCaches();
    await syncRomaneioCatalog();
    res.status(204).end();
  })
);

// === Vínculo dos slots de equipamento do RDO com categorias ===

// Aceita o formato novo (categoryIds[]) e o legado (categoryId) — normaliza para array.
const slotMappingSchema = z.object({
  categoryIds: z.array(z.string().trim().min(1)).optional(),
  secondaryCategoryIds: z.array(z.string().trim().min(1)).optional(),
  categoryId: z.string().trim().min(1).nullable().optional()
});

defineRoute(router, opsRoute('GET /rdo-slots', { tag: 'equipamentos', summary: 'Equipamentos: Listar posições do RDO', responses: { 200: jsonResponseSchema }, errors: [401, 403] }),
  asyncHandler(async (_req, res) => {
    const { slots } = await resolveRdoSlotMap();
    res.json(slots);
  })
);

defineRoute(router, opsRoute('PUT /rdo-slots/:slotKey', { tag: 'equipamentos', summary: 'Equipamentos: Atualizar posições do RDO (por id)', body: slotMappingSchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }),
  requireEquipamentosManager,
  asyncHandler(async (req, res) => {
    const slot = getSlot(req.params.slotKey);
    if (!slot) return res.status(404).json({ error: 'Slot de relatório não encontrado.' });
    const parsed = slotMappingSchema.parse(req.body);
    // Normaliza para lista (sem duplicados); aceita o legado categoryId.
    const categoryIds = [...new Set([...(parsed.categoryIds || []), ...(parsed.categoryId ? [parsed.categoryId] : [])])];
    const existing = await prisma.rdoEquipmentSlot.findUnique({ where: { slotKey: slot.key } });
    const secondaryCategoryIds = [...new Set(parsed.secondaryCategoryIds
      ?? (Array.isArray(existing?.secondaryCategoryIds) ? existing.secondaryCategoryIds : []))]
      .filter(id => !categoryIds.includes(id));
    const allCategoryIds = [...categoryIds, ...secondaryCategoryIds];
    if (allCategoryIds.length) {
      const valid = await prisma.equipmentCategory.findMany({
        where: { id: { in: allCategoryIds }, isActive: true },
        select: { id: true }
      });
      if (valid.length !== allCategoryIds.length) {
        return res.status(400).json({ error: 'Categoria inválida.' });
      }
    }
    await prisma.rdoEquipmentSlot.upsert({
      where: { slotKey: slot.key },
      create: {
        slotKey: slot.key,
        categoryIds,
        secondaryCategoryIds,
        categoryId: categoryIds[0] || null
      },
      update: { categoryIds, secondaryCategoryIds, categoryId: categoryIds[0] || null }
    });
    invalidateCaches();
    const { slots } = await resolveRdoSlotMap();
    res.json(slots.find(item => item.key === slot.key));
  })
);

// === Notificações de equipamentos (destinatários + configuração) ===

const notificationConfigSchema = z.object({
  enabled: z.boolean().optional(),
  notifyOnEquipmentCreated: z.boolean().optional(),
  milestoneDays: z.array(z.number()).optional(),
  notifyOnDueDay: z.boolean().optional(),
  repeatExpired: z.boolean().optional(),
  repeatGapDays: z.number().int().positive().optional()
});

const recipientPreferencesSchema = z.object({
  isActive: z.boolean().optional(),
  notifyCalibrationReminders: z.boolean().optional(),
  notifyCalibrationUpdated: z.boolean().optional(),
  notifyEquipmentCreated: z.boolean().optional()
});

const recipientSchema = z
  .object({
    userId: z.string().trim().min(1).optional().nullable(),
    email: z.string().trim().email().optional(),
    ...recipientPreferencesSchema.omit({ isActive: true }).shape
  })
  .refine(data => data.userId || data.email, {
    message: 'Informe uma conta ou um e-mail.'
  });

defineRoute(router, opsRoute('GET /notifications/config', { tag: 'equipamentos', summary: 'Equipamentos: Listar notificações › configuração', responses: { 200: jsonResponseSchema }, errors: [401, 403] }),
  asyncHandler(async (_req, res) => {
    res.json(await getEquipmentNotificationConfig());
  })
);

defineRoute(router, opsRoute('PUT /notifications/config', { tag: 'equipamentos', summary: 'Equipamentos: Atualizar notificações › configuração', body: notificationConfigSchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }),
  requireEquipamentosManager,
  asyncHandler(async (req, res) => {
    const data = notificationConfigSchema.parse(req.body);
    res.json(await updateEquipmentNotificationConfig(prisma, data));
  })
);

// Contas internas elegíveis a receber notificações (para o seletor da UI).
defineRoute(router, opsRoute('GET /notifications/accounts', { tag: 'equipamentos', summary: 'Equipamentos: Contas internas elegíveis a receber notificações (para o seletor da UI)', responses: { 200: jsonResponseSchema }, errors: [401, 403] }),
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      where: { isActive: true, accountType: { in: ['ADMIN', 'INTERNAL'] } },
      select: { id: true, name: true, email: true, username: true },
      orderBy: { name: 'asc' }
    });
    res.json(
      users
        .map(user => ({
          id: user.id,
          name: user.name,
          email: normalizeEmail(user.email) || (user.username.includes('@') ? normalizeEmail(user.username) : '')
        }))
        .filter(user => user.email)
    );
  })
);

defineRoute(router, opsRoute('GET /notifications/recipients', { tag: 'equipamentos', summary: 'Equipamentos: Listar notificações › destinatários', responses: { 200: jsonResponseSchema }, errors: [401, 403] }),
  asyncHandler(async (_req, res) => {
    res.json(await listEquipmentNotificationRecipients());
  })
);

defineRoute(router, opsRoute('POST /notifications/recipients', { tag: 'equipamentos', summary: 'Equipamentos: Criar notificações › destinatários', body: recipientSchema, responses: { 201: jsonResponseSchema }, errors: [400, 401, 403] }),
  requireEquipamentosManager,
  asyncHandler(async (req, res) => {
    const data = recipientSchema.parse(req.body);
    let email = data.email ? normalizeEmail(data.email) : '';
    let userId = data.userId || null;
    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, username: true, isActive: true }
      });
      if (!user || !user.isActive) return res.status(400).json({ error: 'Conta inválida.' });
      email = normalizeEmail(user.email) || (user.username.includes('@') ? normalizeEmail(user.username) : '');
      if (!email) return res.status(400).json({ error: 'A conta não possui e-mail válido.' });
    }
    if (!email) return res.status(400).json({ error: 'Informe um e-mail válido.' });
    const recipient = await prisma.equipmentNotificationRecipient.upsert({
      where: { email },
      create: { ...data, email, userId, isActive: true },
      update: { ...data, email, userId, isActive: true }
    });
    res.status(201).json(recipient);
  })
);

defineRoute(router, opsRoute('PUT /notifications/recipients/:id', { tag: 'equipamentos', summary: 'Equipamentos: Atualizar notificações › destinatários (por id)', body: recipientPreferencesSchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }),
  requireEquipamentosManager,
  asyncHandler(async (req, res) => {
    const data = recipientPreferencesSchema.parse(req.body);
    const recipient = await prisma.equipmentNotificationRecipient.update({
      where: { id: req.params.id },
      data
    });
    res.json(recipient);
  })
);

defineRoute(router, opsRoute('DELETE /notifications/recipients/:id', { tag: 'equipamentos', summary: 'Equipamentos: Excluir notificações › destinatários (por id)', noBody: 'Sem corpo: a ação é definida pelo caminho.', responses: { 204: EMPTY }, errors: [401, 403] }),
  requireEquipamentosManager,
  asyncHandler(async (req, res) => {
    await prisma.equipmentNotificationRecipient.delete({
      where: { id: req.params.id }
    });
    res.status(204).end();
  })
);

export default router;
