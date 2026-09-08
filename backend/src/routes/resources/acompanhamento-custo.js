/*
 * Motor de custo — perfis de custo, parâmetros versionados e simulador.
 *   GET  /api/acompanhamento/custo/perfis                 lista perfis + parâmetros vigentes
 *   PUT  /api/acompanhamento/custo/perfis/:key/parametros nova vigência de parâmetros (gestor)
 *   POST /api/acompanhamento/custo/simular                { profileKey|params, inputs } -> custo
 *   GET  /api/acompanhamento/custo/categorias-omie        lista categorias Omie do cálculo
 *   PUT  /api/acompanhamento/custo/categorias-omie/:codigo inclui/remove categoria do cálculo
 */

import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import { computeMonthlyCost } from '../../lib/acompanhamento/cost-engine.js';
import { getAnnualCollaboratorCosts, setAnnualCollaboratorCosts } from '../../lib/acompanhamento/settings.js';
import prisma from '../../lib/prisma.js';
import { requireAcompanhamentoManager, requireAuth, requireHubAdmin } from '../../middleware/auth.js';

const router = Router();

async function latestParams(key) {
  const profile = await prisma.costProfile.findUnique({
    where: { key },
    include: { parameterSets: true }
  });
  if (!profile) return null;
  return {
    profile,
    set: latestParameterSet(profile.parameterSets),
    maxVersion: maxVersion(profile.parameterSets)
  };
}

function effectiveDateKey(set) {
  return set?.effectiveDate ? new Date(set.effectiveDate).toISOString().slice(0, 10) : '1970-01-01';
}

function latestParameterSet(sets = []) {
  return [...sets].sort((left, right) => {
    const byDate = effectiveDateKey(right).localeCompare(effectiveDateKey(left));
    if (byDate !== 0) return byDate;
    return (Number(right.version) || 0) - (Number(left.version) || 0);
  })[0] ?? null;
}

function parameterSetHistory(sets = []) {
  return [...sets]
    .sort((left, right) => {
      const byDate = effectiveDateKey(right).localeCompare(effectiveDateKey(left));
      if (byDate !== 0) return byDate;
      return (Number(right.version) || 0) - (Number(left.version) || 0);
    })
    .map(set => ({
      effectiveDate: set.effectiveDate,
      params: normalizeCostParams(set.params),
      note: set.note,
      updatedAt: set.createdAt
    }));
}

function maxVersion(sets = []) {
  return sets.reduce((max, set) => Math.max(max, Number(set.version) || 0), 0);
}

function normalizeCostParams(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return params;
  const normalized = { ...params };
  delete normalized.inssPatronalPct;
  return normalized;
}

const dateOnlySchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data de vigência no formato YYYY-MM-DD.')
  .transform(value => new Date(`${value}T00:00:00.000Z`));

router.get('/perfis', requireAuth, requireAcompanhamentoManager, asyncHandler(async (_req, res) => {
  // Apenas os perfis-modelo (planilhas base). Perfis por cargo (jobRoleId != null) ficam em /cargos.
  const profiles = await prisma.costProfile.findMany({
    where: { isActive: true, jobRoleId: null },
    orderBy: { label: 'asc' },
    include: { parameterSets: true }
  });
  res.json(profiles.map(p => {
    const set = latestParameterSet(p.parameterSets);
    return {
      id: p.id,
      key: p.key,
      label: p.label,
      effectiveDate: set?.effectiveDate ?? null,
      params: normalizeCostParams(set?.params ?? null),
      updatedAt: set?.createdAt ?? p.updatedAt,
      history: parameterSetHistory(p.parameterSets)
    };
  }));
}));

const paramsSchema = z.object({
  params: z.record(z.any()),
  effectiveDate: dateOnlySchema,
  note: z.string().optional()
});

router.put('/perfis/:key/parametros', requireAuth, requireAcompanhamentoManager, asyncHandler(async (req, res) => {
  const { params, effectiveDate, note } = paramsSchema.parse(req.body);
  const current = await latestParams(req.params.key);
  if (!current) return res.status(404).json({ error: 'Perfil de custo não encontrado.' });
  const created = await prisma.costParameterSet.create({
    data: {
      costProfileId: current.profile.id,
      version: current.maxVersion + 1,
      effectiveDate,
      params: normalizeCostParams(params),
      note: note ?? null,
      createdByUserId: req.auth?.user?.id ?? null
    }
  });
  res.status(201).json({ key: current.profile.key, effectiveDate: created.effectiveDate, params: created.params });
}));

const simulateSchema = z.object({
  profileKey: z.string().optional(),
  params: z.record(z.any()).optional(),
  inputs: z.record(z.any()).default({})
});

