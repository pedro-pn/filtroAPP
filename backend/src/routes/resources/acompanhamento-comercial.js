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
  listCommercialPendencias,
  listProjectRevisions,
  setProjectBudgetRevision,
  setProjectSchedule
} from '../../lib/acompanhamento-access-import.js';
import prisma from '../../lib/prisma.js';
import { requireAuth, requireHubAdmin } from '../../middleware/auth.js';

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
  requireHubAdmin,
  asyncHandler(async (req, res) => {
    const take = Math.min(Number(req.query.limit) || 50, 200);
    const imports = await prisma.accessImport.findMany({
      orderBy: { createdAt: 'desc' },
      take
    });
    res.json(imports);
  })
);

// Projetos cujo contrato bate com propostas importadas (sinalização de pendência na aba Projetos).
router.get(
  '/pendencias',
  requireAuth,
  requireHubAdmin,
  asyncHandler(async (_req, res) => {
    const pendencias = await listCommercialPendencias();
    res.json(pendencias);
  })
);

// Revisões da proposta de um projeto (interface simples para escolher qual revisão vale).
router.get(
  '/projetos/:projectId/revisoes',
  requireAuth,
  requireHubAdmin,
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
  requireHubAdmin,
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
  requireHubAdmin,
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

export default router;
