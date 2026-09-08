import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import env from '../src/config/env.js';
import prisma from '../src/lib/prisma.js';
import { syncOmieProjects, syncOmiePurchases } from '../src/lib/omie/sync.js';

const original = {
  fetch: globalThis.fetch,
  omieAppKey: env.omieAppKey,
  omieAppSecret: env.omieAppSecret,
  runCreate: prisma.integrationSyncRun.create,
  runUpdate: prisma.integrationSyncRun.update,
  projectFindMany: prisma.project.findMany,
  omieProjectFindMany: prisma.omieProject.findMany,
  omieProjectUpsert: prisma.omieProject.upsert,
  omieProjectUpdateMany: prisma.omieProject.updateMany,
  categoryFindMany: prisma.omieCategory.findMany,
  purchaseUpsert: prisma.omiePurchase.upsert
};

afterEach(() => {
  globalThis.fetch = original.fetch;
  env.omieAppKey = original.omieAppKey;
  env.omieAppSecret = original.omieAppSecret;
  prisma.integrationSyncRun.create = original.runCreate;
  prisma.integrationSyncRun.update = original.runUpdate;
  prisma.project.findMany = original.projectFindMany;
  prisma.omieProject.findMany = original.omieProjectFindMany;
  prisma.omieProject.upsert = original.omieProjectUpsert;
  prisma.omieProject.updateMany = original.omieProjectUpdateMany;
  prisma.omieCategory.findMany = original.categoryFindMany;
  prisma.omiePurchase.upsert = original.purchaseUpsert;
});

function omieResponse(data, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async text() {
      return JSON.stringify(data);
    }
  };
}

function configureOmieCredentials() {
  env.omieAppKey = 'test-key';
  env.omieAppSecret = 'test-secret';
}

function stubSyncRuns(updates = []) {
  prisma.integrationSyncRun.create = async ({ data }) => ({ id: `run-${data.scope}` });
  prisma.integrationSyncRun.update = async (args) => {
    updates.push(args);
    return args.data;
  };
}

test('syncOmieProjects reinicia o backfill somente quando o vínculo com o app muda', async () => {
  configureOmieCredentials();
  stubSyncRuns();
  prisma.project.findMany = async () => [
    { id: 'project-5694', code: '5694' },
    { id: 'project-5810', code: '5810' }
  ];
  prisma.omieProject.findMany = async () => [
    { codigo: '123456', projectId: null },
    { codigo: '123457', projectId: 'project-5810' }
  ];
  const upserts = [];
  prisma.omieProject.upsert = async (args) => {
    upserts.push(args);
    return args.update;
  };
  globalThis.fetch = async () => omieResponse({
    pagina: 1,
    total_de_paginas: 1,
    cadastro: [
      { codigo: 123456, nome: 'OS 5694 - Retorno de equipamentos', inativo: 'N' },
      { codigo: 123457, nome: 'OS 5810 - Serviço', inativo: 'N' }
    ]
  });

  const result = await syncOmieProjects({ triggeredBy: 'TEST' });

  assert.equal(result.linksChanged, 1);
  const changed = upserts.find(item => item.where.codigo === '123456');
  const unchanged = upserts.find(item => item.where.codigo === '123457');
  assert.equal(changed.update.projectId, 'project-5694');
  assert.equal(changed.update.purchasesBackfilledAt, null);
  assert.equal(Object.hasOwn(unchanged.update, 'purchasesBackfilledAt'), false);
});