router.post('/simular', requireAuth, requireAcompanhamentoManager, asyncHandler(async (req, res) => {
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

// === Perfil de custo por cargo (um CostProfile por JobRole, criado sob demanda) ===

router.get('/cargos', requireAuth, requireAcompanhamentoManager, asyncHandler(async (_req, res) => {
  const roles = await prisma.jobRole.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    include: { costProfile: { include: { parameterSets: true } } }
  });
  res.json(roles.map(role => {
    const sets = role.costProfile?.parameterSets || [];
    const set = latestParameterSet(sets);
    return {
      jobRoleId: role.id,
      name: role.name,
      profileId: role.costProfile?.id ?? null,
      effectiveDate: set?.effectiveDate ?? null,
      params: normalizeCostParams(set?.params ?? null),
      updatedAt: set?.createdAt ?? role.costProfile?.updatedAt ?? null,
      history: parameterSetHistory(sets)
    };
  }));
}));

router.put('/cargos/:jobRoleId/parametros', requireAuth, requireAcompanhamentoManager, asyncHandler(async (req, res) => {
  const { params, effectiveDate, note } = paramsSchema.parse(req.body);
  const role = await prisma.jobRole.findUnique({
    where: { id: req.params.jobRoleId },
    include: { costProfile: { include: { parameterSets: true } } }
  });
  if (!role) return res.status(404).json({ error: 'Cargo não encontrado.' });

  let profile = role.costProfile;
  if (!profile) {
    profile = await prisma.costProfile.create({ data: { key: `role:${role.id}`, label: role.name, jobRoleId: role.id } });
  }
  const currentVersion = maxVersion(role.costProfile?.parameterSets || []);
  const created = await prisma.costParameterSet.create({
    data: {
      costProfileId: profile.id,
      version: currentVersion + 1,
      effectiveDate,
      params: normalizeCostParams(params),
      note: note ?? null,
      createdByUserId: req.auth?.user?.id ?? null
    }
  });
  res.status(201).json({ jobRoleId: role.id, profileId: profile.id, effectiveDate: created.effectiveDate, params: created.params });
}));

// === Configuração global de custos anuais por colaborador ===

router.get('/config', requireAuth, requireAcompanhamentoManager, asyncHandler(async (_req, res) => {
  res.json(await getAnnualCollaboratorCosts());
}));

const configSchema = z.object({
  epiAnnualCost: z.number().min(0).max(1000000).optional(),
  examsTrainingAnnualCost: z.number().min(0).max(1000000).optional(),
  offshoreExamsTrainingAnnualCost: z.number().min(0).max(1000000).optional()
});

router.put('/config', requireAuth, requireAcompanhamentoManager, asyncHandler(async (req, res) => {
  const current = await getAnnualCollaboratorCosts();
  const values = configSchema.parse(req.body);
  res.json(await setAnnualCollaboratorCosts({ ...current, ...values }, req.auth?.user?.id ?? null));
}));

// === Categorias Omie consideradas nos cálculos do acompanhamento ===

router.get('/categorias-omie', requireAuth, requireAcompanhamentoManager, asyncHandler(async (req, res) => {
  const isAdmin = req.auth?.user?.accountType === 'ADMIN';
  const [categories, purchaseStats] = await Promise.all([
    prisma.omieCategory.findMany({
      where: isAdmin ? undefined : { adminOnly: false },
      orderBy: [{ descricao: 'asc' }, { codigo: 'asc' }]
    }),
    prisma.omiePurchase.groupBy({
      by: ['categoriaCodigo'],
      _sum: { valor: true },
      _count: { _all: true }
    })
  ]);
  const statsByCode = new Map(purchaseStats.map(stat => [stat.categoriaCodigo, stat]));
  res.json(categories.map(category => {
    const stats = statsByCode.get(category.codigo);
    return {
      id: category.id,
      codigo: category.codigo,
      descricao: category.descricao,
      includeInAcompanhamentoCosts: category.includeInAcompanhamentoCosts,
      adminOnly: category.adminOnly,
      syncedAt: category.syncedAt,
      purchasesCount: stats?._count?._all ?? 0,
      purchasesTotal: stats?._sum?.valor ?? 0
    };
  }));
}));

const omieCategorySchema = z.object({ includeInAcompanhamentoCosts: z.boolean() });

router.put('/categorias-omie/:codigo', requireAuth, requireAcompanhamentoManager, asyncHandler(async (req, res) => {
  const { includeInAcompanhamentoCosts } = omieCategorySchema.parse(req.body);
  const current = await prisma.omieCategory.findUnique({ where: { codigo: req.params.codigo } });
  if (!current || (current.adminOnly && req.auth?.user?.accountType !== 'ADMIN')) {
    return res.status(404).json({ error: 'Categoria Omie não encontrada.' });
  }
  const category = await prisma.omieCategory.update({
    where: { codigo: req.params.codigo },
    data: { includeInAcompanhamentoCosts }
  });
  res.json({
    id: category.id,
    codigo: category.codigo,
    descricao: category.descricao,
    includeInAcompanhamentoCosts: category.includeInAcompanhamentoCosts,
    adminOnly: category.adminOnly,
    syncedAt: category.syncedAt
  });
}));

const omieCategoryVisibilitySchema = z.object({ adminOnly: z.boolean() });

router.patch('/categorias-omie/:codigo/visibilidade', requireAuth, requireHubAdmin, asyncHandler(async (req, res) => {
  const { adminOnly } = omieCategoryVisibilitySchema.parse(req.body);
  const current = await prisma.omieCategory.findUnique({ where: { codigo: req.params.codigo } });
  if (!current) return res.status(404).json({ error: 'Categoria Omie não encontrada.' });
  const category = await prisma.omieCategory.update({
    where: { codigo: req.params.codigo },
    data: { adminOnly }
  });
  res.json({
    id: category.id,
    codigo: category.codigo,
    descricao: category.descricao,
    includeInAcompanhamentoCosts: category.includeInAcompanhamentoCosts,
    adminOnly: category.adminOnly,
    syncedAt: category.syncedAt
  });
}));

export default router;
