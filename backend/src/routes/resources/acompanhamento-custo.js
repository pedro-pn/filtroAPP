/*
 * Motor de custo — perfis de custo, parâmetros versionados e simulador.
 *   GET  /api/acompanhamento/custo/colaboradores/:id/valor-hora referências por cenário
 *   GET  /api/acompanhamento/custo/perfis                 lista perfis + parâmetros vigentes
 *   PUT  /api/acompanhamento/custo/perfis/:key/parametros nova vigência de parâmetros (gestor)
 *   PUT  /api/acompanhamento/custo/cargos/reajuste-hh     reajuste versionado dos cargos selecionados
 *   POST /api/acompanhamento/custo/simular                { profileKey|params, inputs } -> custo
 *   GET  /api/acompanhamento/custo/categorias-omie        lista categorias Omie do cálculo
 *   PUT  /api/acompanhamento/custo/categorias-omie/:codigo inclui/remove categoria do cálculo
 */

import { Router } from 'express';
import { z } from 'zod';

import asyncHandler from '../../lib/async-handler.js';
import { computeMonthlyCost } from '../../lib/acompanhamento/cost-engine.js';
import { buildCollaboratorHourlyRates } from '../../lib/acompanhamento/collaborator-hourly-rates.js';
import { effectiveCargoParameterSetAt, getRoleParamsResolver } from '../../lib/acompanhamento/labor-cost.js';
import { getAnnualCollaboratorCosts, setAnnualCollaboratorCosts } from '../../lib/acompanhamento/settings.js';
import prisma from '../../lib/prisma.js';
import { clearProjectDerivedCaches } from '../../lib/resource-list-cache.js';
import { requireAcompanhamentoAccess, requireAcompanhamentoManager, requireAuth, requireHubAdmin } from '../../middleware/auth.js';

import { defineRoute } from '../../lib/api-contract/registry.js';
import { opsRoute, jsonResponseSchema, libValidatedBodySchema } from '../../lib/api-contract/domains/operacoes.js';
const router = Router();

