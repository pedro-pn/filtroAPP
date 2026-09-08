/*
 * Sincronização Omie: projetos (cache codigo→OS), categorias, compras (contas a pagar)
 * e receitas/faturamento (contas a receber).
 *
 * Ligação (confirmada): ContaPagar.codigo_projeto -> Projeto.codigo (Omie) -> nº da OS no nome
 * do projeto -> Project.code no app. O filtro por codigo_projeto em ListarContasPagar funciona,
 * então as compras são puxadas por projeto (leve).
 */

import env from '../../config/env.js';
import { isSedeCostCenterCode, SEDE_OMIE_CODES } from '../acompanhamento/sede-cost-centers.js';
import { omieCall, omieConfigured } from './client.js';
import prisma from '../prisma.js';

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

function str(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function boolFlag(value) {
  if (value === 'S') return true;
  if (value === 'N') return false;
  return null;
}

function isCanceledStatus(value) {
  return /CANCELAD[OA]|CANCELLED|CANCELED|^C$/i.test(str(value) ?? '');
}

function isCanceledReceivable(record, nfseInfo = null) {
  return isCanceledStatus(record?.status_titulo)
    || isCanceledStatus(record?.cStatusNFSe)
    || isCanceledStatus(record?.Cabecalho?.cStatusNFSe)
    || isCanceledStatus(nfseInfo?.status);
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

async function paginateNfse(baseParam, onPage, label = 'ListarNFSEs') {
  let page = 1;
  let totalPages = 1;
  let read = 0;
  do {
    const json = await omieCall('/servicos/nfse/', 'ListarNFSEs', {
      ...baseParam,
      nPagina: page,
      nRegPorPagina: PAGE_SIZE
    });
    totalPages = json.nTotPaginas || 1;
    const records = json.nfseEncontradas || [];
    read += records.length;
    await onPage(records);
    if (totalPages > 1) {
      console.log(`  [${label}] página ${page}/${totalPages} · lidos ${read}`);
    }
    page += 1;
  } while (page <= totalPages);
  return read;
}

function addUnique(map, key, info) {
  const normalized = str(key);
  if (!normalized) return;
  if (!map.has(normalized)) {
    map.set(normalized, info);
    return;
  }
  if (map.get(normalized) !== info) map.set(normalized, null);
}

function extractNfseTaxInfo(nfse) {
  const services = Array.isArray(nfse?.ListaServicos)
    ? nfse.ListaServicos
    : (nfse?.Servicos && typeof nfse.Servicos === 'object' ? [nfse.Servicos] : []);
  const serviceWithCode = services.find(s => str(s?.CodigoLC116) || str(s?.CodigoServico)) ?? null;
  const serviceWithRate = services.find(s => num(s?.nAliquotaISS) !== null) ?? null;
  const values = nfse?.Valores && typeof nfse.Valores === 'object' ? nfse.Valores : {};

  let weightedRate = 0;
  let weightedAmount = 0;
  for (const service of services) {
    const rate = num(service?.nAliquotaISS);
    if (rate === null) continue;
    const amount = num(service?.nValorServico) ?? num(service?.nValorTotal) ?? 1;
    const weight = amount > 0 ? amount : 1;
    weightedRate += rate * weight;
    weightedAmount += weight;
  }

  return {
    codigoLc116: str(serviceWithCode?.CodigoLC116),
    codigoServico: str(serviceWithCode?.CodigoServico),
    status: str(nfse?.Cabecalho?.cStatusNFSe),
    aliquotaIss: weightedAmount > 0 ? weightedRate / weightedAmount : (num(values.nAliquotaISS) ?? num(serviceWithRate?.nAliquotaISS)),
    valorIss: num(values.nValorISS) ?? num(serviceWithRate?.nValorISS)
  };
}

async function fetchOmieNfseTaxLookup() {
  const lookup = { byFiscalNumber: new Map(), byOs: new Map(), byRps: new Map(), recordsRead: 0 };
  const read = await paginateNfse({ cExibirDescricao: 'S' }, async (records) => {
    for (const nfse of records) {
      const info = extractNfseTaxInfo(nfse);
      addUnique(lookup.byFiscalNumber, nfse?.Cabecalho?.nNumeroNFSe, info);
      addUnique(lookup.byOs, nfse?.OrdemServico?.nCodigoOS, info);
      addUnique(lookup.byRps, nfse?.RPS?.nNumeroRPS, info);
    }
  });
  lookup.recordsRead = read;
  return lookup;
}

function findNfseTaxInfo(receivable, lookup) {
  if (!lookup) return null;

  const fiscalMatch = lookup.byFiscalNumber.get(str(receivable.numero_documento_fiscal));
  if (fiscalMatch) return fiscalMatch;

  const osMatch = lookup.byOs.get(str(receivable.nCodOS));
  if (osMatch) return osMatch;

  const rpsNumber = str(receivable.numero_documento)?.match(/\d+/)?.[0] ?? null;
  const rpsMatch = lookup.byRps.get(rpsNumber);
  return rpsMatch || null;
}

export async function syncOmieProjects({ triggeredBy = 'SCRIPT' } = {}) {
  const run = await startRun('projects', triggeredBy);
  try {
    // Mapa OS -> projectId do app (resolve o vínculo).
    const [projects, cachedProjects] = await Promise.all([
      prisma.project.findMany({ where: { deletedAt: null }, select: { id: true, code: true } }),
      prisma.omieProject.findMany({ select: { codigo: true, projectId: true } })
    ]);
    const projectByCode = new Map(projects.map(p => [String(p.code).trim(), p.id]));
    const cachedByCodigo = new Map(cachedProjects.map(project => [project.codigo, project]));

    let written = 0;
    let matched = 0;
    let linksChanged = 0;
    const read = await paginate('/geral/projetos/', 'ListarProjetos', {}, 'cadastro', async (records) => {
      for (const r of records) {
        const codigo = String(r.codigo);
        const osNumber = osNumberFromName(r.nome);
        const projectId = osNumber ? projectByCode.get(osNumber) ?? null : null;
        if (projectId) matched += 1;
        const data = { codigo, osNumber, nome: r.nome ?? null, inativo: r.inativo === 'S', projectId, syncedAt: new Date() };
        const cachedProject = cachedByCodigo.get(codigo);
        const linkChanged = cachedProject ? cachedProject.projectId !== projectId : Boolean(projectId);
        if (linkChanged) linksChanged += 1;
        await prisma.omieProject.upsert({
          where: { codigo },
          create: { ...data, purchasesBackfilledAt: null },
          update: {
            ...data,
            ...(linkChanged ? { purchasesBackfilledAt: null } : {})
          }
        });
        written += 1;
      }
    });

    await finishRun(run.id, 'SUCCESS', { recordsRead: read, recordsWritten: written, summary: { matched, linksChanged } });
    return { read, written, matched, linksChanged };
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

function omieProjectFilterValue(codigo) {
  const value = Number(codigo);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Código de projeto Omie inválido para backfill: ${codigo}`);
  }
  return value;
}

function isInactiveOmieProjectFilterError(error) {
  const message = String(error?.body?.faultstring || error?.message || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return message.includes('projeto esta inativo') && message.includes('filtrar_por_projeto');
}

// Compras (contas a pagar) dos projetos do Omie que casam com um Project do app.
// Projetos ainda sem histórico completo são consultados diretamente por filtrar_por_projeto.
// Depois do backfill, sinceDays > 0 mantém os títulos atualizados pela data de alteração.
export async function syncOmiePurchases({ triggeredBy = 'SCRIPT', sinceDays = null } = {}) {
  const run = await startRun('purchases', triggeredBy);
  try {
    const categories = await prisma.omieCategory.findMany({ select: { codigo: true, descricao: true } });
    const categoryName = new Map(categories.map(c => [c.codigo, c.descricao]));

    const linked = await prisma.omieProject.findMany({
      where: {
        OR: [
          { projectId: { not: null } },
          { osNumber: { in: SEDE_OMIE_CODES } },
          { codigo: { in: SEDE_OMIE_CODES } }
        ]
      },
      select: { codigo: true, osNumber: true, projectId: true, inativo: true, purchasesBackfilledAt: true }
    });
    const linkedByCodigo = new Map(linked.map(op => [op.codigo, op]));
    for (const codigo of SEDE_OMIE_CODES) {
      if (!linkedByCodigo.has(codigo)) linkedByCodigo.set(codigo, { codigo, osNumber: codigo, projectId: null });
    }
    if (linkedByCodigo.size === 0) {
      await finishRun(run.id, 'SUCCESS', { recordsRead: 0, recordsWritten: 0, summary: { note: 'Nenhum projeto Omie vinculado; rode omie:sync projetos.' } });
      return { read: 0, written: 0, projects: 0 };
    }

    let written = 0;
    const upsertRecords = async (records) => {
      for (const r of records) {
        const codigoProjeto = r.codigo_projeto != null ? String(r.codigo_projeto) : null;
        const op = codigoProjeto ? linkedByCodigo.get(codigoProjeto) : null;
        if (!op) continue; // só títulos de projetos do app ou centros fixos da Sede
        const omieId = String(r.codigo_lancamento_omie);
        const categoriaCodigo = r.codigo_categoria ?? null;
        const data = {
          omieId,
          codigoProjeto,
          projectId: op.projectId ?? null,
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
          linkStatus: op.projectId ? 'LINKED' : isSedeCostCenterCode(op.osNumber ?? codigoProjeto) ? 'SEDE' : 'UNMATCHED',
          rawPayload: r,
          syncedAt: new Date()
        };
        // eslint-disable-next-line no-await-in-loop
        await prisma.omiePurchase.upsert({ where: { omieId }, create: data, update: data });
        written += 1;
      }
    };

    const incremental = Boolean(sinceDays && Number(sinceDays) > 0);
    const pendingBackfills = linked.filter(project => project.projectId && !project.purchasesBackfilledAt);
    const targetedPendingBackfills = pendingBackfills.filter(project => !project.inativo);
    let historicalBackfillProjects = 0;
    let historicalBackfillRead = 0;
    let historicalBackfillWritten = 0;
    let historicalBackfillSkippedInactiveProjects = incremental
      ? pendingBackfills.length - targetedPendingBackfills.length
      : 0;

    if (incremental) {
      for (const project of targetedPendingBackfills) {
        const writtenBefore = written;
        let projectRead;
        try {
          projectRead = await paginate(
            '/financas/contapagar/',
            'ListarContasPagar',
            {
              apenas_importado_api: 'N',
              filtrar_por_projeto: omieProjectFilterValue(project.codigo)
            },
            'conta_pagar_cadastro',
            upsertRecords,
            `ListarContasPagar projeto ${project.osNumber ?? project.codigo}`
          );
        } catch (error) {
          if (!isInactiveOmieProjectFilterError(error)) throw error;
          historicalBackfillSkippedInactiveProjects += 1;
          console.warn(`[omie-sync] backfill de compras ignorado para projeto inativo ${project.osNumber ?? project.codigo}`);
          continue;
        }
        await prisma.omieProject.updateMany({
          where: { codigo: project.codigo, projectId: project.projectId },
          data: { purchasesBackfilledAt: new Date() }
        });
        historicalBackfillProjects += 1;
        historicalBackfillRead += projectRead;
        historicalBackfillWritten += written - writtenBefore;
      }
    }

    const baseParam = { apenas_importado_api: 'N' };
    if (incremental) {
      baseParam.filtrar_apenas_alteracao = 'S';
      baseParam.filtrar_por_data_de = omieDateStr(new Date(Date.now() - Number(sinceDays) * 86400000));
    }

    const regularRead = await paginate(
      '/financas/contapagar/',
      'ListarContasPagar',
      baseParam,
      'conta_pagar_cadastro',
      upsertRecords
    );

    if (!incremental) {
      for (const project of pendingBackfills) {
        await prisma.omieProject.updateMany({
          where: { codigo: project.codigo, projectId: project.projectId },
          data: { purchasesBackfilledAt: new Date() }
        });
        historicalBackfillProjects += 1;
      }
    }

    const tracked = [...linkedByCodigo.values()];
    const linkedProjects = tracked.filter(op => op.projectId).length;
    const sedeCenters = tracked.filter(op => !op.projectId && isSedeCostCenterCode(op.osNumber ?? op.codigo)).length;
    const read = historicalBackfillRead + regularRead;
    await finishRun(run.id, 'SUCCESS', {
      recordsRead: read,
      recordsWritten: written,
      summary: {
        linkedProjects,
        sedeCenters,
        incremental,
        historicalBackfillProjects,
        historicalBackfillRead,
        historicalBackfillWritten,
        historicalBackfillSkippedInactiveProjects,
        historicalBackfillMode: incremental ? 'TARGETED' : 'FULL_SCAN'
      }
    });
    return {
      read,
      written,
      projects: linkedProjects,
      sedeCenters,
      historicalBackfillProjects,
      historicalBackfillRead,
      historicalBackfillWritten,
      historicalBackfillSkippedInactiveProjects
    };
  } catch (error) {
    await finishRun(run.id, 'ERROR', { error: error.message });
    throw error;
  }
}

// Receitas/faturamento dos projetos do Omie que casam com um Project do app.
// Usado no acompanhamento para trocar a base prevista pela venda realmente faturada no Omie.
export async function syncOmieReceivables({ triggeredBy = 'SCRIPT', sinceDays = null } = {}) {
  const run = await startRun('receivables', triggeredBy);
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

    let nfseLookup = null;
    let nfseLookupError = null;
    try {
      nfseLookup = await fetchOmieNfseTaxLookup();
    } catch (error) {
      nfseLookupError = error.message;
      console.warn(`[omie] ListarNFSEs indisponível; receitas serão sincronizadas sem código/ISS da NFSe: ${error.message}`);
    }

    let written = 0;
    let canceledIgnored = 0;
    let nfseMatched = 0;
    const read = await paginate('/financas/contareceber/', 'ListarContasReceber', baseParam, 'conta_receber_cadastro', async (records) => {
      for (const r of records) {
        const codigoProjeto = r.codigo_projeto != null ? String(r.codigo_projeto) : null;
        const op = codigoProjeto ? linkedByCodigo.get(codigoProjeto) : null;
        if (!op) continue;
        const omieId = String(r.codigo_lancamento_omie);
        const categoriaCodigo = r.codigo_categoria ?? null;
        const nfseInfo = findNfseTaxInfo(r, nfseLookup);
        if (nfseInfo) nfseMatched += 1;
        if (isCanceledReceivable(r, nfseInfo)) {
          await prisma.omieReceivable.deleteMany({ where: { omieId } });
          canceledIgnored += 1;
          continue;
        }
        const data = {
          omieId,
          codigoProjeto,
          projectId: op.projectId ?? null,
          osNumber: op.osNumber,
          valor: num(r.valor_documento),
          valorIss: num(r.valor_iss) ?? nfseInfo?.valorIss ?? null,
          statusTitulo: r.status_titulo ?? null,
          categoriaCodigo,
          categoriaDescricao: categoriaCodigo ? categoryName.get(categoriaCodigo) ?? null : null,
          clienteCodigo: r.codigo_cliente_fornecedor ? String(r.codigo_cliente_fornecedor) : null,
          numeroDocumento: r.numero_documento ?? null,
          numeroDocumentoFiscal: r.numero_documento_fiscal ?? null,
          numeroPedido: r.numero_pedido ?? null,
          codigoTipoDocumento: r.codigo_tipo_documento ?? null,
          origem: r.id_origem ?? null,
          dataEmissao: parseOmieDate(r.data_emissao),
          dataVencimento: parseOmieDate(r.data_vencimento),
          dataPrevisao: parseOmieDate(r.data_previsao),
          dataRegistro: parseOmieDate(r.data_registro),
          retemIss: boolFlag(r.retem_iss),
          retemPis: boolFlag(r.retem_pis),
          retemCofins: boolFlag(r.retem_cofins),
          retemCsll: boolFlag(r.retem_csll),
          retemIr: boolFlag(r.retem_ir),
          rawPayload: r,
          syncedAt: new Date()
        };
        if (nfseLookup) {
          data.aliquotaIss = nfseInfo?.aliquotaIss ?? null;
          data.codigoLc116 = nfseInfo?.codigoLc116 ?? null;
          data.codigoServico = nfseInfo?.codigoServico ?? null;
        }
        // eslint-disable-next-line no-await-in-loop
        await prisma.omieReceivable.upsert({ where: { omieId }, create: data, update: data });
        written += 1;
      }
    });

    await finishRun(run.id, 'SUCCESS', {
      recordsRead: read,
      recordsWritten: written,
      summary: {
        linkedProjects: linkedByCodigo.size,
        incremental: Boolean(sinceDays),
        nfseRead: nfseLookup?.recordsRead ?? 0,
        nfseMatched,
        canceledIgnored,
        nfseLookupError
      }
    });
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
  const receivables = await syncOmieReceivables({ triggeredBy, sinceDays });
  return { projects, categories, purchases, receivables };
}

// === Job agendado (in-process, padrão do app) ===
// Atualiza projetos/categorias, conclui o histórico dos vínculos ainda pendentes por projeto
// e mantém compras/receitas atualizadas pela janela incremental de N dias.
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

  console.log(`[omie-sync] agendado a cada ${intervalMinutes} min (históricos pendentes por projeto + incrementais ${sinceDays}d).`);
}
