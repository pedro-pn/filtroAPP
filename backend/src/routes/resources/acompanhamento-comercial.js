/*
 * Módulo Acompanhamento de Projetos — importação do banco comercial Access.
 *
 *   POST /api/acompanhamento/comercial/import   — envio do .accdb por script (token de serviço)
 *   GET  /api/acompanhamento/comercial/imports  — histórico (admin do hub)
 *
 * Auth do POST é não-interativa (token de serviço COMMERCIAL_IMPORT_TOKEN) porque o envio é feito
 * por um script periódico na máquina do comercial — ver tools/comercial-import/.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

import express, { Router } from 'express';
import { z } from 'zod';

import env from '../../config/env.js';
import asyncHandler from '../../lib/async-handler.js';
import { importCommercialAccess, listCommercialDashboard, listCommercialPendencias, listProjectRevisions, removeProjectAdditionalProposal, setProjectAdditionalProposalRevision, setProjectBudgetRevision, setProjectSchedule } from '../../lib/acompanhamento/access-import.js';
import { createManualProjectCost, deleteManualProjectCost } from '../../lib/acompanhamento/manual-costs.js';
import { getPlannedScope, setPlannedScope } from '../../lib/acompanhamento/planned-scope.js';
import { computeProjectProgress } from '../../lib/acompanhamento/avanco.js';
import { buildOmieCostCategoryWhere } from '../../lib/acompanhamento/cost-categories.js';
import { listProjectCards } from '../../lib/acompanhamento/project-cards.js';
import { getProjectStandbyHistory } from '../../lib/acompanhamento/standby-history.js';
import { getMissionGroupRomaneios, getProjectRomaneios } from '../../lib/acompanhamento/project-romaneios.js';
import { groupProjectCards } from '../../lib/acompanhamento/project-card-groups.js';
import { groupDashboardRows } from '../../lib/acompanhamento/dashboard-groups.js';
import { getProjectDetail } from '../../lib/acompanhamento/project-detail.js';
import { getProjectInvoices, getMissionGroupInvoices } from '../../lib/acompanhamento/project-invoices.js';
import { createProjectManagementNote, listProjectManagementNotes, PROJECT_MANAGEMENT_NOTE_MAX_LENGTH } from '../../lib/acompanhamento/project-notes.js';
import { getOfficialMissionContext } from '../../lib/efetivo/planning/official-mission-context.js';
import { getMissionGroupDetail } from '../../lib/acompanhamento/project-detail-groups.js';
import { createMissionGroup, dissolveMissionGroup, listMissionGroups, loadActiveMissionGroups, MissionGroupError, updateMissionGroup } from '../../lib/acompanhamento/mission-groups.js';
import { isSalaryCategory } from '../../lib/acompanhamento/salary.js';
import { listSedeCosts } from '../../lib/acompanhamento/sede-costs.js';
import { listSedeOperationalMetrics } from '../../lib/acompanhamento/sede-operational-metrics.js';
import prisma from '../../lib/prisma.js';
import { canViewAcompanhamentoLaborCosts, requireAcompanhamentoAccess, requireAcompanhamentoManager, requireAuth } from '../../middleware/auth.js';

const router = Router();

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB (arquivo real ~1 MB)
const monthParamSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês inválido. Use o formato YYYY-MM.');
const sedeCostRangeQuerySchema = z
  .object({
    from: monthParamSchema.optional(),
    to: monthParamSchema.optional()
  })
  .superRefine((value, ctx) => {
    if (Boolean(value.from) !== Boolean(value.to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Informe mês inicial e final para filtrar a Sede.'
      });
    }
    if (value.from && value.to && value.from > value.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: 'Período inválido: mês final anterior ao inicial.'
      });
    }
  });

export function parseSedeCostRangeQuery(query) {
  const { from, to } = sedeCostRangeQuerySchema.parse(query ?? {});
  return from && to ? { fromMonth: from, toMonth: to } : null;
}

const missionGroupStatusQuerySchema = z.object({
  status: z.enum(['ACTIVE', 'DISSOLVED', 'ALL']).optional().default('ACTIVE')
});

const missionGroupCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    projectIds: z.array(z.string().trim().min(1)).min(2).max(50)
  })
  .superRefine((value, ctx) => {
    if (new Set(value.projectIds).size !== value.projectIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['projectIds'],
        message: 'Selecione missões diferentes para unificar.'
      });
    }
  });

const missionGroupUpdateSchema = z
  .object({
    name: z.string().trim().min(1, 'Informe um nome para o agrupamento.').max(120, 'Nome muito longo.').optional(),
    laborAllocationMode: z.enum(['VISUAL_ONLY', 'SHARED_EXECUTION', 'CONSOLIDATE_PRIMARY']).optional(),
    primaryLaborProjectId: z.string().trim().min(1).max(200).nullable().optional()
  })
  .strict()
  .refine(value => value.name !== undefined || value.laborAllocationMode !== undefined, {
    message: 'Informe o nome ou a política de mão de obra a alterar.'
  })
  .superRefine((value, ctx) => {
    if (value.laborAllocationMode === 'CONSOLIDATE_PRIMARY' && !value.primaryLaborProjectId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['primaryLaborProjectId'],
        message: 'Selecione a missão principal da consolidação.'
      });
    }
  });

export function parseMissionGroupUpdate(body) {
  return missionGroupUpdateSchema.parse(body);
}

const projectTrackingStateSchema = z
  .object({
    archived: z.boolean().optional(),
    reviewed: z.boolean().optional()
  })
  .refine(value => Number(value.archived !== undefined) + Number(value.reviewed !== undefined) === 1, {
    message: 'Informe apenas archived ou reviewed.'
  });

const projectIdParamSchema = z.object({
  projectId: z.string().trim().min(1).max(200)
});

const projectManagementNoteSchema = z
  .object({
    content: z.string().trim().min(1, 'Escreva uma nota antes de adicionar.').max(PROJECT_MANAGEMENT_NOTE_MAX_LENGTH, `A nota deve ter no máximo ${PROJECT_MANAGEMENT_NOTE_MAX_LENGTH} caracteres.`)
  })
  .strict();

function missionGroupErrorResponse(error, res) {
  if (error instanceof MissionGroupError) {
    const status = error.code === 'GROUP_NOT_FOUND' ? 404 : 400;
    return res.status(status).json({ error: error.message, code: error.code });
  }
  throw error;
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest();
}

function bearerToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

// Compara o token de serviço em tempo constante.
function requireServiceToken(req, res, next) {
  const expected = env.commercialImportToken;
  const provided = bearerToken(req);
  if (!expected) {
    return res.status(503).json({
      error: 'Importação comercial não configurada (COMMERCIAL_IMPORT_TOKEN ausente).'
    });
  }
  if (!provided) {
    return res.status(401).json({ error: 'Token de serviço ausente.' });
  }
  const a = sha256(provided);
  const b = sha256(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Token de serviço inválido.' });
  }
  return next();
}

// Recebe o .accdb como binário cru (mais simples para um script: `curl --data-binary @arquivo`).
router.post(
  '/import',
  requireServiceToken,
  express.raw({
    type: ['application/octet-stream', 'application/x-msaccess'],
    limit: MAX_FILE_BYTES
  }),
  asyncHandler(async (req, res) => {
    const buffer = req.body;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      return res.status(400).json({
        error: 'Corpo vazio. Envie o arquivo .accdb como application/octet-stream.'
      });
    }
    const fileName = String(req.headers['x-file-name'] || 'propostas_bd.accdb');

    try {
      const summary = await importCommercialAccess({
        buffer,
        fileName,
        importedByUserId: null,
        source: 'SCRIPT'
      });
      return res.status(summary.skippedDuplicate ? 200 : 201).json(summary);
    } catch (error) {
      return res.status(422).json({ error: `Falha ao importar o banco Access: ${error.message}` });
    }
  })
);

// Histórico de importações (auditoria). Por ora restrito ao admin do hub; quando os papéis
// `acompanhamento:*` existirem, trocar por requireModuleRole.
router.get(
  '/imports',
  requireAuth,
  requireAcompanhamentoAccess,
  asyncHandler(async (req, res) => {
    const take = Math.min(Number(req.query.limit) || 50, 200);
    const imports = await prisma.accessImport.findMany({
      orderBy: { createdAt: 'desc' },
      take
    });
    res.json(imports);
  })
);

// Dashboard de acompanhamento (previsto + realizado parcial por projeto).
router.get(
  '/dashboard',
  requireAuth,
  requireAcompanhamentoAccess,
  asyncHandler(async (req, res) => {
    const categoryCode = typeof req.query.category === 'string' && req.query.category ? req.query.category : null;
    const includeAdminOnlyCategories = req.auth?.user?.accountType === 'ADMIN';
    const [rows, groups] = await Promise.all([listCommercialDashboard({ categoryCode, includeAdminOnlyCategories }), loadActiveMissionGroups()]);
    res.json(groupDashboardRows(rows, groups));
  })
);

// Cards da aba "Projetos": indicadores por projeto (dias trabalhados, avanço, colaboradores, prazos).
router.get(
  '/projetos-cards',
  requireAuth,
  requireAcompanhamentoAccess,
  asyncHandler(async (req, res) => {
    const includeAdminOnlyCategories = req.auth?.user?.accountType === 'ADMIN';
    const [cards, groups] = await Promise.all([listProjectCards({ includeAdminOnlyCategories }), loadActiveMissionGroups()]);
    res.json(groupProjectCards(cards, groups));
  })
);

router.get(
  '/projetos/:projectId/romaneios',
  requireAuth,
  requireAcompanhamentoAccess,
  asyncHandler(async (req, res) => {
    const { projectId } = projectIdParamSchema.parse(req.params);
    const result = await getProjectRomaneios(projectId);
    if (!result) return res.status(404).json({ error: 'Projeto não encontrado.' });
    return res.json(result);
  })
);

router.get(
  '/grupos-missoes/:groupId/romaneios',
  requireAuth,
  requireAcompanhamentoAccess,
  asyncHandler(async (req, res) => {
    try {
      const groupId = z.string().trim().min(1).max(200).parse(req.params.groupId);
      return res.json(await getMissionGroupRomaneios(groupId));
    } catch (error) {
      return missionGroupErrorResponse(error, res);
    }
  })
);

router.get(
  '/projetos/:projectId/standby-historico',
  requireAuth,
  requireAcompanhamentoAccess,
  asyncHandler(async (req, res) => {
    const { projectId } = projectIdParamSchema.parse(req.params);
    const history = await getProjectStandbyHistory(projectId);
    if (!history) return res.status(404).json({ error: 'Projeto não encontrado.' });
    return res.json(history);
  })
);

router.get(
  '/projetos/:projectId/notas-gestao',
  requireAuth,
  requireAcompanhamentoAccess,
  asyncHandler(async (req, res) => {
    const { projectId } = projectIdParamSchema.parse(req.params);
    try {
      return res.json(await listProjectManagementNotes(projectId));
    } catch (error) {
      return res.status(404).json({ error: error.message });
    }
  })
);

router.post(
  '/projetos/:projectId/notas-gestao',
  requireAuth,
  requireAcompanhamentoManager,
  asyncHandler(async (req, res) => {
    const { projectId } = projectIdParamSchema.parse(req.params);
    const { content } = projectManagementNoteSchema.parse(req.body ?? {});
    try {
      const note = await createProjectManagementNote(projectId, content, {
        userId: req.auth.user.id,
        userName: req.auth.user.name
      });
      return res.status(201).json(note);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  })
);

router.patch(
  '/projetos/:projectId/acompanhamento-status',
  requireAuth,
  requireAcompanhamentoManager,
  asyncHandler(async (req, res) => {
    const data = projectTrackingStateSchema.parse(req.body ?? {});
    const project = await prisma.project.findFirst({
      where: { id: req.params.projectId, deletedAt: null },
      select: { id: true, isActive: true, acompanhamentoArchivedAt: true }
    });
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado.' });

    if (data.reviewed !== undefined && project.isActive && !project.acompanhamentoArchivedAt) {
      return res.status(400).json({
        error: 'Apenas projetos arquivados podem ser marcados como conferidos.'
      });
    }

    const updated = await prisma.project.update({
      where: { id: project.id },
      data:
        data.archived !== undefined
          ? {
              acompanhamentoArchivedAt: data.archived ? new Date() : null,
              acompanhamentoReviewedAt: null
            }
          : { acompanhamentoReviewedAt: data.reviewed ? new Date() : null },
      select: {
        id: true,
        isActive: true,
        acompanhamentoArchivedAt: true,
        acompanhamentoReviewedAt: true
      }
    });
    res.json({
      projectId: updated.id,
      archived: !updated.isActive || Boolean(updated.acompanhamentoArchivedAt),
      archivedInReports: !updated.isActive,
      archivedInAcompanhamento: Boolean(updated.acompanhamentoArchivedAt),
      reviewed: Boolean(updated.acompanhamentoReviewedAt),
      reviewedAt: updated.acompanhamentoReviewedAt
    });
  })
);

router.get(
  '/grupos-missoes',
  requireAuth,
  requireAcompanhamentoAccess,
  asyncHandler(async (req, res) => {
    const { status } = missionGroupStatusQuerySchema.parse(req.query ?? {});
    const groups = await listMissionGroups({ status });
    res.json(groups);
  })
);

router.post(
  '/grupos-missoes',
  requireAuth,
  requireAcompanhamentoManager,
  asyncHandler(async (req, res) => {
    const data = missionGroupCreateSchema.parse(req.body);
    try {
      const group = await createMissionGroup({
        ...data,
        userId: req.auth?.user?.id ?? null
      });
      res.status(201).json(group);
    } catch (error) {
      return missionGroupErrorResponse(error, res);
    }
  })
);

router.patch(
  '/grupos-missoes/:groupId',
  requireAuth,
  requireAcompanhamentoManager,
  asyncHandler(async (req, res) => {
    const data = parseMissionGroupUpdate(req.body);
    try {
      const group = await updateMissionGroup({
        groupId: req.params.groupId,
        ...data
      });
      res.json(group);
    } catch (error) {
      return missionGroupErrorResponse(error, res);
    }
  })
);

router.get(
  '/grupos-missoes/:groupId/detalhe',
  requireAuth,
  requireAcompanhamentoAccess,
  asyncHandler(async (req, res) => {
    try {
      const includeCollaboratorCosts = canViewAcompanhamentoLaborCosts(req.auth?.user);
      const includeAdminOnlyCategories = req.auth?.user?.accountType === 'ADMIN';
      const detail = await getMissionGroupDetail(req.params.groupId, {
        includeCollaboratorCosts,
        includeAdminOnlyCategories
      });
      res.json(detail);
    } catch (error) {
      return missionGroupErrorResponse(error, res);
    }
  })
);

router.post(
  '/grupos-missoes/:groupId/desmesclar',
  requireAuth,
  requireAcompanhamentoManager,
  asyncHandler(async (req, res) => {
    try {
      const result = await dissolveMissionGroup({
        groupId: req.params.groupId,
        userId: req.auth?.user?.id ?? null
      });
      res.json(result);
    } catch (error) {
      return missionGroupErrorResponse(error, res);
    }
  })
);

// Realizado (compras Omie) agrupado por categoria de gasto. Opcional: ?projectId= para um projeto.
router.get(
  '/realizado-categorias',
  requireAuth,
  requireAcompanhamentoAccess,
  asyncHandler(async (req, res) => {
    const projectId = typeof req.query.projectId === 'string' && req.query.projectId ? req.query.projectId : null;
    const categoryWhere = await buildOmieCostCategoryWhere({
      includeAdminOnly: req.auth?.user?.accountType === 'ADMIN'
    });
    const where = {
      ...(projectId ? { projectId } : { projectId: { not: null } }),
      ...categoryWhere
    };
    const groups = await prisma.omiePurchase.groupBy({
      by: ['categoriaCodigo', 'categoriaDescricao'],
      where,
      _sum: { valor: true },
      _count: { _all: true }
    });
    const rows = groups
      .filter(g => !isSalaryCategory(g.categoriaDescricao || g.categoriaCodigo)) // salários nunca contam
      .map(g => ({
        categoriaCodigo: g.categoriaCodigo,
        categoria: g.categoriaDescricao || g.categoriaCodigo || 'Sem categoria',
        total: g._sum.valor,
        count: g._count._all
      }))
      .sort((a, b) => Number(b.total ?? 0) - Number(a.total ?? 0));
    res.json(rows);
  })
);

// Custos administrativos por códigos fixos do Omie, sem cadastrar esses códigos como Project.
router.get(
  '/sede',
  requireAuth,
  requireAcompanhamentoAccess,
  asyncHandler(async (req, res) => {
    const range = parseSedeCostRangeQuery(req.query);
    const [data, operational] = await Promise.all([
      listSedeCosts({
        range,
        includeAdminOnlyCategories: req.auth?.user?.accountType === 'ADMIN'
      }),
      listSedeOperationalMetrics({ range })
    ]);
    res.json({ ...data, operational });
  })
);

// Projetos cuja proposta bate com propostas importadas (sinalização de pendência na aba Projetos).
router.get(
  '/pendencias',
  requireAuth,
  requireAcompanhamentoAccess,
  asyncHandler(async (_req, res) => {
    const pendencias = await listCommercialPendencias();
    res.json(pendencias);
  })
);

// Revisões da proposta de um projeto (interface simples para escolher qual revisão vale).
router.get(
  '/projetos/:projectId/revisoes',
  requireAuth,
  requireAcompanhamentoAccess,
  asyncHandler(async (req, res) => {
    try {
      const data = await listProjectRevisions(req.params.projectId);
      res.json(data);
    } catch (error) {
      res.status(404).json({ error: error.message });
    }
  })
);

const revisionSchema = z.object({ codBd: z.number().int() });
const proposalCodeParamSchema = z.coerce.number().int();

router.post(
  '/projetos/:projectId/revisao',
  requireAuth,
  requireAcompanhamentoManager,
  asyncHandler(async (req, res) => {
    const { codBd } = revisionSchema.parse(req.body);
    try {
      const budget = await setProjectBudgetRevision(req.params.projectId, codBd);
      res.json(budget);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  })
);

router.post(
  '/projetos/:projectId/propostas-adicionais/revisao',
  requireAuth,
  requireAcompanhamentoManager,
  asyncHandler(async (req, res) => {
    const { codBd } = revisionSchema.parse(req.body);
    try {
      const selection = await setProjectAdditionalProposalRevision(req.params.projectId, codBd, {
        selectedByUserId: req.auth?.user?.id ?? null
      });
      res.json(selection);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  })
);

router.delete(
  '/projetos/:projectId/propostas-adicionais/:codProp',
  requireAuth,
  requireAcompanhamentoManager,
  asyncHandler(async (req, res) => {
    const codProp = proposalCodeParamSchema.parse(req.params.codProp);
    try {
      const result = await removeProjectAdditionalProposal(req.params.projectId, codProp);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  })
);

const scheduleSchema = z.object({
  approvedAt: z.string().datetime().nullable().optional(),
  startDate: z.string().datetime().nullable().optional(),
  mobilizationDate: z.string().datetime().nullable().optional(),
  demobilizationDate: z.string().datetime().nullable().optional(),
  manualProgressPct: z.number().min(0).max(100).nullable().optional(),
  offshore: z.boolean().optional(),
  laborSleepModeByCollaborator: z.record(z.enum(['HOME', 'AWAY'])).optional(),
  laborCollaboratorIds: z.array(z.string()).optional()
});

const manualCostSchema = z.object({
  description: z.string().trim().min(1).max(120),
  amount: z.number().positive().max(999999999.99),
  costDate: z
    .string()
    .trim()
    .nullable()
    .optional()
    .refine(value => !value || !Number.isNaN(new Date(value).getTime()), 'Data do custo manual inválida.'),
  note: z.string().trim().max(500).nullable().optional()
});

router.patch(
  '/projetos/:projectId/cronograma',
  requireAuth,
  requireAcompanhamentoAccess,
  asyncHandler(async (req, res) => {
    const data = scheduleSchema.parse(req.body);
    try {
      await setProjectSchedule(req.params.projectId, data);
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  })
);

router.post(
  '/projetos/:projectId/custos-manuais',
  requireAuth,
  requireAcompanhamentoManager,
  asyncHandler(async (req, res) => {
    const data = manualCostSchema.parse(req.body || {});
    try {
      const cost = await createManualProjectCost(req.params.projectId, data, {
        userId: req.auth?.user?.id ?? null
      });
      res.status(201).json(cost);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  })
);

router.delete(
  '/projetos/:projectId/custos-manuais/:costId',
  requireAuth,
  requireAcompanhamentoManager,
  asyncHandler(async (req, res) => {
    try {
      const result = await deleteManualProjectCost(req.params.projectId, req.params.costId);
      res.json(result);
    } catch (error) {
      res.status(404).json({ error: error.message });
    }
  })
);

// === Escopo previsto: quantitativo de serviços vendidos + previsão de horas (manual) ===

// Só tubulação (m) e óleo (L): são os quantitativos que o RDO registra como realizado, para o
// previsto poder entrar no cálculo de avanço. Tanques e peso (kg/t) não têm fonte no RDO.
const plannedSystemSchema = z.object({
  systemType: z.enum(['TUBULACAO', 'OLEO']),
  description: z.string().trim().max(180).nullable().optional(),
  diameter: z.string().trim().max(40).nullable().optional(),
  diameterUnit: z.enum(['pol', 'mm']).nullable().optional(),
  quantity: z.number().nonnegative().nullable().optional(),
  unit: z.enum(['M', 'L']).nullable().optional()
});

const plannedServiceSchema = z.object({
  serviceType: z.string().trim().min(1).max(60),
  weight: z.number().nonnegative().max(100).optional(), // peso do serviço no avanço, em % (0–100)
  note: z.string().max(300).nullable().optional(),
  systems: z.array(plannedSystemSchema).max(20).default([])
});

const plannedHoursSchema = z.object({
  jobRoleId: z.string().nullable().optional(),
  roleName: z.string().max(80).nullable().optional(),
  collaboratorCount: z.number().int().positive().max(999).optional().default(1),
  hours: z.number().nonnegative().max(100000)
});

const plannedScopeSchema = z.object({
  services: z.array(plannedServiceSchema).max(50).default([]),
  normalHours: z.array(plannedHoursSchema).max(50).default([]),
  overtime: z.array(plannedHoursSchema).max(50).default([])
});

router.get(
  '/projetos/:projectId/escopo-previsto',
  requireAuth,
  requireAcompanhamentoAccess,
  asyncHandler(async (req, res) => {
    try {
      const scope = await getPlannedScope(req.params.projectId);
      res.json(scope);
    } catch (error) {
      res.status(404).json({ error: error.message });
    }
  })
);

router.put(
  '/projetos/:projectId/escopo-previsto',
  requireAuth,
  requireAcompanhamentoAccess,
  asyncHandler(async (req, res) => {
    const data = plannedScopeSchema.parse(req.body);
    try {
      const scope = await setPlannedScope(req.params.projectId, data);
      res.json(scope);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  })
);

// Dashboard detalhado de um projeto (aberto ao clicar no card da aba Projetos).
router.get(
  '/projetos/:projectId/planning-context',
  requireAuth,
  requireAcompanhamentoAccess,
  asyncHandler(async (req, res) => {
    const date = z.string().date().optional().parse(req.query.date) || new Date().toISOString().slice(0, 10);
    res.json(
      await getOfficialMissionContext({
        projectId: req.params.projectId,
        date
      })
    );
  })
);

router.get(
  '/projetos/:projectId/faturamentos',
  requireAuth,
  requireAcompanhamentoAccess,
  asyncHandler(async (req, res) => {
    const result = await getProjectInvoices(req.params.projectId);
    if (!result) return res.status(404).json({ error: 'Projeto não encontrado.' });
    res.json(result);
  })
);

router.get(
  '/grupos-missoes/:groupId/faturamentos',
  requireAuth,
  requireAcompanhamentoAccess,
  asyncHandler(async (req, res) => {
    try {
      res.json(await getMissionGroupInvoices(req.params.groupId));
    } catch (error) {
      return missionGroupErrorResponse(error, res);
    }
  })
);

router.get(
  '/projetos/:projectId/detalhe',
  requireAuth,
  requireAcompanhamentoAccess,
  asyncHandler(async (req, res) => {
    try {
      const includeCollaboratorCosts = canViewAcompanhamentoLaborCosts(req.auth?.user);
      const includeAdminOnlyCategories = req.auth?.user?.accountType === 'ADMIN';
      const detail = await getProjectDetail(req.params.projectId, {
        includeCollaboratorCosts,
        includeAdminOnlyCategories
      });
      res.json(detail);
    } catch (error) {
      res.status(404).json({ error: error.message });
    }
  })
);

// Avanço físico do projeto (RDO ponderado por serviço) — previsto × realizado dos RDOs.
router.get(
  '/projetos/:projectId/avanco',
  requireAuth,
  requireAcompanhamentoAccess,
  asyncHandler(async (req, res) => {
    try {
      const progress = await computeProjectProgress(req.params.projectId);
      res.json(progress);
    } catch (error) {
      res.status(404).json({ error: error.message });
    }
  })
);

export default router;
