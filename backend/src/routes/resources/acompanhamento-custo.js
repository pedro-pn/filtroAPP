/*
 * Motor de custo — perfis de custo (operador/auxiliar), parâmetros versionados e simulador.
 *   GET  /api/acompanhamento/custo/perfis                 lista perfis + parâmetros vigentes
 *   PUT  /api/acompanhamento/custo/perfis/:key/parametros nova versão de parâmetros (gestor)
 *   POST /api/acompanhamento/custo/simular                { profileKey|params, inputs } -> custo
 */

import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import { computeMonthlyCost } from '../../lib/acompanhamento-cost-engine.js';
import prisma from '../../lib/prisma.js';
import { requireAuth, requireHubAdmin } from '../../middleware/auth.js';

const router = Router();

async function latestParams(key) {
  const profile = await prisma.costProfile.findUnique({
    where: { key },
    include: { parameterSets: { orderBy: { version: 'desc' }, take: 1 } }
  });
  if (!profile) return null;
  return { profile, set: profile.parameterSets[0] ?? null };
}

router.get('/perfis', requireAuth, requireHubAdmin, asyncHandler(async (_req, res) => {
  const profiles = await prisma.costProfile.findMany({
    where: { isActive: true },
    orderBy: { label: 'asc' },
    include: { parameterSets: { orderBy: { version: 'desc' }, take: 1 } }
  });
  res.json(profiles.map(p => ({
    id: p.id,
    key: p.key,
    label: p.label,
    version: p.parameterSets[0]?.version ?? null,
    params: p.parameterSets[0]?.params ?? null,
    updatedAt: p.parameterSets[0]?.createdAt ?? p.updatedAt
  })));
}));

const paramsSchema = z.object({ params: z.record(z.any()), note: z.string().optional() });

router.put('/perfis/:key/parametros', requireAuth, requireHubAdmin, asyncHandler(async (req, res) => {
  const { params, note } = paramsSchema.parse(req.body);
  const current = await latestParams(req.params.key);
  if (!current) return res.status(404).json({ error: 'Perfil de custo não encontrado.' });
  const nextVersion = (current.set?.version ?? 0) + 1;
  const created = await prisma.costParameterSet.create({
    data: {
      costProfileId: current.profile.id,
      version: nextVersion,
      params,
      note: note ?? null,
      createdByUserId: req.auth?.user?.id ?? null
    }
  });
  res.status(201).json({ key: current.profile.key, version: created.version, params: created.params });
}));

const simulateSchema = z.object({
  profileKey: z.string().optional(),
  params: z.record(z.any()).optional(),
  inputs: z.record(z.any()).default({})
});

router.post('/simular', requireAuth, requireHubAdmin, asyncHandler(async (req, res) => {
  const { profileKey, params, inputs } = simulateSchema.parse(req.body);
  let effectiveParams = params;
  if (!effectiveParams && profileKey) {
    const current = await latestParams(profileKey);
    if (!current?.set) return res.status(404).json({ error: 'Perfil de custo sem parâmetros.' });
    effectiveParams = current.set.params;
  }
  if (!effectiveParams) return res.status(400).json({ error: 'Informe profileKey ou params.' });
  res.json(computeMonthlyCost(effectiveParams, inputs));
}));

export default router;