test('syncOmiePurchases importa todo o histórico pendente pelo filtro oficial de projeto', async () => {
  configureOmieCredentials();
  const runUpdates = [];
  stubSyncRuns(runUpdates);
  prisma.omieCategory.findMany = async () => [
    { codigo: '2.15.97', descricao: 'Projeto - Frete' }
  ];
  prisma.omieProject.findMany = async () => [{
    codigo: '123456',
    osNumber: '5694',
    projectId: 'project-5694',
    purchasesBackfilledAt: null
  }];

  const events = [];
  const upserts = [];
  prisma.omiePurchase.upsert = async (args) => {
    events.push('purchase');
    upserts.push(args);
    return args.create;
  };
  const markers = [];
  prisma.omieProject.updateMany = async (args) => {
    events.push('marker');
    markers.push(args);
    return { count: 1 };
  };

  const calls = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    const params = body.param[0];
    calls.push(params);
    if (params.filtrar_por_projeto === 123456) {
      return omieResponse({
        pagina: 1,
        total_de_paginas: 1,
        conta_pagar_cadastro: [{
          codigo_lancamento_omie: 8409736517,
          codigo_projeto: 123456,
          valor_documento: 6000,
          status_titulo: 'PAGO',
          codigo_categoria: '2.15.97',
          numero_documento: 'DANFE 2314',
          data_emissao: '19/11/2025'
        }]
      });
    }
    return omieResponse({ pagina: 1, total_de_paginas: 1, conta_pagar_cadastro: [] });
  };

  const result = await syncOmiePurchases({ triggeredBy: 'TEST', sinceDays: 7 });

  const historicalCall = calls.find(call => call.filtrar_por_projeto === 123456);
  const incrementalCall = calls.find(call => call.filtrar_apenas_alteracao === 'S');
  assert.ok(historicalCall);
  assert.equal(Object.hasOwn(historicalCall, 'filtrar_por_data_de'), false);
  assert.ok(incrementalCall?.filtrar_por_data_de);
  assert.equal(Object.hasOwn(incrementalCall, 'filtrar_por_projeto'), false);

  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].create.omieId, '8409736517');
  assert.equal(upserts[0].create.projectId, 'project-5694');
  assert.equal(upserts[0].create.valor, 6000);
  assert.equal(upserts[0].create.categoriaDescricao, 'Projeto - Frete');
  assert.equal(upserts[0].create.dataEmissao.toISOString(), '2025-11-19T00:00:00.000Z');
  assert.deepEqual(events, ['purchase', 'marker']);
  assert.deepEqual(markers[0].where, { codigo: '123456', projectId: 'project-5694' });
  assert.ok(markers[0].data.purchasesBackfilledAt instanceof Date);
  assert.equal(result.historicalBackfillProjects, 1);
  assert.equal(result.historicalBackfillRead, 1);
  assert.equal(result.historicalBackfillWritten, 1);

  const success = runUpdates.at(-1).data;
  assert.equal(success.status, 'SUCCESS');
  assert.equal(success.summary.historicalBackfillMode, 'TARGETED');
});

test('syncOmiePurchases não repete a carga histórica depois de concluída', async () => {
  configureOmieCredentials();
  stubSyncRuns();
  prisma.omieCategory.findMany = async () => [];
  prisma.omieProject.findMany = async () => [{
    codigo: '123456',
    osNumber: '5694',
    projectId: 'project-5694',
    purchasesBackfilledAt: new Date('2026-08-17T12:00:00.000Z')
  }];
  let markerWrites = 0;
  prisma.omieProject.updateMany = async () => {
    markerWrites += 1;
    return { count: 1 };
  };
  prisma.omiePurchase.upsert = async () => {
    throw new Error('não deveria gravar título');
  };
  const calls = [];
  globalThis.fetch = async (_url, options) => {
    const params = JSON.parse(options.body).param[0];
    calls.push(params);
    return omieResponse({ pagina: 1, total_de_paginas: 1, conta_pagar_cadastro: [] });
  };

  const result = await syncOmiePurchases({ triggeredBy: 'TEST', sinceDays: 7 });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].filtrar_apenas_alteracao, 'S');
  assert.equal(Object.hasOwn(calls[0], 'filtrar_por_projeto'), false);
  assert.equal(markerWrites, 0);
  assert.equal(result.historicalBackfillProjects, 0);
});

