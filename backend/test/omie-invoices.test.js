import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildInvoiceSnapshot, syncOmieInvoices } from '../src/lib/omie/invoices.js';

const invoice = (header = {}, extra = {}) => ({
  Cabecalho: { nCodNF: 10, nNumeroNFSe: '10', nValorNFSe: 1000, cStatusNFSe: 'F', cAmbienteNFSe: 'P', nCodigoCliente: 20, ...header },
  Adicionais: { nCodigoProjeto: 30 }, Emissao: { cDataEmissao: '03/07/2026' }, OrdemServico: { nCodigoOS: 40 }, ...extra
});
const title = (extra = {}) => ({
  codigo_lancamento_omie: 1, codigo_projeto: 30, codigo_cliente_fornecedor: 20,
  numero_documento_fiscal: '10', codigo_tipo_documento: 'NFS', nCodOS: 40,
  valor_documento: 1000, status_titulo: 'RECEBIDO', ...extra
});
const snapshot = (nfse, receivables = [], nfe = []) => buildInvoiceSnapshot({ nfse, receivables, nfe });

test('nota parcelada é contada uma vez, com valor bruto e data fiscal preservados', () => {
  const rows = snapshot([invoice()], [title({ valor_documento: 400 }), title({ codigo_lancamento_omie: 2, valor_documento: 600 })]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].valor, 1000);
  assert.equal(rows[0].installmentCount, 2);
  assert.equal(rows[0].receiptStatus, 'RECEIVED');
  assert.equal(rows[0].dataEmissao.toISOString(), '2026-07-03T00:00:00.000Z');
});

test('canceladas, não faturadas, homologação e notas de débito não confirmam faturamento', () => {
  const rows = snapshot([
    invoice({ cStatusNFSe: 'C' }), invoice({ cStatusNFSe: 'N' }), invoice({ cAmbienteNFSe: 'H' }), invoice()
  ], [title({ codigo_tipo_documento: 'ND' }), title({ codigo_lancamento_omie: 2, status_titulo: 'CANCELADO' })]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].receiptStatus, 'UNKNOWN');
});

test('histórico fiscal antigo independe da presença no espelho incremental', () => {
  const rows = snapshot([invoice({}, { Emissao: { cDataEmissao: '04/09/2025' } })]);
  assert.equal(rows[0].numero, '10');
  assert.equal(rows[0].receiptStatus, 'UNKNOWN');
  assert.equal(rows[0].valor, 1000);
});

test('distingue recebido, parcial, vencimento do dia, atraso e cobertura incompleta', () => {
  assert.equal(snapshot([invoice()], [title({ valor_documento: 500 })])[0].receiptStatus, 'PARTIAL');
  assert.equal(snapshot([invoice()], [title({ valor_documento: 500 }), title({ codigo_lancamento_omie: 2, valor_documento: 500, status_titulo: 'A VENCER' })])[0].receiptStatus, 'PARTIAL');
  assert.equal(snapshot([invoice()], [title({ status_titulo: 'VENCE HOJE' })])[0].receiptStatus, 'OPEN');
  assert.equal(snapshot([invoice()], [title({ status_titulo: 'ATRASADO' })])[0].receiptStatus, 'OVERDUE');
});

test('número fiscal de outro cliente ou projeto não comprova recebimento', () => {
  assert.equal(snapshot([invoice()], [title({ codigo_cliente_fornecedor: 99 }), title({ codigo_lancamento_omie: 2, codigo_projeto: 99 })])[0].receiptStatus, 'UNKNOWN');
  assert.equal(snapshot([invoice()], [title({ numero_documento_fiscal: '11' })])[0].receiptStatus, 'UNKNOWN');
});

test('mesmo número em séries diferentes exige identificação inequívoca do título', () => {
  const rows = snapshot([invoice({ cSerieNFSe: 'A' }), invoice({ nCodNF: 11, cSerieNFSe: 'B' }, { OrdemServico: { nCodigoOS: 41 } })], [title({ nCodOS: undefined })]);
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.receiptStatus === 'UNKNOWN'));
});

