import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createServer } from 'vite';
import { QueryObserver, focusManager } from '@tanstack/react-query';

let server, updates, clients, api, accumulated;
before(async () => {
  server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname, server: { middlewareMode: true }, appType: 'custom' });
  updates = await server.ssrLoadModule('/src/api/dataUpdates.ts');
  clients = await server.ssrLoadModule('/src/queryClient.ts');
  api = (await server.ssrLoadModule('/src/api/client.ts')).apiClient;
  accumulated = await server.ssrLoadModule('/src/utils/accumulatedReportRefresh.ts');
  globalThis.localStorage = { getItem: () => null };
});
after(async () => { delete globalThis.localStorage; await server?.close(); });
const pause = () => new Promise(resolve => setTimeout(resolve, 20));

for (const [path, affected, unrelated] of [
  ['/rdo/projects/p1', ['projects', 'project-cards', 'project-workflows', 'romaneio-projects', 'estoque', 'qualidade'], ['assinaturas']],
  ['/rdo/reports/r1/status', ['report', 'reports', 'bootstrap', 'mission-group-detail', 'project-execution', 'projectStats', 'statsOverview', 'allocationReport'], ['estoque']],
  ['/efetivo/planning/collaborators/c1', ['collaborators', 'efetivo-mission-team-collaborators', 'workforce', 'epi-collaborators', 'bootstrap', 'project-cards'], ['assinaturas']],
  ['/workforce/absences/a1', ['efetivo-mission-team-absences', 'efetivo-planning-availability', 'reports'], ['estoque']],
  ['/rdo/job-roles/j1', ['job-roles', 'efetivo-planning-job-roles', 'planned-scope', 'cost-cargos'], ['assinaturas']],
  ['/equipamentos/e1', ['equipamentos', 'romaneio-catalog', 'operational-reports', 'bootstrap'], ['qualidade']],
  ['/rdo/operational-reports/r1/status', ['operational-reports', 'equipamentos', 'reports', 'allocationReport'], ['assinaturas']],
  ['/romaneio/r1', ['romaneios', 'romaneio-return-items', 'project-romaneios', 'bootstrap'], ['assinaturas']],
  ['/acompanhamento/comercial/projetos/p1/cronograma', ['planned-scope', 'project-detail', 'mission-group-detail', 'efetivo-planning-calendar'], ['assinaturas']],
  ['/acompanhamento/custo/config', ['cost-config', 'project-detail', 'sede-costs', 'collaborator-hourly-rates'], ['reports']],
  ['/qualidade/registros/q1', ['qualidade'], ['projects']],
  ['/estoque/movimentacoes/m1', ['estoque'], ['projects']],
  ['/epi/records/r1', ['epi-collaborators', 'epi-public-signature'], ['projects']],
  ['/assinaturas/documentos/d1/publicar', ['assinaturas', 'project-documents', 'project-closeout'], ['projects']],
  ['/reports/public-sign/opaque/confirm', ['report', 'reports', 'public-signature'], ['estoque']],
  ['/rdo/surveys/s1/follow-up', ['surveys', 'bootstrap'], ['projects']],
  ['/admin/accounts/u1', ['users', 'efetivo-planning-users', 'project-workflow-leaders'], ['estoque']],
  ['/admin/api-credentials/c1', ['admin-api-credential', 'admin-api-credential-events'], ['projects']],
  ['/privacy/requests/r1/status', ['privacy-requests'], ['projects']]
]) test(`gravação ${path} renova os dados dependentes`, () => {
  const prefixes = updates.dataUpdatesForRequest('patch', path);
  for (const root of affected) assert.ok(updates.matchesDataUpdate([root, { filter: 'any' }], prefixes), root);
  for (const root of unrelated) assert.equal(updates.matchesDataUpdate([root], prefixes), false, root);
});

test('POST de consulta, simulação, extração ou download não invalida consultas', () => {
  for (const path of ['/rdo/reports/counts', '/rdo/reports/manual-extract', '/rdo/reports/batch-download', '/rdo/reports/historical-services/p1/preview', '/workforce/availability/check', '/acompanhamento/custo/simular', '/admin/api-credentials/c1/test']) assert.deepEqual(updates.dataUpdatesForRequest('post', path), [], path);
  for (const [method, path] of [['get', '/rdo/reports'], ['post', '/auth/login'], ['post', '/rdo/uploads']]) assert.deepEqual(updates.dataUpdatesForRequest(method, path), []);
});

test('API direta renova consulta ativa e marca consulta inativa para a próxima navegação', async () => {
  const client = clients.createAppQueryClient();
  const dispose = clients.installQueryDataUpdates(client);
  let revision = 1, reads = 0;
  const observer = new QueryObserver(client, { queryKey: ['projects'], queryFn: async () => { reads++; return revision; } });
  const unsubscribe = observer.subscribe(() => {});
  try {
    await observer.refetch();
    client.setQueryData(['mission-group-detail', 'g1'], 1);
    client.setQueryData(['assinaturas', 'list'], 1);
    await api.put('/rdo/projects/p1', {}, { adapter: async config => { revision = 2; return { data: {}, status: 200, statusText: 'OK', headers: {}, config }; } });
    await pause();
    assert.equal(client.getQueryData(['projects']), 2);
    assert.ok(reads >= 2);
    assert.equal(client.getQueryState(['mission-group-detail', 'g1']).isInvalidated, true);
    assert.equal(client.getQueryState(['assinaturas', 'list']).isInvalidated, false);
  } finally { unsubscribe(); dispose(); client.clear(); }
});