test('syncOmiePurchases ignora backfill direcionado de projeto inativo e mantém o ciclo incremental', async () => {
  configureOmieCredentials();
  const runUpdates = [];
  stubSyncRuns(runUpdates);
  prisma.omieCategory.findMany = async () => [];
  prisma.omieProject.findMany = async () => [{
    codigo: '123456',
    osNumber: '5694',
    projectId: 'project-5694',
    inativo: true,
    purchasesBackfilledAt: null
  }];
  let markerWrites = 0;
  prisma.omieProject.updateMany = async () => {
    markerWrites += 1;
    return { count: 1 };
  };
  const calls = [];
  globalThis.fetch = async (_url, options) => {
    const params = JSON.parse(options.body).param[0];
    calls.push(params);
    return omieResponse({ pagina: 1, total_de_paginas: 1, conta_pagar_cadastro: [] });
  };

  const result = await syncOmiePurchases({ triggeredBy: 'TEST', sinceDays: 7 });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].filtrar_apenas_alteracao, 'S');
  assert.equal(Object.hasOwn(calls[0], 'filtrar_por_projeto'), false);
  assert.equal(markerWrites, 0);
  assert.equal(result.historicalBackfillProjects, 0);
  assert.equal(result.historicalBackfillSkippedInactiveProjects, 1);
  assert.equal(runUpdates.at(-1).data.status, 'SUCCESS');
});

test('syncOmiePurchases isola resposta de projeto inativo sem abortar os demais títulos', async () => {
  configureOmieCredentials();
  const runUpdates = [];
  stubSyncRuns(runUpdates);
  prisma.omieCategory.findMany = async () => [];
  prisma.omieProject.findMany = async () => [{
    codigo: '123456',
    osNumber: '5694',
    projectId: 'project-5694',
    inativo: false,
    purchasesBackfilledAt: null
  }];
  let markerWrites = 0;
  prisma.omieProject.updateMany = async () => {
    markerWrites += 1;
    return { count: 1 };
  };
  const calls = [];
  globalThis.fetch = async (_url, options) => {
    const params = JSON.parse(options.body).param[0];
    calls.push(params);
    if (params.filtrar_por_projeto === 123456) {
      return omieResponse(
        { faultstring: 'ERROR: O projeto está inativo ! - tag: [filtrar_por_projeto]' },
        { ok: false, status: 500 }
      );
    }
    return omieResponse({ pagina: 1, total_de_paginas: 1, conta_pagar_cadastro: [] });
  };

  const result = await syncOmiePurchases({ triggeredBy: 'TEST', sinceDays: 7 });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].filtrar_por_projeto, 123456);
  assert.equal(calls[1].filtrar_apenas_alteracao, 'S');
  assert.equal(markerWrites, 0);
  assert.equal(result.historicalBackfillProjects, 0);
  assert.equal(result.historicalBackfillSkippedInactiveProjects, 1);
  assert.equal(runUpdates.at(-1).data.status, 'SUCCESS');
});

test('syncOmiePurchases não conclui o marcador quando o backfill direcionado falha', async () => {
  configureOmieCredentials();
  const runUpdates = [];
  stubSyncRuns(runUpdates);
  prisma.omieCategory.findMany = async () => [];
  prisma.omieProject.findMany = async () => [{
    codigo: '123456',
    osNumber: '5694',
    projectId: 'project-5694',
    purchasesBackfilledAt: null
  }];
  let markerWrites = 0;
  prisma.omieProject.updateMany = async () => {
    markerWrites += 1;
    return { count: 1 };
  };
  prisma.omiePurchase.upsert = async () => {
    throw new Error('não deveria gravar título');
  };
  globalThis.fetch = async () => omieResponse(
    { faultstring: 'falha temporária no Omie' },
    { ok: false, status: 500 }
  );

  await assert.rejects(
    syncOmiePurchases({ triggeredBy: 'TEST', sinceDays: 7 }),
    /falha temporária no Omie/
  );

  assert.equal(markerWrites, 0);
  const failure = runUpdates.at(-1).data;
  assert.equal(failure.status, 'ERROR');
  assert.match(failure.error, /falha temporária no Omie/);
});
