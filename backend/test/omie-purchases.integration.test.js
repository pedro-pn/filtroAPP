import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { syncOmiePurchases as runSync } from '../src/lib/omie/purchases.js';

const syncOmiePurchases = args => {
  let clock = 0;
  return runSync({ requestDelayMs: 0, wait: async ms => { clock += ms; }, now: () => clock, ...args });
};
const missing = id => Object.assign(new Error('Título excluído'), { status: 500, body: {
  faultcode: 'SOAP-ENV:Client-105', faultstring: `ERROR: Lançamento não cadastrado para o Código [${id}] !`
} });

test('PostgreSQL: primeira execução corrige legado, alterações e exclusões; falhas são atômicas', {
  skip: !process.env.OMIE_SYNC_TEST_DATABASE_URL, timeout: 90_000
}, async t => {
  const base = new URL(process.env.OMIE_SYNC_TEST_DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'banco de testes deve ser local');
  const admin = new pg.Client({ connectionString: base.toString() });
  await admin.connect();
  const name = `omie_sync_${randomUUID().replaceAll('-', '')}`;
  let db;
  t.after(async () => {
    if (db) await db.$disconnect();
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
  });
  await admin.query(`CREATE DATABASE "${name}"`);
  base.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: base.toString() });
  db = new PrismaClient({ adapter: new PrismaPg(pool, { disposeExternalPool: true }) });
  const schema = execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'diff',
    '--from-empty', '--to-schema', 'prisma/schema.prisma', '--script'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024
  });
  await pool.query(schema);
  for (const [id, code, extra] of [
    ['p1', '5833', {}], ['p2', '5834', { isActive: false }],
    ['blocked', '5835', { distributionSettings: { omie: false } }],
    ['unlinked', '5836', {}]
  ]) {
    await db.project.create({ data: { id, code, name: id, clientName: 'QA', clientCnpj: '',
      contractCode: '', location: '', ...extra } });
  }
  await db.omieCategory.create({ data: { codigo: '2.07.97', descricao: 'Peças' } });
  for (const [codigo, projectId, osNumber, inativo] of [
    ['100', 'p1', '5833', false], ['200', 'p2', '5834', true],
    ['300', 'blocked', '5835', false], ['900', null, '5002', false]
  ]) {
    await db.omieProject.create({ data: { codigo, projectId, osNumber, inativo,
      purchasesBackfilledAt: new Date('2020-01-01') } });
  }
  const title = (id, extra = {}) => ({ codigo_lancamento_omie: id, codigo_projeto: 100,
    valor_documento: id <= 3 ? (id === 3 ? 10395.84 : 10395.83) : 14250,
    codigo_categoria: '2.07.97', status_titulo: 'PAGO', numero_documento_fiscal: id <= 3 ? '8244' : '1348',
    numero_parcela: String(id), data_emissao: '01/01/2020', ...extra });
  const cached = (omieId, extra = {}) => ({ omieId: String(omieId), codigoProjeto: '100', projectId: 'p1',
    osNumber: '5833', valor: title(omieId).valor_documento, categoriaCodigo: '2.07.01',
    rawPayload: {}, ...extra });
  await db.omiePurchase.createMany({ data: [
    ...Array.from({ length: 7 }, (_, i) => cached(i + 101, { valor: title(i + 1).valor_documento })),
    ...Array.from({ length: 7 }, (_, i) => cached(i + 1)),
    cached(20), cached(21), cached(22), cached(23),
    cached(24, { codigoProjeto: '900', projectId: null, osNumber: '5002' }),
    cached(25, { codigoProjeto: '300', projectId: 'blocked', osNumber: '5835' }),
    cached(26, { codigoProjeto: '400', projectId: 'unlinked', osNumber: '5836' })
  ] });
  const stableId = (await db.omiePurchase.findUnique({ where: { omieId: '1' } })).id;
  let live = [
    ...Array.from({ length: 7 }, (_, i) => title(i + 1)),
    title(20, { codigo_projeto: 200, valor_documento: 123.45, status_titulo: 'A VENCER',
      codigo_cliente_fornecedor: 90, numero_documento: 'novo', numero_documento_fiscal: '999',
      numero_pedido: '923', data_vencimento: '15/12/2026', data_previsao: '14/12/2026' }),
    title(21, { codigo_projeto: 999 }), // Saiu dos projetos acompanhados.
    title(22, { codigo_projeto: 0 }), // Projeto removido do título.
    title(23, { status_titulo: 'CANCELADO' }),
    title(30, { codigo_projeto: 900, valor_documento: 250 })
  ];
  let unstable = true;
  const call = async (_path, method, params) => {
    if (method === 'ConsultarContaPagar') {
      const row = live.find(row => row.codigo_lancamento_omie === params.codigo_lancamento_omie);
      if (!row) throw missing(params.codigo_lancamento_omie);
      return row;
    }
    assert.equal(method, 'ListarContasPagar');
    assert.ok(!Object.keys(params).some(key => key.startsWith('filtrar_')));
    const offset = (params.pagina - 1) * 5;
    const rows = live.slice(offset, offset + 5);
    return { pagina: params.pagina, registros: rows.length, total_de_registros: live.length + (unstable && params.pagina === 1 ? 1 : 0),
      total_de_paginas: Math.max(1, Math.ceil(live.length / 5)), conta_pagar_cadastro: rows };
  };
  const result = await syncOmiePurchases({ db, call, sinceDays: 7 });
  unstable = false;
  const run = await db.integrationSyncRun.findFirst({ where: { status: 'SUCCESS' }, orderBy: { startedAt: 'desc' } });
  assert.equal(run.summary.paginationChanges, 1, 'variação do total não aborta a carga');
  assert.equal(run.summary.verifiedMissing, 12, 'ausências são confirmadas individualmente');
  assert.equal(result.deleted, 12, 'sete duplicatas, remapeados, cancelado, Sede e vínculo antigo');
  assert.equal(result.written, 9);
  const groups = await db.omiePurchase.groupBy({ by: ['categoriaCodigo'], where: { projectId: 'p1' }, _sum: { valor: true }, _count: true });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].categoriaCodigo, '2.07.97');
  assert.equal(Number(groups[0]._sum.valor), 88187.5);
  assert.equal(groups[0]._count, 7);
  assert.equal((await db.omiePurchase.findUnique({ where: { omieId: '1' } })).id, stableId, 'ID local preservado');
  const changed = await db.omiePurchase.findUnique({ where: { omieId: '20' } });
  assert.equal(changed.projectId, 'p2', 'projeto inativo também é atualizado');
  assert.equal(changed.codigoProjeto, '200');
  assert.equal(changed.osNumber, '5834');
  assert.equal(Number(changed.valor), 123.45);
  assert.equal(changed.statusTitulo, 'A VENCER');
  assert.equal(changed.fornecedorCodigo, '90');
  assert.equal(changed.numeroDocumento, 'novo');
  assert.equal(changed.numeroDocumentoFiscal, '999');
  assert.equal(changed.dataVencimento.toISOString(), '2026-12-15T00:00:00.000Z');
  assert.equal(changed.dataPrevisao.toISOString(), '2026-12-14T00:00:00.000Z');
  assert.equal(changed.rawPayload.numero_pedido, '923');
  assert.ok(await db.omiePurchase.findUnique({ where: { omieId: '25' } }), 'canal desabilitado é preservado');
  const sede = await db.omiePurchase.findUnique({ where: { omieId: '30' } });
  assert.equal(sede.linkStatus, 'SEDE');
  assert.equal(sede.osNumber, '5002');

  const before = await db.omiePurchase.findMany({ orderBy: { omieId: 'asc' } });
  const markers = await db.omieProject.findMany({ orderBy: { codigo: 'asc' } });
  await assert.rejects(syncOmiePurchases({ db, call: async (...args) => {
    if (args[2].pagina === 2) throw new Error('API indisponível');
    return call(...args);
  } }), /API indisponível/);
  assert.deepEqual(await db.omiePurchase.findMany({ orderBy: { omieId: 'asc' } }), before);
  assert.deepEqual(await db.omieProject.findMany({ orderBy: { codigo: 'asc' } }), markers);

  live = [title(999, { valor_documento: 1e20 })]; // Falha SQL após o DELETE.
  await assert.rejects(syncOmiePurchases({ db, call }));
  assert.deepEqual(await db.omiePurchase.findMany({ orderBy: { omieId: 'asc' } }), before, 'rollback inclui exclusões');
  assert.deepEqual(await db.omieProject.findMany({ orderBy: { codigo: 'asc' } }), markers, 'marcadores preservados');

  live = [title(1, { valor_documento: 42 }), title(2, { valor_documento: 42 })];
  await syncOmiePurchases({ db, call, sinceDays: 7 });
  assert.equal(await db.omiePurchase.count({ where: { projectId: 'p1' } }), 2, 'valores iguais com IDs distintos são legítimos');
  await syncOmiePurchases({ db, call, sinceDays: 7 });
  assert.equal(await db.omiePurchase.count({ where: { projectId: 'p1' } }), 2, 'execução repetida não duplica');

  let releaseOlder, olderStarted;
  const waitForOlder = new Promise(resolve => { olderStarted = resolve; });
  const olderResponse = new Promise(resolve => { releaseOlder = resolve; });
  const older = syncOmiePurchases({ db, call: async (...args) => {
    if (args[1] === 'ConsultarContaPagar') return call(...args);
    olderStarted(); return olderResponse;
  } });
  await waitForOlder;
  try {
    live = [title(1, { valor_documento: 84 })];
    await syncOmiePurchases({ db, call });
  } finally {
    releaseOlder({ pagina: 1, registros: 1, total_de_paginas: 1, total_de_registros: 1,
      conta_pagar_cadastro: [title(1, { valor_documento: 999 })] });
  }
  assert.equal((await older).superseded, true, 'ciclo antigo não restaura valores anteriores');
  assert.equal(Number((await db.omiePurchase.findUnique({ where: { omieId: '1' } })).valor), 84);
  live = [];
  await syncOmiePurchases({ db, call });
  assert.equal(await db.omiePurchase.count(), 1, 'snapshot vazio retira todos os gerenciados e preserva canal desabilitado');

  await db.omiePurchase.create({ data: cached(50) });
  const stamp = (await db.omiePurchase.findUnique({ where: { omieId: '50' } })).syncedAt;
  await syncOmiePurchases({ db, call: async (...args) => {
    if (args[1] === 'ConsultarContaPagar') {
      await db.omiePurchase.update({ where: { omieId: '50' }, data: {
        valor: 987, syncedAt: new Date(stamp.getTime() + 1000)
      } });
      throw missing(50);
    }
    return call(...args);
  } });
  assert.equal(Number((await db.omiePurchase.findUnique({ where: { omieId: '50' } })).valor), 987,
    'confirmação antiga não exclui um registro atualizado durante a leitura');
});
