/*
 * Sincronização Omie: projetos (cache codigo→OS), categorias e compras (contas a pagar).
 *
 * Ligação (confirmada): ContaPagar.codigo_projeto -> Projeto.codigo (Omie) -> nº da OS no nome
 * do projeto -> Project.code no app. O filtro por codigo_projeto em ListarContasPagar funciona,
 * então as compras são puxadas por projeto (leve).
 */

import env from '../config/env.js';
import { omieCall, omieConfigured } from './omie-client.js';
import prisma from './prisma.js';

const PAGE_SIZE = 500;

function parseOmieDate(value) {
  const m = String(value || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]))) : null;
}

function omieDateStr(date) {
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${date.getUTCFullYear()}`;
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
// Loga o progresso (útil em listagens grandes como contas a pagar).
async function paginate(path, call, baseParam, recordsKey, onPage, label = call) {
  let page = 1;
  let totalPages = 1;
  let read = 0;
  do {
    const json = await omieCall(path, call, { ...baseParam, pagina: page, registros_por_pagina: PAGE_SIZE });
    totalPages = json.total_de_paginas || 1;
    const records = json[recordsKey] || [];
    read += records.length;
    await onPage(records);
    if (totalPages > 1) {
      console.log(`  [${label}] página ${page}/${totalPages} · lidos ${read}`);
    }
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
    let matched = 0;
    const read = await paginate('/geral/projetos/', 'ListarProjetos', {}, 'cadastro', async (records) => {
      for (const r of records) {
        const codigo = String(r.codigo);
        const osNumber = osNumberFromName(r.nome);
        const projectId = osNumber ? projectByCode.get(osNumber) ?? null : null;
        if (projectId) matched += 1;
        const data = { codigo, osNumber, nome: r.nome ?? null, inativo: r.inativo === 'S', projectId, syncedAt: new Date() };
        await prisma.omieProject.upsert({ where: { codigo }, create: data, update: data });
        written += 1;
      }
    });

    await finishRun(run.id, 'SUCCESS', { recordsRead: read, recordsWritten: written, summary: { matched } });
    return { read, written, matched };
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
// ListarContasPagar NÃO aceita filtro por codigo_projeto, então varremos as páginas e filtramos
// no app pelos projetos vinculados. sinceDays > 0 usa filtro incremental por data de alteração.
export async function syncOmiePurchases({ triggeredBy = 'SCRIPT', sinceDays = null } = {}) {
  const run = await startRun('purchases', triggeredBy);
  try {
    const categories = await prisma.omieCategory.findMany({ select: { codigo: true, descricao: true } });
    const categoryName = new Map(categories.map(c => [c.codigo, c.descricao]));

    const linked = await prisma.omieProject.findMany({
      where: { projectId: { not: null } },
      select: { codigo: true, osNumber: true, projectId: true }
    });
    const linkedByCodigo = new Map(linked.map(op => [op.codigo, op]));
    if (linkedByCodigo.size === 0) {
      await finishRun(run.id, 'SUCCESS', { recordsRead: 0, recordsWritten: 0, summary: { note: 'Nenhum projeto Omie vinculado; rode omie:sync projetos.' } });
      return { read: 0, written: 0, projects: 0 };
    }

    const baseParam = { apenas_importado_api: 'N' };
    if (sinceDays && Number(sinceDays) > 0) {
      baseParam.filtrar_apenas_alteracao = 'S';
      baseParam.filtrar_por_data_de = omieDateStr(new Date(Date.now() - Number(sinceDays) * 86400000));
    }

    let written = 0;
    const read = await paginate('/financas/contapagar/', 'ListarContasPagar', baseParam, 'conta_pagar_cadastro', async (records) => {
      for (const r of records) {
        const codigoProjeto = r.codigo_projeto != null ? String(r.codigo_projeto) : null;
        const op = codigoProjeto ? linkedByCodigo.get(codigoProjeto) : null;
        if (!op) continue; // só títulos de projetos que existem no app
        const omieId = String(r.codigo_lancamento_omie);
        const categoriaCodigo = r.codigo_categoria ?? null;
        const data = {
          omieId,
          codigoProjeto,
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
        // eslint-disable-next-line no-await-in-loop
        await prisma.omiePurchase.upsert({ where: { omieId }, create: data, update: data });
        written += 1;
      }
    });

    await finishRun(run.id, 'SUCCESS', { recordsRead: read, recordsWritten: written, summary: { linkedProjects: linkedByCodigo.size, incremental: Boolean(sinceDays) } });
    return { read, written, projects: linkedByCodigo.size };
  } catch (error) {
    await finishRun(run.id, 'ERROR', { error: error.message });
    throw error;
  }
}

export async function syncOmieAll({ triggeredBy = 'SCRIPT', sinceDays = null } = {}) {
  const projects = await syncOmieProjects({ triggeredBy });
  const categories = await syncOmieCategories({ triggeredBy });
  const purchases = await syncOmiePurchases({ triggeredBy, sinceDays });
  return { projects, categories, purchases };
}

// === Job agendado (in-process, padrão do app) ===
// Atualiza projetos/categorias e puxa as compras incrementais (janela de N dias). O backfill
// completo continua sendo manual (npm run omie:sync compras, sem janela).
let omieJobRunning = false;

export function startOmieSyncJob() {
  if (!env.omieSyncEnabled) {
    console.log('[omie-sync] job desabilitado (OMIE_SYNC_ENABLED=false).');
    return;
  }
  if (!omieConfigured()) {
    console.warn('[omie-sync] OMIE_APP_KEY/OMIE_APP_SECRET ausentes; job não iniciado.');
    return;
  }

  const intervalMinutes = Number.isFinite(env.omieSyncIntervalMinutes) && env.omieSyncIntervalMinutes >= 5 ? env.omieSyncIntervalMinutes : 360;
  const sinceDays = Number.isFinite(env.omieSyncSinceDays) && env.omieSyncSinceDays > 0 ? env.omieSyncSinceDays : 7;
  const intervalMs = intervalMinutes * 60 * 1000;

  const run = async () => {
    if (omieJobRunning) {
      console.warn('[omie-sync] ciclo anterior ainda em execução; pulando.');
      return;
    }
    omieJobRunning = true;
    try {
      const result = await syncOmieAll({ triggeredBy: 'SCHEDULE', sinceDays });
      console.log('[omie-sync] ciclo concluído:', JSON.stringify(result));
    } catch (error) {
      console.error('[omie-sync] falha no ciclo:', error.message);
    } finally {
      omieJobRunning = false;
    }
  };

  const timer = setInterval(run, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  // primeiro ciclo logo após o boot (não bloqueia a inicialização)
  const kickoff = setTimeout(run, 60 * 1000);
  if (typeof kickoff.unref === 'function') kickoff.unref();

  console.log(`[omie-sync] agendado a cada ${intervalMinutes} min (compras incrementais ${sinceDays}d).`);
}
