/*
 * Importação do banco comercial Access (propostas_bd.accdb) — módulo Acompanhamento de Projetos.
 *
 * Lê a tabela `proposta`, normaliza os campos (vários vêm como texto/nulo), grava o staging 1:1
 * (CommercialProposal, upsert por cod_bd) e deriva o orçamento previsto (ProjectBudget) da maior
 * revisão por proposta, criando Project pendente quando não houver correspondência.
 */

import { createHash } from 'node:crypto';

import MDBReader from 'mdb-reader';

import prisma from '../prisma.js';
import { computeProgressForProjects } from './avanco.js';
import { buildOmieCostCategoryWhere } from './cost-categories.js';
import { getManualProjectCostsByProject } from './manual-costs.js';
import { buildPresumedProfitTaxEstimate } from './presumed-profit-taxes.js';
import { progressContributionWeight } from './progress-groups.js';
import { getStockConsumptionCostByProject } from './stock-cost.js';

const PROPOSAL_TABLE = 'proposta';

// --- Normalização tolerante (a origem mistura number, bigint, texto e nulo) ---

export function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  // texto: remove tudo que não for dígito/sinal/separador e trata vírgula decimal BR
  let text = String(value).trim().replace(/[^\d,.-]/g, '');
  if (!text) return null;
  // remove separador de milhar "." quando seguido de 3 dígitos; troca vírgula decimal por ponto
  text = text.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const n = Number.parseFloat(text);
  return Number.isFinite(n) ? n : null;
}

export function toInt(value) {
  const n = toNumber(value);
  return n === null ? null : Math.trunc(n);
}

export function toStr(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

export function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// CNPJ é identificador, não número: preserva como string só com dígitos.
export function toCnpj(value) {
  if (value === null || value === undefined) return null;
  const digits = String(value).replace(/\D/g, '');
  return digits === '' ? null : digits;
}

function normalizeAccessColumnName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const PARENT_PROPOSAL_COLUMN_NAMES = new Set([
  'codpropostamae',
  'codpropmae',
  'codpropostapai',
  'codproppai',
  'codpropostaorigem',
  'codproporigem'
]);

export function parentProposalCodeFromRow(row) {
  if (!row || typeof row !== 'object') return null;
  for (const [key, value] of Object.entries(row)) {
    const normalized = normalizeAccessColumnName(key);
    const isKnownName = PARENT_PROPOSAL_COLUMN_NAMES.has(normalized);
    const looksLikeParentCode = normalized.includes('cod')
      && (normalized.includes('mae') || normalized.includes('pai') || normalized.includes('origem'))
      && (normalized.includes('prop') || normalized.includes('proposta'));
    if (isKnownName || looksLikeParentCode) {
      const code = toInt(value);
      return code && code > 0 ? code : null;
    }
  }
  return null;
}

// Venda = valor_inloco se != 0; senão valor_pop_sede (campos quase exclusivos).
export function deriveSale(row) {
  const inloco = toNumber(row.valor_inloco);
  const popSede = toNumber(row.valor_pop_sede);
  if (inloco !== null && inloco !== 0) {
    return { serviceModality: 'INLOCO', salePrice: inloco, expectedMargin: toNumber(row.margem_inloco) };
  }
  if (popSede !== null && popSede !== 0) {
    return { serviceModality: 'POP_SEDE', salePrice: popSede, expectedMargin: toNumber(row.margem_pop_sede) };
  }
  return { serviceModality: null, salePrice: null, expectedMargin: null };
}

// Mapeia uma linha bruta do Access para o shape do staging CommercialProposal.
export function mapProposalRow(row) {
  const { serviceModality, salePrice, expectedMargin } = deriveSale(row);
  return {
    codBd: toInt(row.cod_bd),
    codProp: toInt(row.cod_prop),
    parentCodProp: parentProposalCodeFromRow(row),
    nRev: toInt(row.n_rev) ?? 0,
    codNectar: toInt(row.cod_nectar),
    proposalDate: toDate(row.data_proposta),
    createdInAccessAt: toDate(row.dataCriacao),
    modifiedInAccessAt: toDate(row.dataMod),
    clientName: toStr(row.nome_cliente),
    clientCnpj: toCnpj(row.n_cnpj),
    contactName: toStr(row.contato_cliente),
    contactEmail: toStr(row.email_cliente),
    localObra: toStr(row.local_obra),
    sede: toStr(row.sede),
    elaborador: toStr(row.elaborador_proposta),
    vendedor: toStr(row.nome_vendedor),
    serviceModality,
    salePrice,
    plannedCost: toNumber(row.valor_custos),
    expectedProfit: toNumber(row.valor_lucro),
    expectedMargin,
    taxes: toNumber(row.valor_imp),
    plannedDays: toInt(row.n_dias),
    workedDays: toInt(row.n_dias_trabalhados),
    mobilizationLeadDays: toInt(row.prev_atende),
    numOperators: toInt(row.n_operadores),
    numSupervisors: toInt(row.n_encarregado),
    numPerDay: toInt(row.n_p_dia),
    numPerNight: toInt(row.n_p_noite),
    isComplete: salePrice !== null,
    components: componentsFromRow(row),
    rawRow: serializeRaw(row)
  };
}

// Componentes de custo/preço normalizados (também usado no backfill a partir do rawRow).
export function componentsFromRow(row) {
  return {
    he: toNumber(row.valor_he),
    standby: toNumber(row.valor_standby),
    diaria: toNumber(row.valor_diaria),
    analise: toNumber(row.valor_analise),
    mobEquipe: toNumber(row.valor_mob_equipe),
    mobEquipamento: toNumber(row.valor_mob_equipamento),
    desmobExtra: toNumber(row.valor_desmob_extra),
    diariaEquipamento: toNumber(row.diaria_equipamento),
    elemento: toNumber(row.valor_elemento),
    litro: toNumber(row.valor_litro),
    efluente: toNumber(row.total_efluente),
    adto: toNumber(row.adto)
  };
}

export function shouldRecordManualProgressHistory(previousManualProgressPct, nextManualProgressPct) {
  const previous = previousManualProgressPct == null ? null : Number(previousManualProgressPct);
  const next = nextManualProgressPct == null ? null : Number(nextManualProgressPct);
  return next !== null && previous !== next;
}

// JSON precisa de bigint serializável.
function serializeRaw(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = typeof value === 'bigint' ? value.toString() : value;
  }
  return out;
}

