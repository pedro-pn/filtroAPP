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

// Garante um Project para a proposta: tenta casar por commercialProposalCode (= cod_prop);
// senão cria um projeto pendente com código provisório PROP-<cod_prop>.
async function ensureProjectForProposal(tx, proposal) {
  const proposalCode = String(proposal.codProp);
  const existing = await tx.project.findFirst({
    where: {
      OR: [{ commercialProposalCode: proposalCode }, { code: proposalCode }]
    }
  });
  if (existing) {
    if (!existing.commercialProposalCode) {
      await tx.project.update({
        where: { id: existing.id },
        data: { commercialProposalCode: proposalCode }
      });
    }
    return { project: existing, created: false };
  }

  const project = await tx.project.create({
    data: {
      code: `PROP-${proposalCode}`,
      name: proposal.clientName ? `Proposta ${proposalCode} — ${proposal.clientName}` : `Proposta ${proposalCode}`,
      clientName: proposal.clientName || 'A definir',
      clientCnpj: proposal.clientCnpj || '',
      contractCode: '',
      location: proposal.localObra || '',
      commercialProposalCode: proposalCode,
      registrationPending: true,
      isActive: true
    }
  });
  return { project, created: true };
}

// Cria/atualiza o orçamento previsto (versão única "1") com os dados da revisão vigente.
async function upsertBudget(tx, projectId, proposal) {
  return tx.projectBudget.upsert({
    where: { projectId_version: { projectId, version: 1 } },
    create: {
      projectId,
      version: 1,
      sourceProposalCodBd: proposal.codBd,
      serviceModality: proposal.serviceModality,
      salePrice: proposal.salePrice,
      plannedTotalCost: proposal.plannedCost,
      expectedProfit: proposal.expectedProfit,
      expectedMargin: proposal.expectedMargin,
      taxes: proposal.taxes,
      plannedDays: proposal.plannedDays,
      isComplete: proposal.isComplete,
      source: 'ACCESS_IMPORT'
      // selectionStatus permanece UNKNOWN — marcação manual da vencedora (P-19)
    },
    update: {
      sourceProposalCodBd: proposal.codBd,
      serviceModality: proposal.serviceModality,
      salePrice: proposal.salePrice,
      plannedTotalCost: proposal.plannedCost,
      expectedProfit: proposal.expectedProfit,
      expectedMargin: proposal.expectedMargin,
      taxes: proposal.taxes,
      plannedDays: proposal.plannedDays,
      isComplete: proposal.isComplete
    }
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
  let pendingProjectsCreated = 0;
  const errors = [];

  // Revisão vigente por proposta = maior nRev.
  const latestByProp = new Map();
  for (const p of proposals) {
    const current = latestByProp.get(p.codProp);
    if (!current || p.nRev > current.nRev) latestByProp.set(p.codProp, p);
  }

  const result = await prisma.$transaction(async (tx) => {
    // 1) staging 1:1 (upsert por cod_bd)
    for (const p of proposals) {
      const existing = await tx.commercialProposal.findUnique({ where: { codBd: p.codBd } });
      await tx.commercialProposal.upsert({
        where: { codBd: p.codBd },
        create: p,
        update: p
      });
      if (existing) updated += 1; else created += 1;
    }

    // 2) derivação do orçamento da revisão vigente
    for (const proposal of latestByProp.values()) {
      try {
        const { project, created: projCreated } = await ensureProjectForProposal(tx, proposal);
        if (projCreated) pendingProjectsCreated += 1;
        await upsertBudget(tx, project.id, proposal);
      } catch (error) {
        errors.push({ codProp: proposal.codProp, message: error.message });
      }
    }

    return tx.accessImport.create({
      data: {
        fileName,
        contentHash,
        source,
        status: errors.length ? 'PARTIAL' : 'SUCCESS',
        rowsRead: rawRows.length,
        created,
        updated,
        skipped: rawRows.length - proposals.length,
        pendingProjectsCreated,
        error: errors.length ? `${errors.length} proposta(s) com erro` : null,
        summary: { proposals: proposals.length, budgets: latestByProp.size, errors },
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
    budgets: latestByProp.size,
    pendingProjectsCreated,
    errors
  };
}
