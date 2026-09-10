import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  addProjectDocumentVersion,
  aggregateProjectOperationalDocuments,
  createProjectDocument,
  prepareProjectDocumentSignature
} from '../src/lib/efetivo/project-workflow/documents.js';
import { createProjectDocumentsDatabase, testPdfDataUrl } from './helpers/project-documents-db.js';

const context = { actorUserId: 'leader_1', isManager: true, user: { id: 'leader_1', name: 'Líder', accountType: 'ADMIN' } };

test('assinatura reutiliza o PDF vigente, é idempotente e permanece na versão superada', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'filtro-project-signature-'));
  const { database, state } = createProjectDocumentsDatabase();
  const created = await createProjectDocument('project_1', {
    type: 'CONTRACT', title: 'Contrato para assinatura', acceptanceMode: 'SIGNATURE', requirementStage: null,
    initialVersion: { versionLabel: 'Rev. 00', fileName: 'contrato.pdf', dataUrl: testPdfDataUrl('assinatura') }
  }, context, { database, rootDir, token: 'signature' });
  let createCalls = 0;
  const createSignatureDocument = async (_tx, input) => {
    createCalls += 1;
    assert.match(input.pdfDataUrl, /^data:application\/pdf;base64,/);
    const signature = { id: 'signature_1', status: 'RASCUNHO', originalFileName: input.fileName, finalStoragePath: null, completedAt: null, archivedAt: null, deletedAt: null };
    state.signatures.push(signature);
    return signature;
  };
  const prepared = await prepareProjectDocumentSignature('project_1', created.document.id, {
    expectedVersion: created.document.version,
    versionId: created.document.currentVersion.id
  }, context, { database, rootDir, createSignatureDocument });
  assert.equal(prepared.signatureDocumentId, 'signature_1');
  const currentDocument = state.documents[0];
  const replay = await prepareProjectDocumentSignature('project_1', currentDocument.id, {
    expectedVersion: currentDocument.version,
    versionId: currentDocument.currentVersionId
  }, context, { database, rootDir, createSignatureDocument });
  assert.equal(replay.signatureDocumentId, 'signature_1');
  assert.equal(createCalls, 1);

  const revised = await addProjectDocumentVersion('project_1', currentDocument.id, {
    expectedVersion: currentDocument.version,
    versionLabel: 'Rev. 01',
    fileName: 'contrato-rev1.pdf',
    dataUrl: testPdfDataUrl('nova versão')
  }, context, { database, rootDir, token: 'signature2' });
  assert.equal(revised.document.currentVersion.signature, null);
  assert.equal(revised.document.versions.find(item => item.sequence === 1).signature.id, 'signature_1');
});

test('RDOs e relatórios são projeções do módulo operacional sem duplicar o catálogo', async () => {
  const { database, state } = createProjectDocumentsDatabase();
  state.reports.push(
    { id: 'rdo_1', reportType: 'RDO', sequenceNumber: 7, status: 'APPROVED', reportDate: new Date('2026-09-09'), approvedAt: new Date('2026-09-10'), createdAt: new Date('2026-09-09'), clientReviews: [{ action: 'APPROVED', createdAt: new Date('2026-09-10') }] },
    { id: 'rtp_1', reportType: 'RTP', sequenceNumber: 2, status: 'SIGNED', reportDate: new Date('2026-09-08'), approvedAt: null, createdAt: new Date('2026-09-08'), clientReviews: [] }
  );
  const documents = await aggregateProjectOperationalDocuments(database, 'project_1');
  assert.equal(documents.length, 2);
  assert.equal(documents[0].kind, 'RDO');
  assert.equal(documents[0].acceptedAt, '2026-09-10T00:00:00.000Z');
  assert.match(documents[1].downloadUrl, /\/api\/rdo\/reports\/rtp_1\/pdf/);
  assert.equal(state.documents.length, 0);
});