test('identificador da nota e do título eliminam duplicidade no retorno', () => {
  const rows = snapshot([invoice(), invoice()], [title(), title()]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].installmentCount, 1);
  assert.equal(rows[0].receiptStatus, 'RECEIVED');
});

test('NF-e de venda entra; remessa, cancelamento, denegação e homologação ficam fora', () => {
  const sale = {
    ide: { tpNF: '1', tpAmb: '1', nNF: '00002389', dEmi: '28/01/2026', serie: '2', cDeneg: 'N' },
    pedido: { opPedido: '11', nIdProjeto: 30 }, compl: { nIdNF: 50 },
    total: { ICMSTot: { vNF: 150 } }, nfDestInt: { nCodCli: 20 }, titulos: [{ nCodTitulo: 1 }]
  };
  const rows = snapshot([], [title({ codigo_tipo_documento: 'NFE', numero_documento_fiscal: '2389', valor_documento: 150 })], [
    sale, { ...sale, pedido: { ...sale.pedido, opPedido: '14' } },
    ...[{ dCan: '29/01/2026' }, { dInut: '29/01/2026' }, { cDeneg: 'S' }, { tpAmb: '2' }, { tpNF: '0' }]
      .map(change => ({ ...sale, ide: { ...sale.ide, ...change } }))
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'NFE:50');
  assert.equal(rows[0].numero, '00002389');
  assert.equal(rows[0].receiptStatus, 'RECEIVED');
});

function database() {
  const events = [];
  const db = {
    integrationSyncRun: {
      create: async () => ({ id: 'run' }),
      update: async args => { events.push(args.data.status); }
    },
    omieInvoice: {
      deleteMany: async () => { events.push('delete'); },
      createMany: async args => { events.push(args.data); }
    },
    $transaction: async fn => { events.push('transaction'); return fn(db); }
  };
  return { db, events };
}

test('sincronização lê todas as páginas antes de substituir o histórico e não usa filtro incremental', async () => {
  const { db, events } = database();
  const calls = [];
  const call = async (_path, method, params) => {
    calls.push({ method, params });
    assert.ok(!events.includes('delete'));
    if (method === 'ListarNFSEs') return { nTotPaginas: 2, nTotRegistros: 2, nfseEncontradas: [invoice({ nCodNF: params.nPagina, nNumeroNFSe: String(params.nPagina) })] };
    if (method === 'ListarNF') return { total_de_paginas: 1, total_de_registros: 0, nfCadastro: [] };
    return { total_de_paginas: 1, total_de_registros: 0, conta_receber_cadastro: [] };
  };
  const result = await syncOmieInvoices({ db, call });
  assert.equal(result.invoices, 2);
  assert.deepEqual(calls.filter(c => c.method === 'ListarNFSEs').map(c => c.params.nPagina), [1, 2]);
  assert.ok(calls.every(c => !c.params.filtrar_por_data_de));
  assert.equal(calls.find(c => c.method === 'ListarNF').params.cDetalhesPedido, 'S');
  assert.equal(events[0], 'transaction');
  assert.equal(events[1], 'delete');
  assert.equal(events.at(-1), 'SUCCESS');
});

test('falha na segunda página preserva o histórico anterior sem exclusão', async () => {
  const { db, events } = database();
  const call = async (_path, _method, params) => {
    if (params.nPagina === 2) throw new Error('Omie indisponível');
    return { nTotPaginas: 2, nTotRegistros: 2, nfseEncontradas: [invoice()] };
  };
  await assert.rejects(syncOmieInvoices({ db, call }), /Omie indisponível/);
  assert.deepEqual(events, ['ERROR']);
});

test('resposta malformada ou paginação incompleta nunca apaga o histórico', async () => {
  for (const response of [{}, { nTotPaginas: 1, nTotRegistros: 2, nfseEncontradas: [invoice()] }]) {
    const { db, events } = database();
    await assert.rejects(syncOmieInvoices({ db, call: async () => response }), /incompleta/);
    assert.deepEqual(events, ['ERROR']);
  }
});
