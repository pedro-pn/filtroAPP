/*
 * Sincronização Omie: projetos (cache codigo→OS), categorias e compras (contas a pagar).
 *
 * Ligação (confirmada): ContaPagar.codigo_projeto -> Projeto.codigo (Omie) -> nº da OS no nome
 * do projeto -> Project.code no app. O filtro por codigo_projeto em ListarContasPagar funciona,
 * então as compras são puxadas por projeto (leve).
 */

import { omieCall } from './omie-client.js';
import prisma from './prisma.js';

const PAGE_SIZE = 200;

function parseOmieDate(value) {
  const m = String(value || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]))) : null;
}

// "OS 5316 - IKM Testing" -> "5316" (primeiro grupo de 3+ dígitos no nome).
export function osNumberFromName(nome) {
  const m = String(nome || '').match(/\d{3,}/);
  return m ? m[0] : null;
}

function num(value) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

async function startRun(scope, triggeredBy) {
  return prisma.integrationSyncRun.create({
    data: { integration: 'OMIE', scope, status: 'RUNNING', triggeredBy }
  });
}
async function finishRun(id, status, data = {}) {
  return prisma.integrationSyncRun.update({
    where: { id },
    data: { status, finishedAt: new Date(), ...data }
  });
}

// Itera todas as páginas de um Listar, chamando onPage(records) por página.
async function paginate(path, call, baseParam, recordsKey, onPage) {
  let page = 1;
  let totalPages = 1;
  let read = 0;
  do {
    const json = await omieCall(path, call, { ...baseParam, pagina: page, registros_por_pagina: PAGE_SIZE });
    totalPages = json.total_de_paginas || 1;
    const records = json[recordsKey] || [];
    read += records.length;
    await onPage(records);
    page += 1;
  } while (page <= totalPages);
  return read;
}

export async function syncOmieProjects({ triggeredBy = 'SCRIPT' } = {}) {
  const run = await startRun('projects', triggeredBy);
  try {
    // Mapa OS -> projectId do app (resolve o vínculo).
    const projects = await prisma.project.findMany({ where: { deletedAt: null }, select: { id: true, code: true } });
    const projectByCode = new Map(projects.map(p => [String(p.code).trim(), p.id]));

    let written = 0;
    const read = await paginate('/geral/projetos/', 'ListarProjetos', {}, 'cadastro', async (records) => {
      for (const r of records) {
        const codigo = String(r.codigo);
        const osNumber = osNumberFromName(r.nome);
        const projectId = osNumber ? projectByCode.get(osNumber) ?? null : null;
        const data = { codigo, osNumber, nome: r.nome ?? null, inativo: r.inativo === 'S', projectId, syncedAt: new Date() };
        await prisma.omieProject.upsert({ where: { codigo }, create: data, update: data });
        written += 1;
      }
    });

    await finishRun(run.id, 'SUCCESS', { recordsRead: read, recordsWritten: written });
    return { read, written };
  } catch (error) {
    await finishRun(run.id, 'ERROR', { error: error.message });
    throw error;
  }
}

export async function syncOmieCategories({ triggeredBy = 'SCRIPT' } = {}) {
  const run = await startRun('categories', triggeredBy);
  try {
    let written = 0;
    const read = await paginate('/geral/categorias/', 'ListarCategorias', {}, 'categoria_cadastro', async (records) => {
      for (const r of records) {
        const codigo = String(r.codigo);
        const data = { codigo, descricao: r.descricao ?? r.descricao_padrao ?? null, syncedAt: new Date() };
        await prisma.omieCategory.upsert({ where: { codigo }, create: data, update: data });
        written += 1;
      }
    });
    await finishRun(run.id, 'SUCCESS', { recordsRead: read, recordsWritten: written });
    return { read, written };
  } catch (error) {
    await finishRun(run.id, 'ERROR', { error: error.message });
    throw error;
  }
}

// Compras (contas a pagar) dos projetos do Omie que casam com um Project do app.
export async function syncOmiePurchases({ triggeredBy = 'SCRIPT' } = {}) {
  const run = await startRun('purchases', triggeredBy);
  try {
    const categories = await prisma.omieCategory.findMany({ select: { codigo: true, descricao: true } });
    const categoryName = new Map(categories.map(c => [c.codigo, c.descricao]));

    const linked = await prisma.omieProject.findMany({
      where: { projectId: { not: null } },
      select: { codigo: true, osNumber: true, projectId: true }
    });

    let read = 0;
    let written = 0;
    for (const op of linked) {
      // eslint-disable-next-line no-await-in-loop
      read += await paginate('/financas/contapagar/', 'ListarContasPagar', { codigo_projeto: Number(op.codigo) }, 'conta_pagar_cadastro', async (records) => {
        for (const r of records) {
          const omieId = String(r.codigo_lancamento_omie);
          const categoriaCodigo = r.codigo_categoria ?? null;
          const data = {
            omieId,
            codigoProjeto: op.codigo,
            projectId: op.projectId,
            osNumber: op.osNumber,
            valor: num(r.valor_documento),
            statusTitulo: r.status_titulo ?? null,
            categoriaCodigo,
            categoriaDescricao: categoriaCodigo ? categoryName.get(categoriaCodigo) ?? null : null,
            fornecedorCodigo: r.codigo_cliente_fornecedor ? String(r.codigo_cliente_fornecedor) : null,
            numeroDocumento: r.numero_documento ?? null,
            numeroDocumentoFiscal: r.numero_documento_fiscal ?? null,
            origem: r.id_origem ?? null,
            dataEmissao: parseOmieDate(r.data_emissao),
            dataVencimento: parseOmieDate(r.data_vencimento),
            dataPrevisao: parseOmieDate(r.data_previsao),
            linkStatus: 'LINKED',
            rawPayload: r,
            syncedAt: new Date()
          };
          await prisma.omiePurchase.upsert({ where: { omieId }, create: data, update: data });
          written += 1;
        }
      });
    }

    await finishRun(run.id, 'SUCCESS', { recordsRead: read, recordsWritten: written, summary: { projects: linked.length } });
    return { read, written, projects: linked.length };
  } catch (error) {
    await finishRun(run.id, 'ERROR', { error: error.message });
    throw error;
  }
}

export async function syncOmieAll({ triggeredBy = 'SCRIPT' } = {}) {
  const projects = await syncOmieProjects({ triggeredBy });
  const categories = await syncOmieCategories({ triggeredBy });
  const purchases = await syncOmiePurchases({ triggeredBy });
  return { projects, categories, purchases };
}
