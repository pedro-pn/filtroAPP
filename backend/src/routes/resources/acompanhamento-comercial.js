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
import {
  importCommercialAccess,
  listCommercialDashboard,
  listCommercialPendencias,
  listProjectRevisions,
  setProjectBudgetRevision,
  setProjectSchedule
} from '../../lib/acompanhamento-access-import.js';
import { getPlannedScope, setPlannedScope } from '../../lib/acompanhamento-planned-scope.js';
import { computeProjectProgress } from '../../lib/acompanhamento-avanco.js';
import prisma from '../../lib/prisma.js';
import { requireAcompanhamentoAccess, requireAcompanhamentoManager, requireAuth } from '../../middleware/auth.js';

const router = Router();

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB (arquivo real ~1 MB)

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
    return res.status(503).json({ error: 'Importação comercial não configurada (COMMERCIAL_IMPORT_TOKEN ausente).' });
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
  express.raw({ type: ['application/octet-stream', 'application/x-msaccess'], limit: MAX_FILE_BYTES }),
  asyncHandler(async (req, res) => {
    const buffer = req.body;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      return res.status(400).json({ error: 'Corpo vazio. Envie o arquivo .accdb como application/octet-stream.' });
    }
    const fileName = String(req.headers['x-file-name'] || 'propostas_bd.accdb');

    try {
      const summary = await importCommercialAccess({ buffer, fileName, importedByUserId: null, source: 'SCRIPT' });
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
    const rows = await listCommercialDashboard({ categoryCode });
    res.json(rows);
  })
);

// Realizado (compras Omie) agrupado por categoria de gasto. Opcional: ?projectId= para um projeto.
router.get(
  '/realizado-categorias',
  requireAuth,
  requireAcompanhamentoAccess,
  asyncHandler(async (req, res) => {
    const projectId = typeof req.query.projectId === 'string' && req.query.projectId ? req.query.projectId : null;
    const where = projectId ? { projectId } : { projectId: { not: null } };
    const groups = await prisma.omiePurchase.groupBy({
      by: ['categoriaCodigo', 'categoriaDescricao'],
      where,
      _sum: { valor: true },
      _count: { _all: true }
    });
    const rows = groups
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

// Projetos cujo contrato bate com propostas importadas (sinalização de pendência na aba Projetos).
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

const scheduleSchema = z.object({
  approvedAt: z.string().datetime().nullable().optional(),
  startDate: z.string().datetime().nullable().optional()
});

router.patch(
  '/projetos/:projectId/cronograma',
  requireAuth,
  requireAcompanhamentoManager,
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

// === Escopo previsto: quantitativo de serviços vendidos + previsão de hora extra (manual) ===

// Só tubulação (m) e óleo (L): são os quantitativos que o RDO registra como realizado, para o
// previsto poder entrar no cálculo de avanço. Tanques e peso (kg/t) não têm fonte no RDO.
const plannedSystemSchema = z.object({
  systemType: z.enum(['TUBULACAO', 'OLEO']),
  quantity: z.number().nonnegative().nullable().optional(),
  unit: z.enum(['M', 'L']).nullable().optional()
});

const plannedServiceSchema = z.object({
  serviceType: z.string().trim().min(1).max(60),
  weight: z.number().nonnegative().max(9999).optional(),
  note: z.string().max(300).nullable().optional(),
  systems: z.array(plannedSystemSchema).max(20).default([])
});

const plannedOvertimeSchema = z.object({
  jobRoleId: z.string().nullable().optional(),
  roleName: z.string().max(80).nullable().optional(),
  collaboratorCount: z.number().int().positive().max(999),
  hours: z.number().nonnegative().max(100000)
});

const plannedScopeSchema = z.object({
  services: z.array(plannedServiceSchema).max(50).default([]),
  overtime: z.array(plannedOvertimeSchema).max(50).default([])
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
  requireAcompanhamentoManager,
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
