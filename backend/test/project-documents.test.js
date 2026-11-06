import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  addProjectDocumentVersion,
  archiveProjectDocument,
  createProjectDocument,
  listProjectDocuments,
  recordProjectDocumentAcceptance,
  restoreProjectDocument,
  updateProjectDocument
} from '../src/lib/efetivo/project-workflow/documents.js';
import { createProjectDocumentsDatabase, testPdfDataUrl } from './helpers/project-documents-db.js';

const context = { actorUserId: 'leader_1', isManager: true, user: { id: 'leader_1', name: 'Líder', accountType: 'ADMIN' } };

test('abrir documentos de um handover existente recupera a busca ausente uma única vez', async () => {
  const { database, state } = createProjectDocumentsDatabase({ stage: 'HANDOVER' });
  state.project.contractCode = '4064';
  const result = await listProjectDocuments('project_1', {}, context, { database });
  assert.equal(result.documents.length, 0);
  assert.equal(result.commercialProposalSync.proposalCode, '4064');
  assert.equal(result.commercialProposalSync.revisionNumber, 0);
  assert.equal(state.project.commercialProposalSync.status, 'PENDING');
  const requestId = state.project.commercialProposalSync.requestId;
  await listProjectDocuments('project_1', {}, context, { database });
  assert.equal(state.project.commercialProposalSync.requestId, requestId);
});

test('consulta documental expõe a causa da ausência sem reiniciar erros nem propostas excluídas', async () => {
  const { database, state } = createProjectDocumentsDatabase({ stage: 'HANDOVER' });
  state.project.commercialProposalSync = { status: 'ERROR', requestId: 'existing', proposalCode: '4607',
    revisionNumber: 0, errorCode: 'COMERCIALAPP_HTTP_404', attempts: 203 };
  const result = await listProjectDocuments('project_1', {}, context, { database });
  assert.equal(result.commercialProposalSync.errorCode, 'COMERCIALAPP_HTTP_404');
  assert.equal(state.project.commercialProposalSync.attempts, 203);
  state.project.commercialProposalSync = { ...state.project.commercialProposalSync, status: 'EXCLUDED', stopReason: 'LEGACY_ACCESS_ONLY' };
  const excluded = await listProjectDocuments('project_1', {}, context, { database });
  assert.equal(excluded.commercialProposalSync.stopReason, 'LEGACY_ACCESS_ONLY');
  assert.equal(state.project.commercialProposalSync.status, 'EXCLUDED');
});

test('consulta de projeto encerrado ou sem gestão não inicializa importação', async () => {
  const { database, state } = createProjectDocumentsDatabase({ stage: 'FINISHED' });
  state.project.isActive = false;
  state.project.contractCode = '4064';
  assert.equal((await listProjectDocuments('project_1', {}, context, { database })).commercialProposalSync, null);
  state.project.workflow = null;
  assert.equal((await listProjectDocuments('project_1', {}, context, { database })).commercialProposalSync, null);
  assert.equal(state.project.commercialProposalSync, undefined);
});

test('cria catálogo, mantém versões imutáveis e arquiva/restaura com concorrência otimista', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'filtro-project-service-'));
  const { database, state } = createProjectDocumentsDatabase();
  const created = await createProjectDocument('project_1', {
    type: 'CONTRACT', title: 'Contrato principal', acceptanceMode: 'NONE', requirementStage: null,
    initialVersion: { versionLabel: 'Rev. 00', fileName: 'contrato.pdf', dataUrl: testPdfDataUrl('rev0') }
  }, context, { database, rootDir, token: 'rev0' });
  assert.equal(created.document.currentVersion.sequence, 1);
  const revised = await addProjectDocumentVersion('project_1', created.document.id, {
    expectedVersion: created.document.version, versionLabel: 'Rev. 01', fileName: 'contrato-rev1.pdf', dataUrl: testPdfDataUrl('rev1')
  }, context, { database, rootDir, token: 'rev1' });
  assert.equal(revised.document.currentVersion.sequence, 2);
  assert.deepEqual(revised.document.versions.map(item => item.sequence), [2, 1]);
  assert.equal(state.versions.find(item => item.sequence === 1).versionLabel, 'Rev. 00');
  await assert.rejects(addProjectDocumentVersion('project_1', created.document.id, {
    expectedVersion: created.document.version, fileName: 'stale.pdf', dataUrl: testPdfDataUrl('stale')
  }, context, { database, rootDir, token: 'stale' }), error => error.code === 'PROJECT_DOCUMENT_VERSION_CONFLICT');

  const archived = await archiveProjectDocument('project_1', created.document.id, { expectedVersion: revised.document.version }, context, { database, rootDir });
  assert.ok(archived.document.archivedAt);
  assert.equal((await listProjectDocuments('project_1', {}, context, { database, rootDir })).documents.length, 0);
  const restored = await restoreProjectDocument('project_1', created.document.id, { expectedVersion: archived.document.version }, context, { database, rootDir });
  assert.equal(restored.document.archivedAt, null);
  assert.equal((await listProjectDocuments('project_1', {}, context, { database, rootDir })).documents.length, 1);
});