export function hashBuffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

// Lê o .accdb e devolve as linhas brutas da tabela `proposta`.
export function readProposals(buffer) {
  const reader = new MDBReader(buffer);
  const tables = reader.getTableNames();
  if (!tables.includes(PROPOSAL_TABLE)) {
    throw new Error(`Tabela "${PROPOSAL_TABLE}" não encontrada no arquivo Access. Tabelas: ${tables.join(', ')}`);
  }
  return reader.getTable(PROPOSAL_TABLE).getData();
}

// Extrai o número da proposta da primeira parte do valor persistido no campo legado.
// Ex.: "4096 - Rev. 1" -> 4096 · "4096" -> 4096 · "Sede 4096" -> 4096.
export function contractToProposalCode(value) {
  const match = String(value ?? '').match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : null;
}

// Número da proposta associado a um projeto, pela 1ª parte do campo legado (fallback no código).
function projectProposalCode(project) {
  return contractToProposalCode(project.contractCode) ?? contractToProposalCode(project.code);
}

// Campos do orçamento a partir de uma proposta (tanto do mapeamento do import quanto da linha
// já persistida em CommercialProposal — ambas usam plannedCost).
function budgetFieldsFromProposal(proposal) {
  return {
    sourceProposalCodBd: proposal.codBd,
    serviceModality: proposal.serviceModality ?? null,
    salePrice: proposal.salePrice ?? null,
    plannedTotalCost: proposal.plannedCost ?? null,
    expectedProfit: proposal.expectedProfit ?? null,
    expectedMargin: proposal.expectedMargin ?? null,
    taxes: proposal.taxes ?? null,
    plannedDays: proposal.plannedDays ?? null,
    mobilizationLeadDays: proposal.mobilizationLeadDays ?? null,
    isComplete: proposal.isComplete ?? false
  };
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function sumNullable(items, getter, { decimals = 2 } = {}) {
  let total = 0;
  let seen = false;
  for (const item of items) {
    const n = toNumber(getter(item));
    if (n === null) continue;
    total += n;
    seen = true;
  }
  if (!seen) return null;
  if (decimals === 0) return Math.round(total);
  return roundMoney(total);
}

function ratioPct(numerator, denominator) {
  const n = toNumber(numerator);
  const d = toNumber(denominator);
  if (n === null || d === null || d <= 0) return null;
  return Math.round(((n / d) * 100 + Number.EPSILON) * 100) / 100;
}

function proposalBudgetSlice(proposal, overrides = {}) {
  if (!proposal) return null;
  return {
    codBd: proposal.codBd,
    codProp: proposal.codProp,
    parentCodProp: proposal.parentCodProp ?? null,
    nRev: proposal.nRev ?? 0,
    salePrice: overrides.salePrice ?? proposal.salePrice ?? null,
    plannedTotalCost: overrides.plannedTotalCost ?? proposal.plannedCost ?? null,
    expectedProfit: overrides.expectedProfit ?? proposal.expectedProfit ?? null,
    expectedMargin: overrides.expectedMargin ?? proposal.expectedMargin ?? null,
    taxes: overrides.taxes ?? proposal.taxes ?? null
  };
}

function combineComponents(sources) {
  const keys = new Set();
  for (const source of sources) {
    if (!source?.components || typeof source.components !== 'object') continue;
    Object.keys(source.components).forEach(key => keys.add(key));
  }
  const components = {};
  for (const key of keys) {
    const value = sumNullable(sources, source => source?.components?.[key]);
    if (value !== null) components[key] = value;
  }
  return components;
}

export function buildBudgetBreakdown({ originalSource, originalBudget = null, additionalSources = [] }) {
  const original = proposalBudgetSlice(originalSource, originalBudget ? {
    salePrice: originalBudget.salePrice,
    plannedTotalCost: originalBudget.plannedTotalCost,
    expectedProfit: originalBudget.expectedProfit,
    expectedMargin: originalBudget.expectedMargin,
    taxes: originalBudget.taxes
  } : {});
  const additionals = additionalSources.map(proposal => proposalBudgetSlice(proposal)).filter(Boolean);
  const allSlices = [original, ...additionals].filter(Boolean);
  const originalSalePrice = original?.salePrice ?? null;
  const additionalSalePrice = sumNullable(additionals, item => item.salePrice);
  const salePrice = sumNullable(allSlices, item => item.salePrice);
  const originalPlannedTotalCost = original?.plannedTotalCost ?? null;
  const additionalPlannedTotalCost = sumNullable(additionals, item => item.plannedTotalCost);
  const plannedTotalCost = sumNullable(allSlices, item => item.plannedTotalCost);
  const originalExpectedProfit = original?.expectedProfit ?? null;
  const additionalExpectedProfit = sumNullable(additionals, item => item.expectedProfit);
  const expectedProfit = sumNullable(allSlices, item => item.expectedProfit);
  const originalTaxes = original?.taxes ?? null;
  const additionalTaxes = sumNullable(additionals, item => item.taxes);
  const taxes = sumNullable(allSlices, item => item.taxes);
  const expectedMargin = ratioPct(expectedProfit, salePrice) ?? original?.expectedMargin ?? null;

  return {
    original,
    additionals,
    additionalCount: additionals.length,
    additionalTotals: {
      salePrice: additionalSalePrice,
      plannedTotalCost: additionalPlannedTotalCost,
      expectedProfit: additionalExpectedProfit,
      taxes: additionalTaxes
    },
    totals: {
      salePrice,
      plannedTotalCost,
      expectedProfit,
      expectedMargin,
      taxes
    },
    originalSalePrice,
    additionalSalePrice,
    originalPlannedTotalCost,
    additionalPlannedTotalCost,
    originalExpectedProfit,
    additionalExpectedProfit,
    originalTaxes,
    additionalTaxes,
    salePrice,
    plannedTotalCost,
    expectedProfit,
    expectedMargin,
    taxes
  };
}

function groupCommercialRevisionsByProposal(revisions, currentByCodProp = new Map()) {
  const groups = new Map();
  for (const revision of revisions) {
    const key = revision.codProp;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(revision);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a - b)
    .map(([codProp, items]) => ({
      proposalCode: String(codProp),
      parentProposalCode: items[0]?.parentCodProp ? String(items[0].parentCodProp) : null,
      currentCodBd: currentByCodProp.get(codProp) ?? null,
      revisions: items.sort((a, b) => b.nRev - a.nRev || b.codBd - a.codBd)
    }));
}

export function applyStockCostsToDashboardRows(rows, stockCosts) {
  for (const row of rows) {
    const stockCost = stockCosts.get(row.projectId)?.total ?? 0;
    row.stockCost = stockCost;
    if (stockCost > 0) {
      row.realizedCost = (toNumber(row.realizedOmieCost) ?? 0) + stockCost;
    }
  }
  return rows;
}

export function applyManualCostsToDashboardRows(rows, manualCosts) {
  for (const row of rows) {
    const manualCost = manualCosts.get(row.projectId)?.total ?? 0;
    row.manualCost = manualCost;
    if (manualCost > 0) {
      row.realizedCost = (toNumber(row.realizedCost) ?? toNumber(row.realizedOmieCost) ?? 0) + manualCost;
    }
  }
  return rows;
}

function normalizeSleepModeMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const [collaboratorId, mode] of Object.entries(value)) {
    if (typeof collaboratorId !== 'string' || !collaboratorId.trim()) continue;
    if (mode === 'HOME' || mode === 'AWAY') result[collaboratorId] = mode;
  }
  return result;
}

