/*
 * Importação do banco comercial Access (propostas_bd.accdb) — módulo Acompanhamento de Projetos.
 *
 * Lê a tabela `proposta`, normaliza os campos (vários vêm como texto/nulo), grava o staging 1:1
 * (CommercialProposal, upsert por cod_bd) e deriva o orçamento previsto (ProjectBudget) da maior
 * revisão por proposta, criando Project pendente quando não houver correspondência.
 */

import { createHash } from 'node:crypto';

import MDBReader from 'mdb-reader';

import prisma from './prisma.js';

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
    rawRow: serializeRaw(row)
  };
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

// Extrai o "código do contrato" (número da proposta) da primeira parte de um texto.
// Ex.: "4096 - Rev. 1" -> 4096 · "4096" -> 4096 · "Sede 4096" -> 4096.
export function contractToProposalCode(value) {
  const match = String(value ?? '').match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : null;
}

// Número da proposta associado a um projeto, pela 1ª parte do contrato (fallback no código).
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

// Lista as revisões (linhas do Access) cujo contrato bate com o do projeto e indica a vigente.
export async function listProjectRevisions(projectId) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, commercialProposalCode: true, contractCode: true, code: true, startDate: true }
  });
  if (!project) throw new Error('Projeto não encontrado.');
  const codProp = projectProposalCode(project);
  if (!Number.isInteger(codProp)) {
    return { proposalCode: null, currentCodBd: null, resolved: false, startDate: project.startDate ?? null, revisions: [] };
  }
  const [revisions, budget] = await Promise.all([
    prisma.commercialProposal.findMany({
      where: { codProp },
      orderBy: { nRev: 'desc' },
      select: {
        codBd: true, codProp: true, nRev: true, proposalDate: true, modifiedInAccessAt: true,
        serviceModality: true, salePrice: true, plannedCost: true, expectedProfit: true,
        expectedMargin: true, taxes: true, plannedDays: true, workedDays: true,
        numOperators: true, numSupervisors: true, numPerDay: true, numPerNight: true,
        mobilizationLeadDays: true, isComplete: true
      }
    }),
    prisma.projectBudget.findUnique({
      where: { projectId_version: { projectId, version: 1 } },
      select: { sourceProposalCodBd: true, approvedAt: true, mobilizationLeadDays: true }
    })
  ]);
  return {
    proposalCode: String(codProp),
    currentCodBd: budget?.sourceProposalCodBd ?? null,
    resolved: Boolean(project.commercialProposalCode),
    approvedAt: budget?.approvedAt ?? null,
    mobilizationLeadDays: budget?.mobilizationLeadDays ?? null,
    startDate: project.startDate ?? null,
    revisions
  };
}

// Edita o cronograma: data de aprovação do contrato (no orçamento) e início real (no projeto).
// Cada campo é opcional; passar null limpa. approvedAt exige um orçamento já escolhido.
export async function setProjectSchedule(projectId, { approvedAt, startDate } = {}) {
  return prisma.$transaction(async (tx) => {
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
    if (startDate !== undefined) {
      await tx.project.update({
        where: { id: projectId },
        data: { startDate: startDate ? new Date(startDate) : null }
      });
    }
    return { ok: true };
  });
}

// Define qual revisão (codBd) é a que vale: recalcula o orçamento e marca o projeto como resolvido.
export async function setProjectBudgetRevision(projectId, codBd) {
  const proposal = await prisma.commercialProposal.findUnique({ where: { codBd } });
  if (!proposal) throw new Error('Revisão não encontrada.');
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, commercialProposalCode: true, contractCode: true, code: true }
  });
  if (!project) throw new Error('Projeto não encontrado.');
  const codProp = projectProposalCode(project);
  if (proposal.codProp !== codProp) {
    throw new Error('A revisão informada não pertence a este projeto.');
  }
  return prisma.$transaction(async (tx) => {
    const budget = await upsertBudget(tx, projectId, proposal);
    await tx.project.update({
      where: { id: projectId },
      data: { commercialProposalCode: String(codProp) }
    });
    return budget;
  });
}

// Projetos cujo contrato bate com alguma proposta importada — sinalização na aba Projetos.
// resolved = já houve escolha de revisão (commercialProposalCode preenchido).
export async function listCommercialPendencias() {
  const grouped = await prisma.commercialProposal.groupBy({
    by: ['codProp'],
    _count: { _all: true }
  });
  if (grouped.length === 0) return [];
  const countByProp = new Map(grouped.map(g => [g.codProp, g._count._all]));

  const projects = await prisma.project.findMany({
    where: { deletedAt: null },
    select: { id: true, code: true, contractCode: true, commercialProposalCode: true }
  });

  const result = [];
  for (const project of projects) {
    const codProp = projectProposalCode(project);
    if (!Number.isInteger(codProp) || !countByProp.has(codProp)) continue;
    result.push({
      projectId: project.id,
      proposalCode: String(codProp),
      revisionCount: countByProp.get(codProp),
      resolved: Boolean(project.commercialProposalCode)
    });
  }
  return result;
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

  // Reenvio idêntico: pula o trabalho (barato).
  const duplicate = await prisma.accessImport.findFirst({
    where: { contentHash, status: 'SUCCESS' },
    orderBy: { createdAt: 'desc' }
  });
  if (duplicate) {
    return { skippedDuplicate: true, contentHash, previousImportId: duplicate.id };
  }

  const rawRows = readProposals(buffer);
  const proposals = rawRows
    .map(mapProposalRow)
    .filter(p => Number.isInteger(p.codBd) && Number.isInteger(p.codProp));

  let created = 0;
  let updated = 0;

  // A importação apenas popula o staging (CommercialProposal). Não cria missões: a maioria das
  // propostas não fecha. A vinculação a um projeto acontece sob demanda, quando já existe uma
  // missão cujo contrato bate (ver listCommercialPendencias / setProjectBudgetRevision).
  const result = await prisma.$transaction(async (tx) => {
    for (const p of proposals) {
      const existing = await tx.commercialProposal.findUnique({ where: { codBd: p.codBd } });
      await tx.commercialProposal.upsert({ where: { codBd: p.codBd }, create: p, update: p });
      if (existing) updated += 1; else created += 1;
    }

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
        summary: { proposals: proposals.length, distinctProposals: new Set(proposals.map(p => p.codProp)).size },
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
    skipped: rawRows.length - proposals.length,
    distinctProposals: new Set(proposals.map(p => p.codProp)).size
  };
}