test('falha de gravação e POST counts não disparam atualização automática', async () => {
  const client = clients.createAppQueryClient();
  const dispose = clients.installQueryDataUpdates(client);
  client.setQueryData(['reports'], ['original']);
  try {
    await assert.rejects(api.put('/rdo/projects/p1', {}, { adapter: async () => { throw new Error('não salvo'); } }));
    await api.post('/rdo/reports/counts', {}, { adapter: async config => ({ data: { totals: [] }, status: 200, statusText: 'OK', headers: {}, config }) });
    await pause();
    assert.equal(client.getQueryState(['reports']).isInvalidated, false);
  } finally { dispose(); client.clear(); }
});

test('voltar à tela ou à aba revalida mesmo dentro dos 60 segundos do cache', async () => {
  const client = clients.createAppQueryClient(); client.mount();
  let revision = 1;
  client.setQueryData(['projects'], 0);
  const observer = new QueryObserver(client, { queryKey: ['projects'], queryFn: async () => revision });
  const unsubscribe = observer.subscribe(() => {});
  try {
    await pause(); assert.equal(observer.getCurrentResult().data, 1);
    revision = 2; focusManager.setFocused(false); focusManager.setFocused(true);
    await pause(); assert.equal(observer.getCurrentResult().data, 2);
  } finally { unsubscribe(); client.unmount(); client.clear(); focusManager.setFocused(undefined); }
});

test('listas e painéis têm atualização periódica; formulários e catálogos estáticos não', () => {
  for (const key of [['projects'], ['reports', 'accumulated'], ['efetivo-planning-overview'], ['operations'], ['operational-reports', 'module-list']]) assert.equal(clients.liveQueryInterval(key), 60_000);
  for (const key of [['romaneio', 'edit'], ['report', 'edit'], ['planned-scope'], ['cost-config'], ['equipamentos', 'units-catalog'], ['reports', 'planning-context'], ['operational-reports', 'report']]) assert.equal(clients.liveQueryInterval(key), false);
});

function page(items, number, totalPages = 2, groups = []) { return { items, groups, pagination: { page: number, pageSize: 2, total: 4, totalPages } }; }
const report = (id, projectId = 'p1', status = 'PENDING') => ({ id, projectId, reportType: 'RDO', status });

test('revalidação atualiza todas as páginas acumuladas e remove itens que saíram do filtro', async () => {
  const calls = [];
  const result = await accumulated.refreshAccumulatedReportPages({ status: 'PENDING' }, 2, () => [], async filters => {
    calls.push(filters.page);
    return page(filters.page === 1 ? [report('new'), report('r1', 'p1', 'RETURNED')] : [report('r3', 'p2')], filters.page);
  });
  assert.deepEqual(calls, [1, 2]);
  assert.deepEqual(result.items.map(item => item.id), ['new', 'r1', 'r3']);
  assert.equal(result.items.find(item => item.id === 'r1').status, 'RETURNED');
  assert.equal(result.pagination.page, 2);
});

test('revalidação preserva a janela do grupo e atualiza/exclui seus itens', async () => {
  const groups = accumulated.loadedReportGroups([report('old')], { 'p1-RDO-2-desc': 4 });
  const result = await accumulated.refreshAccumulatedReportPages({}, 1, () => groups, async filters => {
    if (!filters.projectId) return page([report('old'), report('other', 'p2')], 1);
    assert.equal(filters.reportSort, 'desc');
    return page(filters.page === 1 ? [report('a', 'p1', 'SIGNED'), report('b')] : [report('c')], filters.page, 2, [{ projectId: 'p1', reportType: 'RDO', total: 3 }]);
  });
  assert.deepEqual(result.items.map(item => item.id), ['other', 'a', 'b', 'c']);
  assert.equal(result.items.find(item => item.id === 'a').status, 'SIGNED');
  assert.equal(result.groups[0].total, 3);
});

test('exclusões reduzem o número de páginas sem consultar páginas que deixaram de existir', async () => {
  const calls = [];
  const result = await accumulated.refreshAccumulatedReportPages({}, 3, () => [], async filters => { calls.push(filters.page); return page([], filters.page, 1); });
  assert.deepEqual(calls, [1]); assert.deepEqual(result.items, []); assert.equal(result.pagination.page, 1);
});

test('gravação durante o primeiro GET impede que a resposta antiga permaneça no cache', async () => {
  const client = clients.createAppQueryClient();
  const dispose = clients.installQueryDataUpdates(client);
  let revision = 1;
  const release = [];
  const observer = new QueryObserver(client, { queryKey: ['projects'], queryFn: () => {
    const value = revision;
    return new Promise(resolve => release.push(() => resolve(value)));
  } });
  const unsubscribe = observer.subscribe(() => {});
  try {
    assert.equal(release.length, 1);
    revision = 2;
    updates.notifyDataWrite('put', '/rdo/projects/p1');
    await pause(); assert.equal(release.length, 2);
    release[1](); await pause(); release[0](); await pause();
    assert.equal(client.getQueryData(['projects']), 2);
  } finally { unsubscribe(); dispose(); client.clear(); }
});

test('troca de ordenação conserva as duas janelas carregadas do mesmo grupo', async () => {
  const groups = accumulated.loadedReportGroups([report('old')], { 'p1-RDO-1-asc': 1, 'p1-RDO-1-desc': 1 });
  const result = await accumulated.refreshAccumulatedReportPages({}, 1, () => groups, async filters => page([report(filters.projectId ? filters.reportSort : 'old')], 1, 1));
  assert.deepEqual(result.items.map(item => item.id), ['asc', 'desc']);
});

test('autosave do romaneio não renova módulos que não receberam alterações', () => {
  assert.deepEqual(updates.dataUpdatesForRequest('put', '/romaneio/drafts/d1'), ['romaneio-drafts']);
  assert.ok(updates.matchesDataUpdate(['report', 'r1'], updates.dataUpdatesForRequest('delete', '/rdo/uploads/file')));
});
