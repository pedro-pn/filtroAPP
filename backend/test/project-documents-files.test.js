import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  parseProjectDocumentUpload,
  projectDocumentFolderParts,
  removeProjectDocumentFile,
  resolveProjectDocumentFile,
  resolveProjectDocumentStoragePath,
  storeProjectDocumentFile,
  withProjectDocumentFileRollback
} from '../src/lib/efetivo/project-workflow/documents.js';
import { createProjectDocumentsDatabase, testPdfDataUrl } from './helpers/project-documents-db.js';

test('valida extensão, MIME, assinatura binária e limite do arquivo', () => {
  const parsed = parseProjectDocumentUpload('proposta.pdf', testPdfDataUrl());
  assert.equal(parsed.mimeType, 'application/pdf');
  assert.equal(parsed.sha256.length, 64);
  assert.throws(() => parseProjectDocumentUpload('proposta.exe', testPdfDataUrl()), error => error.code === 'PROJECT_DOCUMENT_TYPE_UNSUPPORTED');
  assert.throws(() => parseProjectDocumentUpload('proposta.pdf', 'data:application/pdf;base64,QUJDRA=='), error => error.code === 'PROJECT_DOCUMENT_TYPE_UNSUPPORTED');
  assert.throws(() => parseProjectDocumentUpload('proposta.pdf', testPdfDataUrl('conteúdo extenso'), { maximumMb: 0.000001 }), error => error.code === 'PROJECT_DOCUMENT_TOO_LARGE');
});

test('constrói pasta segura, impede traversal e remove órfão após falha', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'filtro-project-doc-'));
  const project = { id: 'project/../../1', code: 'OBR:01' };
  const parsed = parseProjectDocumentUpload('../contrato.pdf', testPdfDataUrl());
  const parts = projectDocumentFolderParts(project, 'CONTRACT');
  assert.deepEqual(parts, ['Projetos', 'OBR_01-project_.._.._1', 'Documentos', 'CONTRACT']);
  const storagePath = await storeProjectDocumentFile(project, 'CONTRACT', parsed, { rootDir, token: 'safe' });
  assert.ok(resolveProjectDocumentStoragePath(storagePath, { rootDir }));
  assert.equal(resolveProjectDocumentStoragePath('../secret.pdf', { rootDir }), null);
  await assert.rejects(withProjectDocumentFileRollback(storagePath, async () => { throw new Error('db failed'); }, { rootDir }), /db failed/);
  assert.equal(resolveProjectDocumentStoragePath(storagePath, { rootDir }), null);
  assert.equal(await removeProjectDocumentFile(storagePath, { rootDir }), false);
});

test('resolve download somente após validar projeto e vínculo da versão', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'filtro-project-download-'));
  const { database, state } = createProjectDocumentsDatabase();
  const parsed = parseProjectDocumentUpload('evidencia.pdf', testPdfDataUrl());
  const storagePath = await storeProjectDocumentFile(state.project, 'TECHNICAL_EVIDENCE', parsed, { rootDir, token: 'download' });
  state.documents.push({ id: 'doc_1', projectId: 'project_1', type: 'TECHNICAL_EVIDENCE', title: 'Evidência', version: 1, currentVersionId: 'ver_1' });
  state.versions.push({ id: 'ver_1', documentId: 'doc_1', contentKind: 'MANAGED_FILE', storagePath, mimeType: 'application/pdf', originalFileName: 'evidencia.pdf' });
  const file = await resolveProjectDocumentFile('project_1', 'doc_1', 'ver_1', {}, { database, rootDir });
  assert.equal(file.targetPath, resolveProjectDocumentStoragePath(storagePath, { rootDir }));
  assert.match(file.disposition, /inline/);
  await assert.rejects(resolveProjectDocumentFile('project_1', 'other', 'ver_1', {}, { database, rootDir }), error => error.code === 'PROJECT_DOCUMENT_NOT_FOUND');
});
