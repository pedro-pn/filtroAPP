import assert from 'node:assert/strict';
import { test } from 'node:test';
import { syncOmiePurchases } from '../src/lib/omie/purchases.js';

const title = (extra = {}) => ({ codigo_lancamento_omie: 1, codigo_projeto: 100,
  valor_documento: 500, codigo_categoria: '2.07.97', status_titulo: 'PAGO',
  data_emissao: '01/01/2020', ...extra });
const response = (rows, extra = {}) => ({ pagina: 1, total_de_paginas: 1,
  total_de_registros: rows.length, registros: rows.length, conta_pagar_cadastro: rows, ...extra });

function database() {
  const events = [];
  const db = {
    omieCategory: { findMany: async () => [{ codigo: '2.07.97', descricao: 'Peças' }] },
    omieProject: {
      findMany: async () => [{ codigo: '100', projectId: 'project', osNumber: '5833' }],
      updateMany: async args => { events.push({ type: 'marker', args }); }
    },
    omiePurchase: {
      findMany: async () => [{ id: 'retained', omieId: '1' },
        ...Array.from({ length: 7 }, (_, i) => ({ id: `old-${i}`, omieId: `old-${i}` }))],
      deleteMany: async args => { events.push({ type: 'delete', args }); return { count: args.where.id.in.length }; }
    },
    integrationSyncRun: {
      create: async () => ({ id: 'run', startedAt: new Date('2026-01-01') }),
      findFirst: async () => null,
      update: async args => { events.push({ type: args.data.status, args }); }
    },
    $queryRaw: async () => [],
    $executeRaw: async query => { events.push({ type: 'batch', rows: JSON.parse(query.values[0]) }); },
    $transaction: async fn => { events.push({ type: 'transaction' }); return fn(db); }
  };
  return { db, events };
}

test('reconcilia o histórico completo em toda execução, mesmo com sinceDays e backfill antigo', async () => {
  const { db, events } = database();
  const calls = [];
  const call = async (_path, method, params) => {
    calls.push({ method, params });
    return response([title()]);
  };
  for (let run = 0; run < 2; run++) {
    const result = await syncOmiePurchases({ db, call, sinceDays: 7 });
    assert.equal(result.deleted, 7);
    assert.equal(result.written, 1);
  }
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ method, params }) => method === 'ListarContasPagar'
    && params.apenas_importado_api === 'N' && params.ordenar_por === 'CODIGO'
    && !Object.keys(params).some(key => key.startsWith('filtrar_'))));
  const row = events.find(event => event.type === 'batch').rows[0];
  assert.equal(row.omieId, '1');
  assert.equal(row.projectId, 'project');
  assert.equal(row.categoriaDescricao, 'Peças');
  assert.equal(row.dataEmissao, '2020-01-01T00:00:00.000Z');
  assert.deepEqual(events.filter(event => event.type === 'delete')[0].args.where.id.in,
    Array.from({ length: 7 }, (_, i) => `old-${i}`));
  assert.equal(events.at(-1).args.data.summary.mode, 'FULL_SNAPSHOT');
  assert.equal(events.at(-1).args.data.summary.recordsDeleted, 7);
});

test('lê todas as páginas antes da transação e inclui Sede; cancelados e projetos não vinculados ficam fora', async () => {
  const { db, events } = database();
  const call = async (_path, _method, params) => {
    assert.equal(events.length, 0, 'não publicar uma página parcial');
    return params.pagina === 1
      ? response([title(), title({ codigo_lancamento_omie: 2, codigo_projeto: 5002 })], { total_de_registros: 4, total_de_paginas: 2 })
      : response([title({ codigo_lancamento_omie: 3, status_titulo: 'CANCELADO' }),
        title({ codigo_lancamento_omie: 4, codigo_projeto: 999 })], { pagina: 2, total_de_registros: 4, total_de_paginas: 2 });
  };
  const result = await syncOmiePurchases({ db, call });
  assert.equal(result.read, 4);
  assert.equal(result.written, 2);
  assert.equal(events.at(-1).args.data.summary.canceledIgnored, 1);
  const sede = events.find(event => event.type === 'batch').rows[1];
  assert.equal(sede.linkStatus, 'SEDE');
  assert.equal(sede.projectId, null);
});

