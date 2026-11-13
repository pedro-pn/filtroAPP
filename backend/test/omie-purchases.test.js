import assert from 'node:assert/strict';
import { test } from 'node:test';
import { syncOmiePurchases as runSync } from '../src/lib/omie/purchases.js';

const missing = id => Object.assign(new Error('Título excluído'), { status: 500, body: {
  faultcode: 'SOAP-ENV:Client-105', faultstring: `ERROR: Lançamento não cadastrado para o Código [${id}] !`
} });
const syncOmiePurchases = ({ call, consult, ...args }) => runSync({ requestDelayMs: 0, ...args,
  call: (path, method, params) => method === 'ConsultarContaPagar'
    ? consult ? consult(params.codigo_lancamento_omie) : Promise.reject(missing(params.codigo_lancamento_omie))
    : call(path, method, params)
});

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
        ...Array.from({ length: 7 }, (_, i) => ({ id: `old-${i}`, omieId: String(100 + i), syncedAt: new Date('2020-01-01') }))],
      deleteMany: async args => { events.push({ type: 'delete', args }); return { count: args.where.OR.length }; }
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
  assert.deepEqual(events.filter(event => event.type === 'delete')[0].args.where.OR.map(row => row.id),
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

test('conclui com total variável e crescimento de páginas, sem publicar duplicatas', async () => {
  const { db, events } = database();
  await syncOmiePurchases({ db, call: async (_path, _method, { pagina }) =>
    response([title({ codigo_lancamento_omie: pagina === 2 ? 1 : pagina })], {
      pagina, total_de_paginas: pagina === 1 ? 2 : 3, total_de_registros: pagina === 1 ? 2 : 3
    }) });
  const summary = events.at(-1).args.data.summary;
  assert.equal(summary.paginationChanges, 1);
  assert.equal(summary.duplicateRows, 1);
  assert.equal(events.find(event => event.type === 'batch').rows.length, 2);
});

test('recupera da API um título válido que a paginação deslocou, em vez de excluí-lo', async () => {
  const { db, events } = database();
  const checked = [];
  const result = await syncOmiePurchases({ db, call: async () => response([title()]),
    consult: async id => {
      checked.push(id);
      if (id === 100) return title({ codigo_lancamento_omie: 100, valor_documento: 123 });
      throw missing(id);
    } });
  assert.equal(checked.length, 7);
  assert.equal(result.deleted, 6);
  assert.equal(result.written, 2);
  assert.equal(events.at(-1).args.data.summary.recoveredMissing, 1);
  assert.ok(events.find(event => event.type === 'batch').rows.some(row => row.omieId === '100' && row.valor === 123));
});

test('redução do total e das páginas não descarta custos que ainda existem', async () => {
  const { db, events } = database();
  db.omiePurchase.findMany = async () => [1, 2, 3].map(id => ({ id: `local-${id}`, omieId: String(id), syncedAt: new Date('2020-01-01') }));
  await syncOmiePurchases({ db, call: async (_path, _method, { pagina }) =>
    response([title({ codigo_lancamento_omie: pagina === 1 ? 1 : 3 })], {
      pagina, total_de_paginas: pagina === 1 ? 3 : 2, total_de_registros: pagina === 1 ? 3 : 2
    }), consult: async id => title({ codigo_lancamento_omie: id, valor_documento: 456 }) });
  assert.ok(!events.some(event => event.type === 'delete'));
  assert.equal(events.find(event => event.type === 'batch').rows.length, 3);
  assert.equal(events.at(-1).args.data.summary.recoveredMissing, 1);
});

test('retry de falha transitória é limitado e não sobrepõe chamadas', async () => {
  const { db, events } = database();
  let attempts = 0, active = 0, peak = 0;
  await syncOmiePurchases({ db, call: async () => {
    active++; peak = Math.max(peak, active);
    try {
      if (++attempts === 1) throw Object.assign(new Error('Rate limit'), { status: 429 });
      return response([title()]);
    } finally { active--; }
  } });
  assert.equal(attempts, 2);
  assert.equal(peak, 1);
  assert.equal(events.at(-1).type, 'SUCCESS');
});

test('página final removida durante a leitura exige uma nova confirmação do fim', async () => {
  const { db, events } = database();
  let firstPageCalls = 0;
  await syncOmiePurchases({ db, call: async (_path, _method, { pagina }) => {
    if (pagina === 2) throw Object.assign(new Error('Página não existe mais'), { status: 400 });
    firstPageCalls++;
    return response([title({ codigo_lancamento_omie: firstPageCalls === 1 ? 1 : 2 })], { total_de_paginas: firstPageCalls === 1 ? 2 : 1,
      total_de_registros: firstPageCalls === 1 ? 2 : 1 });
  } });
  assert.equal(firstPageCalls, 2);
  assert.equal(events.at(-1).args.data.summary.paginationChanges, 1);
  assert.equal(events.at(-1).type, 'SUCCESS');
  assert.ok(events.find(event => event.type === 'batch').rows.some(row => row.omieId === '2'),
    'a nova consulta também importa os títulos válidos que acabou de encontrar');
});

for (const [name, consult] of [
  ['erro temporário', async () => { throw Object.assign(new Error('API indisponível'), { status: 503 }); }],
  ['erro de autenticação', async () => { throw Object.assign(new Error('Acesso negado'), { status: 403 }); }],
  ['resposta incompleta', async () => ({})],
  ['outro ID', async () => title({ codigo_lancamento_omie: 999 })],
  ['not found de outro ID', async () => { throw missing(999); }],
  ['mensagem sem código reconhecido', async () => { throw new Error('Lançamento não cadastrado'); }]
]) {
  test(`não exclui nem publica quando a confirmação retorna ${name}`, async () => {
    const { db, events } = database();
    await assert.rejects(syncOmiePurchases({ db, call: async () => response([title()]), consult }));
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
  assert.equal(events.find(event => event.type === 'delete').args.where.OR.length, 8);
  assert.ok(!events.some(event => event.type === 'batch'));
});

test('limpeza de grande volume usa lotes limitados sem excluir títulos válidos', async () => {
  const { db, events } = database();
  db.omiePurchase.findMany = async () => Array.from({ length: 1201 }, (_, i) => ({ id: `id-${i}`, omieId: String(i + 1) }));
  const result = await syncOmiePurchases({ db, call: async () => response([title()]) });
  assert.equal(result.deleted, 1200);
  const batches = events.filter(event => event.type === 'delete').map(event => event.args.where.OR.map(row => row.id));
  assert.deepEqual(batches.map(batch => batch.length), [500, 500, 200]);
  assert.ok(!batches.flat().includes('id-0'));
});