function normalizeCollaboratorIdList(value) {
  if (!Array.isArray(value)) return [];
  const ids = [];
  const seen = new Set();
  for (const raw of value) {
    const id = typeof raw === 'string' ? raw.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function addLaborCollaborator(map, collaborator, source) {
  if (!collaborator?.id) return;
  const existing = map.get(collaborator.id);
  if (existing) {
    if (!existing.sources.includes(source)) existing.sources.push(source);
    return;
  }
  map.set(collaborator.id, {
    id: collaborator.id,
    name: collaborator.name,
    role: collaborator.jobRole?.name ?? collaborator.roleNameSnapshot ?? null,
    sources: [source]
  });
}

async function listProjectLaborCollaborators(project, sleepModeMap) {
  const manualIds = normalizeCollaboratorIdList(project.laborCollaboratorIds);
  const sleepModeIds = Object.keys(sleepModeMap);
  const rows = new Map();

  addLaborCollaborator(rows, project.operator, 'LEADER');

  const [rdoCollaborators, manualCollaborators] = await Promise.all([
    prisma.reportCollaborator.findMany({
      where: { report: { projectId: project.id, reportType: 'RDO', deletedAt: null } },
      select: {
        roleNameSnapshot: true,
        collaborator: { select: { id: true, name: true, jobRole: { select: { name: true } } } }
      },
      orderBy: { collaborator: { name: 'asc' } }
    }),
    prisma.collaborator.findMany({
      where: { id: { in: [...new Set([...manualIds, ...sleepModeIds])] } },
      select: { id: true, name: true, jobRole: { select: { name: true } } }
    })
  ]);

  for (const row of rdoCollaborators) {
    addLaborCollaborator(rows, { ...row.collaborator, roleNameSnapshot: row.roleNameSnapshot }, 'RDO');
  }
  const manualById = new Map(manualCollaborators.map(collaborator => [collaborator.id, collaborator]));
  for (const id of [...manualIds, ...sleepModeIds]) addLaborCollaborator(rows, manualById.get(id), 'MANUAL');

  return {
    laborCollaboratorIds: manualIds.filter(id => manualById.has(id)),
    laborCollaborators: Array.from(rows.values())
  };
}

// Cria/atualiza o orçamento previsto (versão única "1") com os dados da revisão informada.
// approvedAt é definido no ato da 1ª seleção (editável depois) e preservado ao trocar de revisão.
// selectionStatus permanece como está (marcação manual da vencedora — P-19).
async function upsertBudget(client, projectId, proposal) {
  const fields = budgetFieldsFromProposal(proposal);
  return client.projectBudget.upsert({
    where: { projectId_version: { projectId, version: 1 } },
    create: { projectId, version: 1, source: 'ACCESS_IMPORT', approvedAt: new Date(), ...fields },
    update: fields
  });
}

// Reespelha todos os campos comerciais materializados no orçamento da proposta selecionada.
// Campos operacionais/manuais do projeto (approvedAt, início, avanço manual, equipe etc.) são preservados.
export async function refreshSelectedProjectBudgetsFromProposals(client, { codBds = null } = {}) {
  const selectedCodBds = Array.isArray(codBds) ? Array.from(new Set(codBds.filter(Number.isInteger))) : null;
  if (selectedCodBds && selectedCodBds.length === 0) return 0;

  const budgets = await client.projectBudget.findMany({
    where: {
      sourceProposalCodBd: selectedCodBds
        ? { in: selectedCodBds }
        : { not: null }
    },
    select: {
      projectId: true,
      version: true,
      sourceProposalCodBd: true
    }
  });
  if (budgets.length === 0) return 0;

  const sourceCodBds = Array.from(new Set(budgets.map(budget => budget.sourceProposalCodBd).filter(Number.isInteger)));
  if (sourceCodBds.length === 0) return 0;

  const proposals = await client.commercialProposal.findMany({
    where: { codBd: { in: sourceCodBds } }
  });
  const proposalsByCodBd = new Map(proposals.map(proposal => [proposal.codBd, proposal]));

  let refreshed = 0;
  for (const budget of budgets) {
    const proposal = proposalsByCodBd.get(budget.sourceProposalCodBd);
    if (!proposal) continue;
    await client.projectBudget.update({
      where: { projectId_version: { projectId: budget.projectId, version: budget.version } },
      data: budgetFieldsFromProposal(proposal)
    });
    refreshed += 1;
  }
  return refreshed;
}

// Lista as revisões (linhas do Access) cuja proposta bate com a do projeto e indica a vigente.
export async function listProjectRevisions(projectId) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      commercialProposalCode: true,
      contractCode: true,
      code: true,
      startDate: true,
      mobilizationDate: true,
      demobilizationDate: true,
      manualProgressPct: true,
      offshore: true,
      laborSleepModeByCollaborator: true,
      laborCollaboratorIds: true,
      operator: { select: { id: true, name: true, jobRole: { select: { name: true } } } }
    }
  });
  if (!project) throw new Error('Projeto não encontrado.');
  const codProp = projectProposalCode(project);
  const laborSleepModeByCollaborator = normalizeSleepModeMap(project.laborSleepModeByCollaborator);
  const labor = await listProjectLaborCollaborators(project, laborSleepModeByCollaborator);
  if (!Number.isInteger(codProp)) {
    return {
      proposalCode: null,
      currentCodBd: null,
      resolved: false,
      startDate: project.startDate ?? null,
      mobilizationDate: project.mobilizationDate ?? null,
      demobilizationDate: project.demobilizationDate ?? null,
      manualProgressPct: project.manualProgressPct ?? null,
      offshore: project.offshore ?? false,
      laborSleepModeByCollaborator,
      laborCollaboratorIds: labor.laborCollaboratorIds,
      laborCollaborators: labor.laborCollaborators,
      additionalProposals: [],
      currentAdditionalCodBds: [],
      revisions: []
    };
  }
  const [revisions, additionalRevisions, budget, selectedAdditionals] = await Promise.all([
    prisma.commercialProposal.findMany({
      where: { codProp },
      orderBy: { nRev: 'desc' },
      select: {
        codBd: true, codProp: true, parentCodProp: true, nRev: true, proposalDate: true, modifiedInAccessAt: true,
        serviceModality: true, salePrice: true, plannedCost: true, expectedProfit: true,
        expectedMargin: true, taxes: true, plannedDays: true, workedDays: true,
        numOperators: true, numSupervisors: true, numPerDay: true, numPerNight: true,
        mobilizationLeadDays: true, isComplete: true
      }
    }),
    prisma.commercialProposal.findMany({
      where: { parentCodProp: codProp },
      orderBy: [{ codProp: 'asc' }, { nRev: 'desc' }],
      select: {
        codBd: true, codProp: true, parentCodProp: true, nRev: true, proposalDate: true, modifiedInAccessAt: true,
        serviceModality: true, salePrice: true, plannedCost: true, expectedProfit: true,
        expectedMargin: true, taxes: true, plannedDays: true, workedDays: true,
        numOperators: true, numSupervisors: true, numPerDay: true, numPerNight: true,
        mobilizationLeadDays: true, isComplete: true
      }
    }),
    prisma.projectBudget.findUnique({
      where: { projectId_version: { projectId, version: 1 } },
      select: { sourceProposalCodBd: true, approvedAt: true, mobilizationLeadDays: true }
    }),
    prisma.projectAdditionalProposal.findMany({
      where: { projectId },
      select: { codProp: true, sourceProposalCodBd: true }
    })
  ]);
  const currentAdditionalByCodProp = new Map(
    selectedAdditionals.map(selection => [selection.codProp, selection.sourceProposalCodBd])
  );
  return {
    proposalCode: String(codProp),
    currentCodBd: budget?.sourceProposalCodBd ?? null,
    resolved: Boolean(project.commercialProposalCode),
    approvedAt: budget?.approvedAt ?? null,
    mobilizationLeadDays: budget?.mobilizationLeadDays ?? null,
    startDate: project.startDate ?? null,
    mobilizationDate: project.mobilizationDate ?? null,
    demobilizationDate: project.demobilizationDate ?? null,
    manualProgressPct: project.manualProgressPct ?? null,
    offshore: project.offshore ?? false,
    laborSleepModeByCollaborator,
    laborCollaboratorIds: labor.laborCollaboratorIds,
    laborCollaborators: labor.laborCollaborators,
    additionalProposals: groupCommercialRevisionsByProposal(additionalRevisions, currentAdditionalByCodProp),
    currentAdditionalCodBds: selectedAdditionals.map(selection => selection.sourceProposalCodBd),
    revisions
  };
}

