import { randomUUID } from 'node:crypto';
import { isSedeCostCenterCode } from '../acompanhamento/sede-cost-centers.js';
import { createOmiePurchaseReader, isMissingOmiePage } from './purchase-reader.js';
import { createPurchaseCoverage, resolvePurchaseGaps } from './purchase-coverage.js';

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
  return { count, pageCount, rows, page };
}

export async function readPurchaseSnapshot({ call, linked, categoryNames, existing, requestDelayMs, wait, now }) {
  const { read, stats } = createOmiePurchaseReader({ call, requestDelayMs, wait, now });
  const coverage = createPurchaseCoverage();
  const seen = coverage.seen;
  const current = new Map();
  const summary = { pagesRead: 0, paginationChanges: 0, duplicateRows: 0, canceledIgnored: 0,
    verifiedMissing: 0, recoveredMissing: 0, overlapPagesRead: 0, sourceTotalStart: null, sourceTotalEnd: null };
  let pages = 1;
  let previousPages = null;
  const loadPage = async (page, size) => {
    const params = {
      pagina: page, registros_por_pagina: size, apenas_importado_api: 'N',
      ordenar_por: 'CODIGO', ordem_descrescente: 'N'
    };
    let info;
    try {
      info = pageInfo(await read('ListarContasPagar', params), page);
    } catch (error) {
      if (page === 1 || !isMissingOmiePage(error)) throw error;
      // O último conjunto de registros pode ter sido excluído entre chamadas.
      // Só aceite o fim antecipado quando uma nova consulta válida o comprova.
      const latest = pageInfo(await read('ListarContasPagar', { ...params, pagina: 1 }), 1);
      if (latest.pageCount >= page) throw error;
      info = latest;
    }
    return info;
  };
  const consume = (info, overlap = false) => {
    for (const row of info.rows) {
      const data = purchase(row, linked, categoryNames);
      const id = String(row.codigo_lancamento_omie);
      if (!overlap && seen.has(id)) summary.duplicateRows++;
      if (data) current.set(id, data);
      else {
        current.delete(id);
        if (!overlap && canceled(row.status_titulo)) summary.canceledIgnored++;
      }
    }
    coverage.observe(info);
  };
  for (let page = 1; page <= pages; page++) {
    const info = await loadPage(page, 100);
    const { count, pageCount } = info;
    if (previousPages !== null && (summary.sourceTotalEnd !== count || previousPages !== pageCount)) summary.paginationChanges++;
    summary.sourceTotalStart ??= count;
    summary.sourceTotalEnd = count;
    summary.pagesRead++;
    pages = pageCount;
    previousPages = pageCount;
    consume(info);
    if (page === 1 || page % 25 === 0 || page >= pages) {
      console.log(`[omie-sync] compras: página ${page}/${pages}, ${seen.size} IDs lidos.`);
    }
  }
  // Sem indícios de movimentação, uma contagem divergente continua inválida.
  if (!summary.paginationChanges && !summary.duplicateRows && seen.size !== summary.sourceTotalEnd) {
    throw new Error('Contagem incompleta de ListarContasPagar; versão anterior preservada.');
  }
  const removals = await resolvePurchaseGaps({ existing, current, coverage, total: summary.sourceTotalEnd,
    loadPage, consume, summary });
  console.log(`[omie-sync] compras: ${summary.verifiedMissing} ausentes conferidos por listagens, ${summary.overlapPagesRead} páginas sobrepostas.`);
  return { purchases: [...current.values()], removals, read: seen.size, summary: { ...summary, ...stats } };
}