defineRoute(router, opsRoute('GET /colaboradores/:collaboratorId/valor-hora', { tag: 'acompanhamento-custo', summary: 'Acompanhamento de custo: Valor-hora do colaborador', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireAuth, requireAcompanhamentoAccess, asyncHandler(async (req, res) => {
  const referenceDate = z.iso.date().optional().parse(req.query.date) || new Date().toISOString().slice(0, 10);
  const collaborator = await prisma.collaborator.findUnique({
    where: { id: req.params.collaboratorId },
    select: {
      id: true, name: true,
      jobRole: { select: { id: true, name: true } },
      jobRoleHistory: {
        select: { jobRoleId: true, effectiveDate: true, jobRole: { select: { id: true, name: true } } }
      }
    }
  });
  if (!collaborator) return res.status(404).json({ error: 'Colaborador não encontrado.' });
  const [roleParams, annualCosts] = await Promise.all([getRoleParamsResolver(), getAnnualCollaboratorCosts()]);
  res.json(buildCollaboratorHourlyRates({ collaborator, referenceDate, roleParams, annualCosts }));
}));

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

function parameterSetHistory(sets = [], forCargo = false) {
  let reajusteHhPct = 0;
  return [...sets]
    .sort((left, right) => {
      const byDate = effectiveDateKey(left).localeCompare(effectiveDateKey(right));
      if (byDate !== 0) return byDate;
      return (Number(left.version) || 0) - (Number(right.version) || 0);
    })
    .map(set => {
      const params = normalizeCostParams(set.params);
      if (forCargo) reajusteHhPct = params?.reajusteHhPct ?? reajusteHhPct;
      return {
        effectiveDate: set.effectiveDate,
        params: forCargo ? { ...params, reajusteHhPct } : params,
        ...(forCargo ? { salaryReference: set.params?.salaryReference ?? null } : {}),
        note: set.note,
        updatedAt: set.createdAt
      };
    }).reverse();
}

function maxVersion(sets = []) {
  return sets.reduce((max, set) => Math.max(max, Number(set.version) || 0), 0);
}

function normalizeCostParams(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return params;
  const normalized = { ...params };
  delete normalized.inssPatronalPct;
  // A local publication is an explicit management decision, not a replay of RH.
  delete normalized.salaryReference;
  return normalized;
}

const dateOnlySchema = z.iso.date('Informe uma data de vigência válida no formato YYYY-MM-DD.')
  .transform(value => new Date(`${value}T00:00:00.000Z`));

defineRoute(router, opsRoute('GET /perfis', { tag: 'acompanhamento-custo', summary: 'Acompanhamento de custo: Listar perfis de custo', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), requireAuth, requireAcompanhamentoManager, asyncHandler(async (_req, res) => {
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

defineRoute(router, opsRoute('PUT /perfis/:key/parametros', { tag: 'acompanhamento-custo', summary: 'Acompanhamento de custo: Salvar parâmetros do perfil de custo', body: paramsSchema, responses: { 201: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireAuth, requireAcompanhamentoManager, asyncHandler(async (req, res) => {
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
  clearProjectDerivedCaches();
  res.status(201).json({ key: current.profile.key, effectiveDate: created.effectiveDate, params: created.params });
}));

const simulateSchema = z.object({
  profileKey: z.string().optional(),
  params: z.record(z.any()).optional(),
  inputs: z.record(z.any()).default({})
});

defineRoute(router, opsRoute('POST /simular', { tag: 'acompanhamento-custo', summary: 'Acompanhamento de custo: Simular custo', body: simulateSchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireAuth, requireAcompanhamentoManager, asyncHandler(async (req, res) => {
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

defineRoute(router, opsRoute('GET /cargos', { tag: 'acompanhamento-custo', summary: 'Acompanhamento de custo: Listar cargos com parâmetros de custo', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), requireAuth, requireAcompanhamentoManager, asyncHandler(async (_req, res) => {
  const roles = await prisma.jobRole.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    include: { costProfile: { include: { parameterSets: true } } }
  });
  res.json(roles.map(role => {
    const sets = role.costProfile?.parameterSets || [];
    const latest = latestParameterSet(sets);
    const set = latest ? effectiveCargoParameterSetAt(sets, effectiveDateKey(latest)) : null;
    return {
      jobRoleId: role.id,
      name: role.name,
      profileId: role.costProfile?.id ?? null,
      effectiveDate: set?.effectiveDate ?? null,
      params: normalizeCostParams(set?.params ?? null),
      updatedAt: set?.createdAt ?? role.costProfile?.updatedAt ?? null,
      history: parameterSetHistory(sets, true)
    };
  }));
}));

const reajusteHhSchema = z.number().min(0).max(1);
const cargoParamsSchema = paramsSchema.extend({
  params: z.object({
    baseModel: z.string().min(1).optional(),
    salarioBase: z.number().min(0).optional(),
    reajusteHhPct: reajusteHhSchema.optional()
  }).passthrough()
});

async function createCargoParameterSet(database, role, params, effectiveDate, note, userId, preserveSalaryReference = false) {
  let profile = role.costProfile;
  if (!profile) {
    profile = await database.costProfile.create({ data: { key: `role:${role.id}`, label: role.name, jobRoleId: role.id } });
  }
  const currentVersion = maxVersion(role.costProfile?.parameterSets || []);
  const created = await database.costParameterSet.create({
    data: {
      costProfileId: profile.id,
      version: currentVersion + 1,
      effectiveDate,
      params: { ...normalizeCostParams(params), ...(preserveSalaryReference && params.salaryReference
        ? { salaryReference: params.salaryReference } : {}) },
      note: note ?? null,
      createdByUserId: userId
    }
  });
  return { jobRoleId: role.id, profileId: profile.id, effectiveDate: created.effectiveDate, params: created.params };
}

defineRoute(router, opsRoute('PUT /cargos/reajuste-hh', { tag: 'acompanhamento-custo', summary: 'Acompanhamento de custo: Aplicar reajuste de HH aos cargos', body: libValidatedBodySchema, validatedBy: 'handler/serviço (corpo conferido fora do contrato)', responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), requireAuth, requireAcompanhamentoManager, asyncHandler(async (req, res) => {
  const { jobRoleIds, reajusteHhPct, effectiveDate } = z.object({
    jobRoleIds: z.array(z.string().min(1)).min(1).max(500).transform(ids => [...new Set(ids)]),
    reajusteHhPct: reajusteHhSchema,
    effectiveDate: dateOnlySchema
  }).parse(req.body);
  const result = await prisma.$transaction(async database => {
    const roles = await database.jobRole.findMany({
      where: { id: { in: jobRoleIds }, isActive: true },
      include: { costProfile: { include: { parameterSets: true } } }
    });
    if (roles.length !== jobRoleIds.length) {
      return { status: 404, body: { error: 'Um ou mais cargos não foram encontrados ou estão inativos.' } };
    }
    // Usa o salário e modelo vigentes na data escolhida, inclusive em alterações
    // retroativas. Valida todos os cargos antes de escrever qualquer versão.
    const entries = roles.map(role => ({ role,
      set: effectiveCargoParameterSetAt(role.costProfile?.parameterSets || [], effectiveDateKey({ effectiveDate }))
    }));
    const missing = entries.filter(({ set }) => !set);
    if (missing.length) {
      return { status: 422, body: { error: `Configure o custo vigente antes de reajustar: ${missing.map(({ role }) => role.name).join(', ')}.` } };
    }
    const saved = [];
    for (const { role, set } of entries) {
      saved.push(await createCargoParameterSet(database, role,
        { ...set.params, reajusteHhPct }, effectiveDate,
        `Reajuste do HH: ${Number((reajusteHhPct * 100).toFixed(4))}%`, req.auth?.user?.id ?? null, true));
    }
    return { status: 201, body: { cargos: saved } };
  });
  if (result.status === 201) clearProjectDerivedCaches();
  res.status(result.status).json(result.body);
}));

defineRoute(router, opsRoute('PUT /cargos/:jobRoleId/parametros', { tag: 'acompanhamento-custo', summary: 'Acompanhamento de custo: Salvar parâmetros de custo do cargo', body: cargoParamsSchema, responses: { 201: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireAuth, requireAcompanhamentoManager, asyncHandler(async (req, res) => {
  const { params, effectiveDate, note } = cargoParamsSchema.parse(req.body);
  const saved = await prisma.$transaction(async database => {
    const role = await database.jobRole.findUnique({
      where: { id: req.params.jobRoleId },
      include: { costProfile: { include: { parameterSets: true } } }
    });
    if (!role) return null;
    const previous = effectiveCargoParameterSetAt(role.costProfile?.parameterSets || [], effectiveDateKey({ effectiveDate }));
    return createCargoParameterSet(database, role, {
      ...params, reajusteHhPct: params.reajusteHhPct ?? previous?.params?.reajusteHhPct ?? 0
    }, effectiveDate, note, req.auth?.user?.id ?? null);
  });
  if (!saved) return res.status(404).json({ error: 'Cargo não encontrado.' });
  clearProjectDerivedCaches();
  res.status(201).json(saved);
}));

// === Configuração global de custos anuais por colaborador ===

defineRoute(router, opsRoute('GET /config', { tag: 'acompanhamento-custo', summary: 'Acompanhamento de custo: Consultar configuração', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), requireAuth, requireAcompanhamentoManager, asyncHandler(async (_req, res) => {
  res.json(await getAnnualCollaboratorCosts());
}));

const configSchema = z.object({
  epiAnnualCost: z.number().min(0).max(1000000).optional(),
  examsTrainingAnnualCost: z.number().min(0).max(1000000).optional(),
  offshoreExamsTrainingAnnualCost: z.number().min(0).max(1000000).optional()
});

defineRoute(router, opsRoute('PUT /config', { tag: 'acompanhamento-custo', summary: 'Acompanhamento de custo: Salvar configuração', body: configSchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403] }), requireAuth, requireAcompanhamentoManager, asyncHandler(async (req, res) => {
  const current = await getAnnualCollaboratorCosts();
  const values = configSchema.parse(req.body);
  const updated = await setAnnualCollaboratorCosts({ ...current, ...values }, req.auth?.user?.id ?? null);
  clearProjectDerivedCaches();
  res.json(updated);
}));

// === Categorias Omie consideradas nos cálculos do acompanhamento ===

defineRoute(router, opsRoute('GET /categorias-omie', { tag: 'acompanhamento-custo', summary: 'Acompanhamento de custo: Listar categorias do Omie', responses: { 200: jsonResponseSchema }, errors: [401, 403] }), requireAuth, requireAcompanhamentoManager, asyncHandler(async (req, res) => {
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

defineRoute(router, opsRoute('PUT /categorias-omie/:codigo', { tag: 'acompanhamento-custo', summary: 'Acompanhamento de custo: Classificar categoria do Omie', body: omieCategorySchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireAuth, requireAcompanhamentoManager, asyncHandler(async (req, res) => {
  const { includeInAcompanhamentoCosts } = omieCategorySchema.parse(req.body);
  const current = await prisma.omieCategory.findUnique({ where: { codigo: req.params.codigo } });
  if (!current || (current.adminOnly && req.auth?.user?.accountType !== 'ADMIN')) {
    return res.status(404).json({ error: 'Categoria Omie não encontrada.' });
  }
  const category = await prisma.omieCategory.update({
    where: { codigo: req.params.codigo },
    data: { includeInAcompanhamentoCosts }
  });
  clearProjectDerivedCaches();
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

defineRoute(router, opsRoute('PATCH /categorias-omie/:codigo/visibilidade', { tag: 'acompanhamento-custo', summary: 'Acompanhamento de custo: Mostrar ou ocultar categoria do Omie', body: omieCategoryVisibilitySchema, responses: { 200: jsonResponseSchema }, errors: [400, 401, 403, 404] }), requireAuth, requireHubAdmin, asyncHandler(async (req, res) => {
  const { adminOnly } = omieCategoryVisibilitySchema.parse(req.body);
  const current = await prisma.omieCategory.findUnique({ where: { codigo: req.params.codigo } });
  if (!current) return res.status(404).json({ error: 'Categoria Omie não encontrada.' });
  const category = await prisma.omieCategory.update({
    where: { codigo: req.params.codigo },
    data: { adminOnly }
  });
  clearProjectDerivedCaches();
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