test('aceite registra autoria e uma nova versão reinicia a decisão e invalida autorização', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'filtro-project-acceptance-'));
  const { database, state } = createProjectDocumentsDatabase({ stage: 'MOBILIZATION' });
  const created = await createProjectDocument('project_1', {
    type: 'CONTRACT', title: 'Contrato aceito', acceptanceMode: 'CLIENT', requirementStage: 'MOBILIZATION',
    initialVersion: { fileName: 'contrato.pdf', dataUrl: testPdfDataUrl('aceite') }
  }, context, { database, rootDir, token: 'accept' });
  const accepted = await recordProjectDocumentAcceptance('project_1', created.document.id, {
    expectedVersion: created.document.version,
    versionId: created.document.currentVersion.id,
    status: 'ACCEPTED',
    occurredOn: '2026-09-10',
    reference: 'E-mail do cliente'
  }, context, { database, rootDir, now: new Date('2026-09-10T15:00:00Z') });
  assert.equal(accepted.document.currentVersion.acceptanceStatus, 'ACCEPTED');
  assert.equal(accepted.document.currentVersion.acceptanceRecordedBy.id, 'leader_1');
  assert.equal(accepted.document.currentVersion.acceptanceOccurredOn, '2026-09-10');

  state.project.workflow.mobilizationAuthorizedAt = new Date('2026-09-10T16:00:00Z');
  state.project.workflow.mobilizationAuthorizationVersion = state.project.workflow.version;
  const revised = await addProjectDocumentVersion('project_1', created.document.id, {
    expectedVersion: accepted.document.version,
    fileName: 'contrato-rev2.pdf',
    dataUrl: testPdfDataUrl('nova decisão')
  }, context, { database, rootDir, token: 'accept2' });
  assert.equal(revised.document.currentVersion.acceptanceStatus, 'PENDING');
  assert.equal(revised.authorizationInvalidated, true);
  assert.equal(state.project.workflow.mobilizationAuthorizedAt, null);
  assert.ok(state.events.some(item => item.action === 'MOBILIZATION_AUTHORIZATION_INVALIDATED'));
});

test('projeto encerrado permanece somente leitura', async () => {
  const { database, state } = createProjectDocumentsDatabase({ stage: 'FINISHED' });
  state.project.isActive = false;
  await assert.rejects(createProjectDocument('project_1', {
    type: 'OTHER', title: 'Documento tardio', acceptanceMode: 'NONE'
  }, context, { database }), error => error.code === 'PROJECT_FINISHED');
});

test('reclassificação exige permissão sobre o tipo atual e o novo tipo', async () => {
  const { database } = createProjectDocumentsDatabase();
  const created = await createProjectDocument('project_1', {
    type: 'TECHNICAL_PROPOSAL', title: 'Proposta técnica', acceptanceMode: 'NONE'
  }, context, { database });
  const commercialContext = {
    actorUserId: 'commercial_1',
    user: { id: 'commercial_1', name: 'Comercial', accountType: 'USER', moduleRoles: [{ module: 'EFETIVO', role: 'EFETIVO_COMMERCIAL' }] }
  };

  await assert.rejects(updateProjectDocument('project_1', created.document.id, {
    expectedVersion: created.document.version,
    type: 'COMMERCIAL_PROPOSAL'
  }, commercialContext, { database }), error => error.code === 'PROJECT_DOCUMENT_FORBIDDEN');
});