/*
 * A desmobilização fecha a janela usada como contexto do cronograma, então precisa ser coerente:
 * sem mobilização não há janela, e uma data anterior à mobilização inverteria o intervalo.
 * Como cada campo é opcional na requisição, a mobilização vigente vem do banco quando não veio no
 * corpo — `undefined` significa "não mexeu", `null` significa "limpou".
 */
export function assertScheduleWindowDates({
  mobilizationDate,
  demobilizationDate,
  currentMobilizationDate = null
} = {}) {
  if (!demobilizationDate) return;
  const effectiveMobilization = mobilizationDate !== undefined
    ? (mobilizationDate ? new Date(mobilizationDate) : null)
    : currentMobilizationDate;
  if (!effectiveMobilization) {
    throw new Error('Informe a data de mobilização antes da desmobilização.');
  }
  if (new Date(demobilizationDate) < new Date(effectiveMobilization)) {
    throw new Error('A desmobilização não pode ser anterior à mobilização.');
  }
}

export async function syncProjectDemobilizationToMissions(tx, projectId, demobilizationDate) {
  const missions = await tx.efetivoMissionPlan.findMany({
    where: { projectId, deletedAt: null },
    select: { planId: true }
  });
  if (!missions.length) return;
  await tx.efetivoMissionPlan.updateMany({
    where: { projectId, deletedAt: null },
    data: {
      returnDate: demobilizationDate ? new Date(demobilizationDate) : null,
      version: { increment: 1 }
    }
  });
  const planIds = [...new Set(missions.map(mission => mission.planId))];
  await tx.efetivoPlan.updateMany({
    where: { id: { in: planIds } },
    data: { revision: { increment: 1 } }
  });
}

