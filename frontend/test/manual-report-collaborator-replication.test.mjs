import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

async function loadReplicationModule() {
  const server = await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true },
    appType: 'custom'
  });
  try {
    return await server.ssrLoadModule('/src/pages/gestor/manualReportCollaboratorReplication.ts');
  } finally {
    await server.close();
  }
}

test('replica colaboradores nos demais relatórios sem apagar ou duplicar equipes', async () => {
  const { replicateManualReportCollaborators } = await loadReplicationModule();
  const files = [
    { id: 'source', collaboratorIds: ['ana'], noturnoCollaboratorIds: ['bia'], reportDate: '2026-08-18' },
    { id: 'second', collaboratorIds: ['carlos'], noturnoCollaboratorIds: [], reportDate: '2026-08-19' },
    { id: 'third', collaboratorIds: ['ana'], noturnoCollaboratorIds: ['davi'], reportDate: '2026-08-20' }
  ];

  const replicated = replicateManualReportCollaborators(files, 'source', 'collaboratorIds', ['ana']);

  assert.deepEqual(replicated.map(file => file.collaboratorIds), [
    ['ana'],
    ['carlos', 'ana'],
    ['ana']
  ]);
  assert.deepEqual(replicated.map(file => file.noturnoCollaboratorIds), [['bia'], [], ['davi']]);
  assert.deepEqual(replicated.map(file => file.reportDate), ['2026-08-18', '2026-08-19', '2026-08-20']);
  assert.equal(replicated[0], files[0]);
  assert.equal(replicated[2], files[2]);
});

test('replica a equipe noturna apenas nos outros relatórios', async () => {
  const { replicateManualReportCollaborators } = await loadReplicationModule();
  const files = [
    { id: 'first', collaboratorIds: [], noturnoCollaboratorIds: ['ana'] },
    { id: 'source', collaboratorIds: ['bia'], noturnoCollaboratorIds: ['carlos'] },
    { id: 'third', collaboratorIds: [], noturnoCollaboratorIds: [] }
  ];

  const replicated = replicateManualReportCollaborators(files, 'source', 'noturnoCollaboratorIds', ['carlos']);

  assert.deepEqual(replicated.map(file => file.noturnoCollaboratorIds), [
    ['ana', 'carlos'],
    ['carlos'],
    ['carlos']
  ]);
  assert.deepEqual(replicated.map(file => file.collaboratorIds), [[], ['bia'], []]);
});
