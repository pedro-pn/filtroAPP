import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import env from '../src/config/env.js';
import prisma from '../src/lib/prisma.js';
import { syncOmieProjects } from '../src/lib/omie/sync.js';

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
  categoryFindMany: prisma.omieCategory.findMany
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
