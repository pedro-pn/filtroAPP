import assert from 'node:assert/strict';
import test from 'node:test';

import { projectDocumentReadiness, projectDocumentRequirements } from '../src/lib/efetivo/project-workflow/documents.js';

function document(overrides = {}) {
  return {
    id: 'doc_1', type: 'CONTRACT', title: 'Contrato', archivedAt: null, requirementStage: 'MOBILIZATION', acceptanceMode: 'NONE',
    currentVersion: { id: 'ver_1', documentId: 'doc_1', contentKind: 'EXTERNAL_REFERENCE', externalUrl: 'https://crm.example/doc', acceptanceStatus: 'NOT_REQUIRED', signatureDocument: null },
    ...overrides
  };
}

test('projetos sem requisitos documentais continuam prontos', () => {
  const requirements = projectDocumentRequirements([]);
  assert.deepEqual(requirements.MOBILIZATION, { ready: true, readyCount: 0, totalCount: 0, blockers: [] });
  assert.equal(requirements.HANDOVER.ready, true);
  assert.equal(requirements.CLOSEOUT.ready, true);
});

test('versão ausente, conteúdo inacessível e arquivamento produzem motivos localizados', () => {
  assert.equal(projectDocumentReadiness(document({ currentVersion: null })).reasonCode, 'MISSING_VERSION');
  assert.equal(projectDocumentReadiness(document({ currentVersion: { id: 'ver_1', documentId: 'doc_1', contentKind: 'EXTERNAL_REFERENCE', externalUrl: null } })).reasonCode, 'CONTENT_UNAVAILABLE');
  assert.equal(projectDocumentReadiness(document({ archivedAt: new Date() })).reasonCode, 'ARCHIVED');
});

test('aceite manual e assinatura avaliam somente a versão vigente', () => {
  const pending = document({ acceptanceMode: 'CLIENT', currentVersion: { ...document().currentVersion, acceptanceStatus: 'PENDING' } });
  assert.equal(projectDocumentReadiness(pending).reasonCode, 'ACCEPTANCE_PENDING');
  assert.equal(projectDocumentReadiness({ ...pending, currentVersion: { ...pending.currentVersion, acceptanceStatus: 'REJECTED' } }).reasonCode, 'ACCEPTANCE_REJECTED');
  assert.equal(projectDocumentReadiness({ ...pending, currentVersion: { ...pending.currentVersion, acceptanceStatus: 'ACCEPTED' } }).ready, true);
  const signed = document({ acceptanceMode: 'SIGNATURE', currentVersion: { ...document().currentVersion, signatureDocument: { status: 'CONCLUIDO', finalStoragePath: 'Assinaturas/final.pdf', deletedAt: null } } });
  assert.equal(projectDocumentReadiness(signed).ready, true);
  assert.equal(projectDocumentReadiness({ ...signed, currentVersion: { ...signed.currentVersion, signatureDocument: { status: 'EM_ASSINATURA', finalStoragePath: null, deletedAt: null } } }).reasonCode, 'SIGNATURE_PENDING');
});

test('resume requisitos por etapa sem transformar documentos opcionais em bloqueios', () => {
  const requirements = projectDocumentRequirements([
    document(),
    document({ id: 'doc_2', requirementStage: 'CLOSEOUT', currentVersion: null, title: 'Relatório final' }),
    document({ id: 'doc_3', requirementStage: null, currentVersion: null, title: 'Opcional' })
  ]);
  assert.equal(requirements.MOBILIZATION.ready, true);
  assert.equal(requirements.CLOSEOUT.ready, false);
  assert.equal(requirements.CLOSEOUT.blockers[0].title, 'Relatório final');
});
