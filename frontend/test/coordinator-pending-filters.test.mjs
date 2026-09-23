import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

async function load(path) {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom'
  });
  try {
    return await server.ssrLoadModule(path);
  } finally {
    await server.close();
  }
}

const options = { search: '', projectSort: 'asc', pageSize: 50 };
const coordinator = { id: 'u1', role: 'COORDINATOR', accountType: 'INTERNAL', moduleRoles: ['rdo:coordinator'] };
const reviewer = { ...coordinator, rdoExtraPermissions: ['REVIEW_REPORTS'] };

test('sem a permissão, a aba Pendentes lista apenas os relatórios criados pelo coordenador', async () => {
  const filters = await load('/src/pages/coordinator/pendingReportFilters.ts');
  const listed = filters.coordinatorPendingReportFilters(coordinator, options);
  assert.equal(listed.createdByUserId, 'u1');
  assert.deepEqual(listed.statuses, ['PENDING', 'RETURNED']);
  assert.equal(listed.reviewQueue, undefined);
  assert.equal(filters.coordinatorPendingCountQuery(coordinator).createdByUserId, 'u1');
});

test('com a permissão, a aba Pendentes usa a mesma fila de revisão do gestor', async () => {
  const filters = await load('/src/pages/coordinator/pendingReportFilters.ts');
  const listed = filters.coordinatorPendingReportFilters(reviewer, options);
  assert.equal(listed.reviewQueue, true);
  assert.equal(listed.createdByUserId, undefined, 'a fila não pode ficar presa ao autor');
  assert.equal(listed.statuses, undefined);
  assert.equal(listed.projectActive, true);
  const count = filters.coordinatorPendingCountQuery(reviewer);
  assert.deepEqual(count, { reviewQueue: true, projectActive: true });
});

test('a permissão só vale para coordenador interno com o grant', async () => {
  const filters = await load('/src/pages/coordinator/pendingReportFilters.ts');
  for (const user of [
    null,
    coordinator,
    { ...reviewer, moduleRoles: ['rdo:collaborator'] },
    { ...reviewer, accountType: 'CLIENT' }
  ]) {
    assert.equal(filters.coordinatorPendingReportFilters(user, options).reviewQueue, undefined);
  }
});