// Edita o cronograma: data de aprovação da proposta (no orçamento) e início real (no projeto).
// Cada campo é opcional; passar null limpa. approvedAt exige um orçamento já escolhido.
export async function setProjectSchedule(projectId, {
  approvedAt,
  startDate,
  mobilizationDate,
  demobilizationDate,
  manualProgressPct,
  offshore,
  laborSleepModeByCollaborator,
  laborCollaboratorIds
} = {}) {
  return prisma.$transaction(async (tx) => {
    let previousManualProgressPct;
    if (manualProgressPct !== undefined) {
      const currentProject = await tx.project.findUnique({
        where: { id: projectId },
        select: { manualProgressPct: true }
      });
      previousManualProgressPct = currentProject?.manualProgressPct != null
        ? Number(currentProject.manualProgressPct)
        : null;
    }

    if (approvedAt !== undefined) {
      const budget = await tx.projectBudget.findUnique({
        where: { projectId_version: { projectId, version: 1 } },
        select: { id: true }
      });
      if (!budget) throw new Error('Orçamento não encontrado para o projeto. Escolha uma revisão primeiro.');
      await tx.projectBudget.update({
        where: { projectId_version: { projectId, version: 1 } },
        data: { approvedAt: approvedAt ? new Date(approvedAt) : null }
      });
    }
    if (demobilizationDate) {
      const currentDates = await tx.project.findUnique({
        where: { id: projectId },
        select: { mobilizationDate: true }
      });
      assertScheduleWindowDates({
        mobilizationDate,
        demobilizationDate,
        currentMobilizationDate: currentDates?.mobilizationDate ?? null
      });
    }

    const projectData = {};
    const nextManualProgressPct = manualProgressPct == null ? null : Number(manualProgressPct);
    if (startDate !== undefined) projectData.startDate = startDate ? new Date(startDate) : null;
    if (mobilizationDate !== undefined) projectData.mobilizationDate = mobilizationDate ? new Date(mobilizationDate) : null;
    if (demobilizationDate !== undefined) {
      projectData.demobilizationDate = demobilizationDate ? new Date(demobilizationDate) : null;
    }
    if (manualProgressPct !== undefined) projectData.manualProgressPct = nextManualProgressPct;
    if (offshore !== undefined) projectData.offshore = Boolean(offshore);
    if (laborSleepModeByCollaborator !== undefined) {
      projectData.laborSleepModeByCollaborator = normalizeSleepModeMap(laborSleepModeByCollaborator);
    }
    if (laborCollaboratorIds !== undefined) {
      const ids = normalizeCollaboratorIdList(laborCollaboratorIds);
      if (ids.length === 0) {
        projectData.laborCollaboratorIds = [];
      } else {
        const collaborators = await tx.collaborator.findMany({
          where: { id: { in: ids } },
          select: { id: true }
        });
        const validIds = new Set(collaborators.map(collaborator => collaborator.id));
        projectData.laborCollaboratorIds = ids.filter(id => validIds.has(id));
      }
    }
    if (Object.keys(projectData).length > 0) {
      await tx.project.update({ where: { id: projectId }, data: projectData });
    }
    if (demobilizationDate !== undefined) {
      await syncProjectDemobilizationToMissions(tx, projectId, demobilizationDate);
    }
    if (
      manualProgressPct !== undefined
      && shouldRecordManualProgressHistory(previousManualProgressPct, nextManualProgressPct)
    ) {
      await tx.projectManualProgressHistory.create({
        data: { projectId, progressPct: nextManualProgressPct }
      });
    }
    return { ok: true };
  });
}

// Variante interna reutilizável por integrações, com client/transaction explícito.
export async function setProjectBudgetRevisionWithClient(client, projectId, codBd) {
  const proposal = await client.commercialProposal.findUnique({ where: { codBd } });
  if (!proposal) throw new Error('Revisão não encontrada.');
  if (proposal.parentCodProp !== null && proposal.parentCodProp !== undefined) {
    throw new Error('A revisão informada é de uma proposta adicional. Use a seleção de proposta adicional.');
  }
  const project = await client.project.findUnique({
    where: { id: projectId },
    select: { id: true, commercialProposalCode: true, contractCode: true, code: true }
  });
  if (!project) throw new Error('Projeto não encontrado.');
  const codProp = projectProposalCode(project);
  if (proposal.codProp !== codProp) {
    throw new Error('A revisão informada não pertence a este projeto.');
  }
  const applyRevision = async (tx) => {
    const budget = await upsertBudget(tx, projectId, proposal);
    await tx.project.update({
      where: { id: projectId },
      data: { commercialProposalCode: String(codProp) }
    });
    return budget;
  };
  return typeof client.$transaction === 'function'
    ? client.$transaction(applyRevision)
    : applyRevision(client);
}

// Define qual revisão (codBd) é a que vale: recalcula o orçamento e marca o projeto como resolvido.
export async function setProjectBudgetRevision(projectId, codBd) {
  return setProjectBudgetRevisionWithClient(prisma, projectId, codBd);
}

export async function setProjectAdditionalProposalRevision(projectId, codBd, { selectedByUserId = null } = {}) {
  const proposal = await prisma.commercialProposal.findUnique({ where: { codBd } });
  if (!proposal) throw new Error('Revisão adicional não encontrada.');
  if (proposal.parentCodProp === null || proposal.parentCodProp === undefined) {
    throw new Error('A revisão informada não é de uma proposta adicional.');
  }
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, contractCode: true, code: true }
  });
  if (!project) throw new Error('Projeto não encontrado.');
  const codProp = projectProposalCode(project);
  if (proposal.parentCodProp !== codProp) {
    throw new Error('A proposta adicional informada não pertence a este projeto.');
  }
  return prisma.projectAdditionalProposal.upsert({
    where: { projectId_codProp: { projectId, codProp: proposal.codProp } },
    create: {
      projectId,
      codProp: proposal.codProp,
      sourceProposalCodBd: proposal.codBd,
      selectedByUserId,
      selectedAt: new Date()
    },
    update: {
      sourceProposalCodBd: proposal.codBd,
      selectedByUserId,
      selectedAt: new Date()
    }
  });
}

export async function removeProjectAdditionalProposal(projectId, codProp) {
  if (!Number.isInteger(codProp)) throw new Error('Proposta adicional inválida.');
  const result = await prisma.projectAdditionalProposal.deleteMany({
    where: { projectId, codProp }
  });
  return { ok: true, deleted: result.count };
}

