import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { isSedeCostCenterCode } from '../acompanhamento/sede-cost-centers.js';

const text = value => value == null ? null : String(value).trim() || null;
const validId = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
const canceled = value => /CANCELAD[OA]|CANCELLED|CANCELED|^C$/i.test(text(value) ?? '');

function parseDate(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const iso = match && `${match[3]}-${match[2]}-${match[1]}`;
  const date = iso && new Date(`${iso}T00:00:00.000Z`);
  if (!date || Number.isNaN(+date) || !date.toISOString().startsWith(iso)) {
    throw new Error('Data inválida no histórico de compras Omie; versão anterior preservada.');
  }
  return date;
}

function purchase(row, linked, categoryNames) {
  if (!validId(row?.codigo_lancamento_omie)) {
    throw new Error('Identificador inválido de contas a pagar Omie; versão anterior preservada.');
  }
  const codigoProjeto = text(row.codigo_projeto);
  const project = linked.get(codigoProjeto);
  if (!project || canceled(row.status_titulo)) return null;
  if (row.valor_documento == null || row.valor_documento === '' || !Number.isFinite(Number(row.valor_documento))) {
    throw new Error('Valor inválido no histórico de compras Omie; versão anterior preservada.');
  }
  const categoriaCodigo = text(row.codigo_categoria);
  return {
    id: randomUUID(), omieId: String(row.codigo_lancamento_omie), codigoProjeto,
    projectId: project.projectId ?? null, osNumber: project.osNumber ?? null,
    valor: Number(row.valor_documento), statusTitulo: text(row.status_titulo), categoriaCodigo,
    categoriaDescricao: categoryNames.get(categoriaCodigo) ?? null,
    fornecedorCodigo: text(row.codigo_cliente_fornecedor), numeroDocumento: text(row.numero_documento),
    numeroDocumentoFiscal: text(row.numero_documento_fiscal), origem: text(row.id_origem),
    dataEmissao: parseDate(row.data_emissao), dataVencimento: parseDate(row.data_vencimento),
    dataPrevisao: parseDate(row.data_previsao),
    linkStatus: project.projectId ? 'LINKED' : isSedeCostCenterCode(project.osNumber ?? codigoProjeto) ? 'SEDE' : 'UNMATCHED',
    rawPayload: row
  };
}

function notFound(error, id) {
  const match = String(error?.body?.faultstring ?? '').match(/Lançamento não cadastrado para o Código \[(\d+)\]/iu);
  return error?.body?.faultcode === 'SOAP-ENV:Client-105' && match?.[1] === String(id);
}

// Uma chamada por vez, com pausa curta e retries limitados. Nenhuma conexão de
// banco fica ocupada durante a leitura da API ou a confirmação dos ausentes.
function reader(call, requestDelayMs) {
  let calls = 0;
  return async (method, params) => {
    for (let attempt = 0; ; attempt++) {
      if (calls++ && requestDelayMs) await sleep(requestDelayMs);
      try {
        return await call('/financas/contapagar/', method, params);
      } catch (error) {
        const retryable = error?.status === 429 || error?.status >= 500 || error?.name === 'TypeError';
        if (notFound(error, params.codigo_lancamento_omie) || !retryable || attempt >= 2) throw error;
        await sleep(500 * (attempt + 1));
      }
    }
  };
}

function pageInfo(response, page) {
  const count = Number(response?.total_de_registros);
  const pageCount = Number(response?.total_de_paginas);
  const rows = response?.conta_pagar_cadastro;
  if (Number(response?.pagina) !== page || response?.total_de_registros == null || response?.total_de_paginas == null
    || !Number.isInteger(pageCount) || pageCount < 0 || !Number.isInteger(count) || count < 0
    || !Array.isArray(rows) || response.registros == null || Number(response.registros) !== rows.length
    || (count === 0 ? pageCount > 1 || rows.length !== 0
      : pageCount === 0 || (rows.length === 0 ? page <= pageCount : pageCount < page))) {
    throw new Error(`Paginação incompleta de ListarContasPagar na página ${page}; versão anterior preservada.`);
  }
  return { count, pageCount, rows };
}

export async function readPurchaseSnapshot({ call, linked, categoryNames, existing, requestDelayMs }) {
  const read = reader(call, requestDelayMs);
  const seen = new Set();
  const current = new Map();
  const summary = { pagesRead: 0, paginationChanges: 0, duplicateRows: 0, canceledIgnored: 0,
    verifiedMissing: 0, recoveredMissing: 0, sourceTotalStart: null, sourceTotalEnd: null };
  let pages = 1;
  let previousPages = null;
  for (let page = 1; page <= pages; page++) {
    const params = {
      pagina: page, registros_por_pagina: 50, apenas_importado_api: 'N',
      ordenar_por: 'CODIGO', ordem_descrescente: 'N'
    };
    let info;
    try {
      info = pageInfo(await read('ListarContasPagar', params), page);
    } catch (error) {
      if (page === 1) throw error;
      // O último conjunto de registros pode ter sido excluído entre chamadas.
      // Só aceite o fim antecipado quando uma nova consulta válida o comprova.
      const latest = pageInfo(await read('ListarContasPagar', { ...params, pagina: 1 }), 1);
      if (latest.pageCount >= page) throw error;
      info = { ...latest, rows: [] };
    }
    const { count, pageCount, rows } = info;
    if (previousPages !== null && (summary.sourceTotalEnd !== count || previousPages !== pageCount)) summary.paginationChanges++;
    summary.sourceTotalStart ??= count;
    summary.sourceTotalEnd = count;
    summary.pagesRead++;
    pages = pageCount;
    previousPages = pageCount;
    for (const row of rows) {
      const data = purchase(row, linked, categoryNames);
      const id = String(row.codigo_lancamento_omie);
      if (seen.has(id)) summary.duplicateRows++;
      seen.add(id);
      if (data) current.set(id, data);
      else {
        current.delete(id);
        if (canceled(row.status_titulo)) summary.canceledIgnored++;
      }
    }
    if (page === 1 || page % 25 === 0 || page >= pages) {
      console.log(`[omie-sync] compras: página ${page}/${pages}, ${seen.size} IDs lidos.`);
    }
  }
  // Sem indícios de movimentação, uma contagem divergente ainda é uma resposta
  // incompleta. Com movimentação, ausências serão verificadas uma a uma abaixo.
  if (!summary.paginationChanges && !summary.duplicateRows && seen.size !== summary.sourceTotalEnd) {
    throw new Error('Contagem incompleta de ListarContasPagar; versão anterior preservada.');
  }
  const removals = [];
  for (const cached of existing) {
    if (current.has(cached.omieId)) continue;
    if (!validId(cached.omieId)) throw new Error('ID local inválido para confirmação Omie; versão anterior preservada.');
    summary.verifiedMissing++;
    try {
      const row = await read('ConsultarContaPagar', { codigo_lancamento_omie: Number(cached.omieId) });
      if (String(row?.codigo_lancamento_omie) !== cached.omieId) {
        throw new Error('Consulta Omie retornou título diferente; versão anterior preservada.');
      }
      const data = purchase(row, linked, categoryNames);
      if (data) { current.set(cached.omieId, data); summary.recoveredMissing++; }
      else removals.push(cached);
    } catch (error) {
      if (!notFound(error, cached.omieId)) throw error;
      removals.push(cached);
    }
    if (summary.verifiedMissing % 25 === 0) {
      console.log(`[omie-sync] compras: ${summary.verifiedMissing} ausentes conferidos individualmente.`);
    }
  }
  return { purchases: [...current.values()], removals, read: seen.size, summary };
}
