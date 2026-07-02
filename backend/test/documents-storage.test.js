import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  inlineContentDisposition,
  publicPathForToken,
  publicUrlForPath,
  resolveManagedDocumentPath,
  unlinkManagedDocumentFile,
  writeManagedDocumentFile
} from '../src/lib/documents/storage.js';

test('writeManagedDocumentFile writes under a managed root and returns a posix path', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'documents-storage-'));

  const storagePath = await writeManagedDocumentFile({
    rootDir,
    folderParts: ['Equipamentos', 'Documentos'],
    token: 'token-1',
    fileName: 'Ficha técnica.pdf',
    bytes: Buffer.from('%PDF fake'),
    extension: 'pdf'
  });

  assert.match(storagePath, /^Equipamentos\/Documentos\/Ficha técnica-token-1\.pdf$/);
  const targetPath = resolveManagedDocumentPath(storagePath, { rootDir, requiredPrefix: 'Equipamentos/' });
  assert.equal(await fs.readFile(targetPath, 'utf8'), '%PDF fake');
});

test('resolveManagedDocumentPath rejects traversal outside the managed root', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'documents-storage-'));

  assert.equal(resolveManagedDocumentPath('../secret.pdf', { rootDir }), null);
  assert.equal(resolveManagedDocumentPath('/tmp/secret.pdf', { rootDir }), null);
});

test('unlinkManagedDocumentFile removes files only inside the required prefix', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'documents-storage-'));
  const storagePath = await writeManagedDocumentFile({
    rootDir,
    folderParts: ['Equipamentos'],
    token: 'token-2',
    fileName: 'arquivo.pdf',
    bytes: Buffer.from('content'),
    extension: 'pdf'
  });

  assert.equal(await unlinkManagedDocumentFile(storagePath, { rootDir, requiredPrefix: 'Outros/' }), false);
  assert.ok(resolveManagedDocumentPath(storagePath, { rootDir }));
  assert.equal(await unlinkManagedDocumentFile(storagePath, { rootDir, requiredPrefix: 'Equipamentos/' }), true);
  assert.equal(resolveManagedDocumentPath(storagePath, { rootDir }), null);
});

test('public helpers keep URL and Content-Disposition generation reusable', () => {
  const pathValue = publicPathForToken('/api/documentos', 'a/b');
  assert.equal(pathValue, '/api/documentos/a%2Fb');
  assert.equal(publicUrlForPath(pathValue, 'https://app.example.com/'), 'https://app.example.com/api/documentos/a%2Fb');
  assert.match(inlineContentDisposition('Certificado técnico.pdf'), /^inline; filename="Certificado tecnico\.pdf";/);
});