// Dashboard de acompanhamento: projetos cuja proposta bate com propostas importadas, com o
// previsto (orçamento/revisão) e o realizado parcial (nº de RDOs = dias trabalhados, % prazo).
export async function listCommercialDashboard({ categoryCode = null, includeAdminOnlyCategories = true } = {}) {
  // Salários do Omie nunca entram no realizado (serão calculados no app via ponto).
  const categoryWhere = await buildOmieCostCategoryWhere({
    categoryCode,
    includeAdminOnly: includeAdminOnlyCategories
  });
  const realizedWhere = {
    projectId: { not: null },
    ...categoryWhere
  };
  const invoicedWhere = {
    projectId: { not: null },
    valor: { not: null },
    NOT: [{ statusTitulo: 'CANCELADO' }],
    OR: [
      { codigoTipoDocumento: 'NFS' },
      {
        AND: [
          { OR: [{ codigoTipoDocumento: null }, { codigoTipoDocumento: '' }] },
          { numeroDocumentoFiscal: { not: null } },
          { numeroDocumentoFiscal: { not: '' } }
        ]
      }
    ]
  };
  const [proposals, projects, budgets, selectedAdditionals, rdoGroups, omieTotals, omiePaid, omieReceivables] = await Promise.all([
    prisma.commercialProposal.findMany({
      select: {
        codBd: true, codProp: true, parentCodProp: true, nRev: true, salePrice: true, plannedCost: true,
        expectedProfit: true, expectedMargin: true, taxes: true, plannedDays: true, workedDays: true,
        numOperators: true, numSupervisors: true, numPerDay: true, numPerNight: true,
        mobilizationLeadDays: true, serviceModality: true, components: true
      }
    }),
    prisma.project.findMany({
      where: { deletedAt: null, managerOnly: false },
      select: {
        id: true,
        code: true,
        name: true,
        clientName: true,
        clientCnpj: true,
        contractCode: true,
        commercialProposalCode: true,
        startDate: true,
        isActive: true,
        acompanhamentoArchivedAt: true,
        acompanhamentoReviewedAt: true,
        acompanhamentoReportArchivedAt: true
      }
    }),
    prisma.projectBudget.findMany({
      where: { version: 1 },
      select: {
        projectId: true, sourceProposalCodBd: true, approvedAt: true, mobilizationLeadDays: true,
        salePrice: true, plannedTotalCost: true, expectedProfit: true, expectedMargin: true, taxes: true, plannedDays: true
      }
    }),
    prisma.projectAdditionalProposal.findMany({
      select: { projectId: true, codProp: true, sourceProposalCodBd: true }
    }),
    prisma.report.groupBy({ by: ['projectId'], where: { reportType: 'RDO', deletedAt: null }, _count: { _all: true } }),
    prisma.omiePurchase.groupBy({ by: ['projectId'], where: realizedWhere, _sum: { valor: true } }),
    prisma.omiePurchase.groupBy({ by: ['projectId'], where: { ...realizedWhere, statusTitulo: 'PAGO' }, _sum: { valor: true } }),
    prisma.omieReceivable.findMany({
      where: invoicedWhere,
      select: {
        projectId: true,
        valor: true,
        valorIss: true,
        aliquotaIss: true,
        codigoLc116: true,
        codigoServico: true
      }
    })
  ]);

  const latestByProp = new Map();
  const byCodBd = new Map();
  for (const p of proposals) {
    byCodBd.set(p.codBd, p);
    if (p.parentCodProp !== null && p.parentCodProp !== undefined) continue;
    const cur = latestByProp.get(p.codProp);
    if (!cur || p.nRev > cur.nRev) latestByProp.set(p.codProp, p);
  }
  const budgetByProject = new Map(budgets.map(b => [b.projectId, b]));
  const selectedAdditionalsByProject = new Map();
  for (const selection of selectedAdditionals) {
    if (!selectedAdditionalsByProject.has(selection.projectId)) selectedAdditionalsByProject.set(selection.projectId, []);
    selectedAdditionalsByProject.get(selection.projectId).push(selection);
  }
  const rdoByProject = new Map(rdoGroups.map(g => [g.projectId, g._count._all]));
  const realizedByProject = new Map(omieTotals.map(g => [g.projectId, g._sum.valor]));
  const realizedPaidByProject = new Map(omiePaid.map(g => [g.projectId, g._sum.valor]));
  const invoicedByProject = new Map();
  for (const receivable of omieReceivables) {
    const amount = toNumber(receivable.valor);
    if (amount === null || amount <= 0) continue;
    const projectId = receivable.projectId;
    const current = invoicedByProject.get(projectId) ?? { total: 0, iss: 0, count: 0, invoices: [] };
    const iss = toNumber(receivable.valorIss);
    current.total += amount;
    current.iss += iss ?? 0;
    current.count += 1;
    current.invoices.push({
      amount,
      iss,
      issRatePct: toNumber(receivable.aliquotaIss),
      serviceTaxCode: receivable.codigoLc116 ?? receivable.codigoServico ?? null
    });
    invoicedByProject.set(projectId, current);
  }

  const rows = [];
  for (const project of projects) {
    const codProp = projectProposalCode(project);
    if (!Number.isInteger(codProp) || !latestByProp.has(codProp)) continue;
    const budget = budgetByProject.get(project.id) || null;
    const resolved = Boolean(project.commercialProposalCode) && Boolean(budget);
    const source = (budget && byCodBd.get(budget.sourceProposalCodBd)) || latestByProp.get(codProp);
    const additionalSources = (selectedAdditionalsByProject.get(project.id) ?? [])
      .map(selection => byCodBd.get(selection.sourceProposalCodBd))
      .filter(proposal => proposal && proposal.parentCodProp === codProp)
      .sort((a, b) => a.codProp - b.codProp || b.nRev - a.nRev);
    const budgetBreakdown = buildBudgetBreakdown({
      originalSource: source,
      originalBudget: budget,
      additionalSources
    });
    const components = combineComponents([source, ...additionalSources]);
    const originalPlannedDays = budget?.plannedDays ?? source?.plannedDays ?? null;
    const plannedDays = sumNullable([{ plannedDays: originalPlannedDays }, ...additionalSources], item => item.plannedDays, { decimals: 0 });
    const workedDays = sumNullable([{ workedDays: source?.workedDays ?? null }, ...additionalSources], item => item.workedDays, { decimals: 0 });
    const salePrice = budgetBreakdown.salePrice;
    const invoiced = invoicedByProject.get(project.id) ?? null;
    rows.push({
      projectId: project.id,
      code: project.code,
      name: project.name,
      clientName: project.clientName,
      clientCnpj: project.clientCnpj,
      proposalCode: String(codProp),
      resolved,
      archived: !project.isActive, // status original dos Relatórios; o arquivamento local é aplicado nos cards
      acompanhamentoArchivedAt: project.acompanhamentoArchivedAt ?? null,
      acompanhamentoReviewedAt: project.acompanhamentoReviewedAt ?? null,
      acompanhamentoReportArchivedAt: project.acompanhamentoReportArchivedAt ?? null,
      startDate: project.startDate ?? null,
      approvedAt: budget?.approvedAt ?? null,
      mobilizationLeadDays: budget?.mobilizationLeadDays ?? source?.mobilizationLeadDays ?? null,
      salePrice,
      originalSalePrice: budgetBreakdown.originalSalePrice,
      additionalSalePrice: budgetBreakdown.additionalSalePrice,
      invoicedRevenue: invoiced?.total ?? null,
      invoicedIss: invoiced?.iss ?? null,
      invoiceCount: invoiced?.count ?? 0,
      presumedProfitTaxes: buildPresumedProfitTaxEstimate(salePrice, {
        components,
        invoices: invoiced?.invoices ?? null,
        invoicedAmount: invoiced?.total ?? null,
        invoiceIss: invoiced?.iss ?? null
      }),
      plannedTotalCost: budgetBreakdown.plannedTotalCost,
      originalPlannedTotalCost: budgetBreakdown.originalPlannedTotalCost,
      additionalPlannedTotalCost: budgetBreakdown.additionalPlannedTotalCost,
      expectedProfit: budgetBreakdown.expectedProfit,
      originalExpectedProfit: budgetBreakdown.originalExpectedProfit,
      additionalExpectedProfit: budgetBreakdown.additionalExpectedProfit,
      expectedMargin: budgetBreakdown.expectedMargin,
      taxes: budgetBreakdown.taxes,
      originalTaxes: budgetBreakdown.originalTaxes,
      additionalTaxes: budgetBreakdown.additionalTaxes,
      budgetBreakdown: {
        original: budgetBreakdown.original,
        additionals: budgetBreakdown.additionals,
        additionalCount: budgetBreakdown.additionalCount,
        additionalTotals: budgetBreakdown.additionalTotals,
        totals: budgetBreakdown.totals
      },
      plannedDays,
      workedDays,
      numOperators: source?.numOperators ?? null,
      numSupervisors: source?.numSupervisors ?? null,
      numPerDay: source?.numPerDay ?? null,
      numPerNight: source?.numPerNight ?? null,
      serviceModality: source?.serviceModality ?? null,
      components,
      rdoCount: rdoByProject.get(project.id) ?? 0,
      realizedOmieCost: realizedByProject.get(project.id) ?? null,
      realizedCost: realizedByProject.get(project.id) ?? null,
      realizedPaid: realizedPaidByProject.get(project.id) ?? null,
      stockCost: 0,
      manualCost: 0,
      progressPct: null,
      progressMethod: null
    });
  }

  if (!categoryCode && rows.length > 0) {
    const [stockCosts, manualCosts] = await Promise.all([
      getStockConsumptionCostByProject(rows.map(row => row.projectId)),
      getManualProjectCostsByProject(rows.map(row => row.projectId))
    ]);
    applyStockCostsToDashboardRows(rows, stockCosts);
    applyManualCostsToDashboardRows(rows, manualCosts);
  }

  // Avanço físico (RDO ponderado por serviço; ou manual como fallback) dos projetos exibidos, em lote.
  const progressByProject = await computeProgressForProjects(rows.map(r => r.projectId));
  for (const row of rows) {
    const p = progressByProject.get(row.projectId);
    row.progressPct = p?.progressPct ?? null;
    row.progressMethod = p?.progressMethod ?? null;
    row.progressWeight = progressContributionWeight(p);
  }

  rows.sort((a, b) => Number(a.resolved) - Number(b.resolved) || a.code.localeCompare(b.code));
  return rows;
}

