import assert from 'node:assert/strict';
import test from 'node:test';

import { projectDocumentReadiness, updateProjectDocument, upsertCrmProjectDocument } from '../src/lib/efetivo/project-workflow/documents.js';
import { createProjectDocumentsDatabase } from './helpers/project-documents-db.js';

function event(sourceVersion, sourceUpdatedAt = '2026-09-10T12:00:00Z', externalUrl = 'https://crm.example/proposals/123') {
  return {
    projectId: 'project_1',
    type: 'COMMERCIAL_PROPOSAL',
    title: 'Proposta CRM',
    externalId: 'crm-proposal-123',
    externalUrl,
    sourceVersion,
    sourceUpdatedAt,
    acceptanceMode: 'NONE'
  };
}

test('adaptador CRM cria, repete e ordena versões fora de ordem deterministicamente', async () => {
  const { database, state } = createProjectDocumentsDatabase();
  const created = await upsertCrmProjectDocument(database, event('2'));
  assert.equal(created.outcome, 'CREATED');
  assert.equal(state.documents.length, 1);
  assert.equal(state.versions.length, 1);

  const replay = await upsertCrmProjectDocument(database, event('2'));
  assert.equal(replay.outcome, 'REPLAYED');
  assert.equal(state.versions.length, 1);

  const older = await upsertCrmProjectDocument(database, event('1', '2026-09-09T12:00:00Z'));
  assert.equal(older.outcome, 'IGNORED_OLDER');
  assert.equal(state.documents[0].currentVersionId, created.versionId);

  const tieWinner = await upsertCrmProjectDocument(database, event('10'));
  assert.equal(tieWinner.outcome, 'CURRENT_UPDATED');
  assert.equal(state.documents[0].currentVersionId, tieWinner.versionId);

  const newer = await upsertCrmProjectDocument(database, event('11', '2026-09-11T12:00:00Z'));
  assert.equal(newer.outcome, 'CURRENT_UPDATED');
  assert.equal(state.documents[0].currentVersionId, newer.versionId);
  assert.equal(state.documents.length, 1);
});

test('conteúdo CRM é somente leitura e não confirma fatos comerciais', async () => {
  const { database, state } = createProjectDocumentsDatabase();
  await upsertCrmProjectDocument(database, event('1'));
  const current = state.documents[0];
  await assert.rejects(updateProjectDocument('project_1', current.id, {
    expectedVersion: current.version,
    title: 'Tentativa manual'
  }, { actorUserId: 'leader_1', isManager: true, user: { accountType: 'ADMIN' } }, { database }), error => error.code === 'CRM_DOCUMENT_READ_ONLY');
  assert.equal('commercialFacts' in state, false);
  assert.equal(state.events.some(item => /COMMERCIAL_FACT/.test(item.action)), false);
});

test('referência CRM sem URL acessível permanece pendente', async () => {
  const { database, state, hydrateDocument } = createProjectDocumentsDatabase();
  await upsertCrmProjectDocument(database, event('1', '2026-09-10T12:00:00Z', null));
  assert.equal(projectDocumentReadiness(hydrateDocument(state.documents[0])).reasonCode, 'CONTENT_UNAVAILABLE');
});