for (const [name, invalid] of [
  ['array ausente', { conta_pagar_cadastro: undefined }],
  ['total ausente', { total_de_registros: undefined }],
  ['páginas ausentes', { total_de_paginas: undefined }],
  ['página incorreta', { pagina: 2 }],
  ['páginas fracionárias', { total_de_paginas: 1.5 }],
  ['total maior que registros', { total_de_registros: 2 }],
  ['contagem da página incorreta', { registros: 0 }],
  ['página vazia antes do fim', { conta_pagar_cadastro: [], registros: 0, total_de_registros: 1, total_de_paginas: 2 }],
  ['ID ausente', { conta_pagar_cadastro: [title({ codigo_lancamento_omie: undefined })] }],
  ['valor ausente', { conta_pagar_cadastro: [title({ valor_documento: null })] }],
  ['valor não numérico', { conta_pagar_cadastro: [title({ valor_documento: 'erro' })] }],
  ['data inválida', { conta_pagar_cadastro: [title({ data_emissao: '31/02/2026' })] }]
]) {
  test(`preserva custos e marcadores com ${name}`, async () => {
    const { db, events } = database();
    await assert.rejects(syncOmiePurchases({ db, call: async () => response([title()], invalid) }), /preservada/);
    assert.deepEqual(events.map(event => event.type), ['ERROR']);
  });
}

test('falha na segunda página preserva a versão anterior', async () => {
  const { db, events } = database();
  await assert.rejects(syncOmiePurchases({ db, call: async (_path, _method, { pagina }) => {
    if (pagina === 2) throw new Error('Omie indisponível');
    return response([title()], { total_de_paginas: 2, total_de_registros: 2 });
  } }), /Omie indisponível/);
  assert.deepEqual(events.map(event => event.type), ['ERROR']);
});

for (const mode of ['duplicate', 'total', 'pages']) {
  test(`recusa paginação instável: ${mode}`, async () => {
    const { db, events } = database();
    await assert.rejects(syncOmiePurchases({ db, call: async (_path, _method, { pagina }) =>
      response([title({ codigo_lancamento_omie: mode === 'duplicate' ? 1 : pagina })], {
        pagina, total_de_paginas: pagina === 2 && mode === 'pages' ? 3 : 2,
        total_de_registros: pagina === 2 && mode === 'total' ? 3 : 2
      }) }), /preservada/);
    assert.deepEqual(events.map(event => event.type), ['ERROR']);
  });
}

test('snapshot antigo não substitui outro ciclo já publicado', async () => {
  const { db, events } = database();
  db.integrationSyncRun.findFirst = async () => ({ id: 'newer-run' });
  const result = await syncOmiePurchases({ db, call: async () => response([title()]) });
  assert.equal(result.superseded, true);
  assert.equal(result.deleted, 0);
  assert.equal(result.written, 0);
  assert.deepEqual(events.map(event => event.type), ['transaction', 'SUCCESS']);
});

test('snapshot vazio confirmado pode remover os últimos títulos', async () => {
  const { db, events } = database();
  await syncOmiePurchases({ db, call: async () => response([], { total_de_paginas: 0 }) });
  assert.equal(events.find(event => event.type === 'delete').args.where.id.in.length, 8);
  assert.ok(!events.some(event => event.type === 'batch'));
});

test('limpeza de grande volume usa lotes limitados sem excluir títulos válidos', async () => {
  const { db, events } = database();
  db.omiePurchase.findMany = async () => Array.from({ length: 1201 }, (_, i) => ({ id: `id-${i}`, omieId: String(i + 1) }));
  const result = await syncOmiePurchases({ db, call: async () => response([title()]) });
  assert.equal(result.deleted, 1200);
  const batches = events.filter(event => event.type === 'delete').map(event => event.args.where.id.in);
  assert.deepEqual(batches.map(batch => batch.length), [500, 500, 200]);
  assert.ok(!batches.flat().includes('id-0'));
});