function groupedCountValue(group) {
  return group?._count?._all ?? group?.count ?? group?.revisionCount ?? 0;
}

function addSelectedAdditional(selectedByProject, selection) {
  if (!selection?.projectId || !Number.isInteger(selection.codProp)) return;
  if (!selectedByProject.has(selection.projectId)) selectedByProject.set(selection.projectId, new Set());
  selectedByProject.get(selection.projectId).add(selection.codProp);
}

export function buildCommercialPendencias({
  projects = [],
  proposalRevisionCounts = [],
  additionalRevisionCounts = [],
  selectedAdditionalProposals = []
} = {}) {
  const originalCountByProp = new Map();
  for (const group of proposalRevisionCounts) {
    if (!Number.isInteger(group?.codProp)) continue;
    originalCountByProp.set(group.codProp, groupedCountValue(group));
  }

  const additionalsByParent = new Map();
  for (const group of additionalRevisionCounts) {
    if (!Number.isInteger(group?.parentCodProp) || !Number.isInteger(group?.codProp)) continue;
    if (!additionalsByParent.has(group.parentCodProp)) additionalsByParent.set(group.parentCodProp, []);
    additionalsByParent.get(group.parentCodProp).push({
      codProp: group.codProp,
      revisionCount: groupedCountValue(group)
    });
  }

  const selectedByProject = new Map();
  selectedAdditionalProposals.forEach(selection => addSelectedAdditional(selectedByProject, selection));

  const result = [];
  for (const project of projects) {
    const codProp = projectProposalCode(project);
    if (!Number.isInteger(codProp)) continue;
    const originalRevisionCount = originalCountByProp.get(codProp) ?? 0;
    const additionalGroups = additionalsByParent.get(codProp) ?? [];
    if (originalRevisionCount === 0 && additionalGroups.length === 0) continue;

    const selectedAdditionals = selectedByProject.get(project.id) ?? new Set();
    const originalPending = originalRevisionCount > 0 && !project.commercialProposalCode;
    const pendingAdditionalProposalCount = additionalGroups.filter(group => !selectedAdditionals.has(group.codProp)).length;
    const additionalRevisionCount = additionalGroups.reduce((sum, group) => sum + group.revisionCount, 0);
    const pendingCount = (originalPending ? 1 : 0) + pendingAdditionalProposalCount;

    result.push({
      projectId: project.id,
      proposalCode: String(codProp),
      revisionCount: originalRevisionCount + additionalRevisionCount,
      originalRevisionCount,
      additionalProposalCount: additionalGroups.length,
      additionalRevisionCount,
      pendingCount,
      pendingAdditionalProposalCount,
      originalPending,
      resolved: pendingCount === 0
    });
  }
  return result;
}

// Projetos cuja proposta bate com alguma proposta importada — sinalização na aba Projetos.
// resolved = proposta principal e adicionais já foram escolhidas quando necessário.
export async function listCommercialPendencias() {
  const [originalGrouped, additionalGrouped, projects, selectedAdditionals] = await Promise.all([
    prisma.commercialProposal.groupBy({
      by: ['codProp'],
      where: { parentCodProp: null },
      _count: { _all: true }
    }),
    prisma.commercialProposal.groupBy({
      by: ['parentCodProp', 'codProp'],
      where: { parentCodProp: { not: null } },
      _count: { _all: true }
    }),
    prisma.project.findMany({
      where: { deletedAt: null, managerOnly: false },
      select: { id: true, code: true, contractCode: true, commercialProposalCode: true }
    }),
    prisma.projectAdditionalProposal.findMany({
      select: { projectId: true, codProp: true }
    })
  ]);

  return buildCommercialPendencias({
    projects,
    proposalRevisionCounts: originalGrouped,
    additionalRevisionCounts: additionalGrouped,
    selectedAdditionalProposals: selectedAdditionals
  });
}

/**
 * Importa o banco comercial Access.
 * @param {object} options
 * @param {Buffer} options.buffer             conteúdo do .accdb
 * @param {string} options.fileName           nome do arquivo enviado
 * @param {string|null} [options.importedByUserId]  usuário (null quando via token de serviço)
 * @param {'SCRIPT'|'MANUAL'} [options.source]
 * @returns {Promise<object>} resumo da importação
 */
export async function importCommercialAccess({ buffer, fileName, importedByUserId = null, source = 'SCRIPT' }) {
  const contentHash = hashBuffer(buffer);

  try {
    // Reenvio idêntico: pula o trabalho (barato), mas grava o recebimento para auditoria/status.
    const duplicate = await prisma.accessImport.findFirst({
      where: { contentHash, status: 'SUCCESS' },
      orderBy: { createdAt: 'desc' }
    });
    if (duplicate) {
      let refreshedSelectedProposalFields = 0;
      const receipt = await prisma.$transaction(async (tx) => {
        refreshedSelectedProposalFields = await refreshSelectedProjectBudgetsFromProposals(tx);
        return tx.accessImport.create({
          data: {
            fileName,
            contentHash,
            source,
            status: 'SUCCESS',
            rowsRead: 0,
            created: 0,
            updated: 0,
            skipped: 0,
            pendingProjectsCreated: 0,
            summary: { skippedDuplicate: true, previousImportId: duplicate.id, refreshedSelectedProposalFields },
            importedByUserId
          }
        });
      });
      return { skippedDuplicate: true, contentHash, importId: receipt.id, previousImportId: duplicate.id, refreshedSelectedProposalFields };
    }

    const rawRows = readProposals(buffer);
    const proposals = rawRows
      .map(mapProposalRow)
      .filter(p => Number.isInteger(p.codBd) && Number.isInteger(p.codProp));

    let created = 0;
    let updated = 0;
    let refreshedSelectedProposalFields = 0;
    const importedCodBds = Array.from(new Set(proposals.map(proposal => proposal.codBd)));

    // A importação apenas popula o staging (CommercialProposal). Não cria missões: a maioria das
    // propostas não fecha. A vinculação a um projeto acontece sob demanda, quando já existe uma
    // missão cuja proposta bate (ver listCommercialPendencias / setProjectBudgetRevision).
    const result = await prisma.$transaction(async (tx) => {
      for (const p of proposals) {
        const existing = await tx.commercialProposal.findUnique({ where: { codBd: p.codBd } });
        await tx.commercialProposal.upsert({ where: { codBd: p.codBd }, create: p, update: p });
        if (existing) updated += 1; else created += 1;
      }
      refreshedSelectedProposalFields = await refreshSelectedProjectBudgetsFromProposals(tx, { codBds: importedCodBds });

      return tx.accessImport.create({
        data: {
          fileName,
          contentHash,
          source,
          status: 'SUCCESS',
          rowsRead: rawRows.length,
          created,
          updated,
          skipped: rawRows.length - proposals.length,
          pendingProjectsCreated: 0,
          summary: {
            proposals: proposals.length,
            distinctProposals: new Set(proposals.map(p => p.codProp)).size,
            refreshedSelectedProposalFields
          },
          importedByUserId
        }
      });
    }, { timeout: 120000 });

    return {
      importId: result.id,
      status: result.status,
      rowsRead: rawRows.length,
      created,
      updated,
      refreshedSelectedProposalFields,
      skipped: rawRows.length - proposals.length,
      distinctProposals: new Set(proposals.map(p => p.codProp)).size
    };
  } catch (error) {
    try {
      await prisma.accessImport.create({
        data: {
          fileName,
          contentHash,
          source,
          status: 'ERROR',
          rowsRead: 0,
          created: 0,
          updated: 0,
          skipped: 0,
          pendingProjectsCreated: 0,
          error: error.message,
          summary: { errorName: error.name || null },
          importedByUserId
        }
      });
    } catch (logError) {
      console.warn('[commercial-import] falha ao registrar erro de importação:', logError.message);
    }
    throw error;
  }
}
