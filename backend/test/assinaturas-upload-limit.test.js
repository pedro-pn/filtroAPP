import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import app from '../src/app.js';
import env from '../src/config/env.js';
import prisma from '../src/lib/prisma.js';

test('API recebe e armazena um PDF válido de 25,7 MB sem rejeição 413', async t => {
  const original = prisma.userSession.findUnique;
  prisma.userSession.findUnique = async () => ({ id: 'upload-limit-session', expiresAt: new Date(Date.now() + 60000), user: {
    id: 'upload-limit-user', username: 'upload-test', name: 'Teste de upload', isActive: true,
    accountType: 'INTERNAL', role: 'COLLABORATOR', moduleRoles: [{ role: 'ASSINATURAS_USER' }]
  } });
  t.after(() => { prisma.userSession.findUnique = original; });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'filtro-signature-upload-'));
  const originalUploadDir = env.uploadDir;
  env.uploadDir = root;
  t.after(async () => { env.uploadDir = originalUploadDir; await fs.rm(root, { recursive: true, force: true }); });
  const stub = (target, name, implementation) => {
    const previous = target[name];
    target[name] = implementation;
    t.after(() => { target[name] = previous; });
  };
  let auditCount = 0;
  stub(prisma, '$transaction', async operation => operation(prisma));
  stub(prisma.signatureDocument, 'create', async ({ data }) => ({ id: 'upload-document', ...data }));
  stub(prisma.signatureDocumentAuditLog, 'create', async () => { auditCount++; return { id: 'upload-audit' }; });
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  const bytes = Buffer.alloc(Math.ceil(25.7 * 1024 * 1024), 32);
  Buffer.from(await pdf.save()).copy(bytes);
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/assinaturas/documentos?fileName=teste.pdf`, {
    method: 'POST', headers: { Authorization: 'Bearer upload-limit-test', 'Content-Type': 'application/pdf' }, body: bytes
  });
  assert.equal(response.status, 201);
  const document = await response.json();
  assert.equal(document.pageCount, 1);
  assert.equal(document.fileSizeBytes, bytes.length);
  assert.equal((await fs.stat(path.join(root, document.sourceStoragePath))).size, bytes.length);
  assert.equal(auditCount, 1);
});

test('Compose substitui o limite legado de 20 MB pelos 200 MB anunciados em todos os ambientes', async t => {
  const available = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' });
  if (available.status !== 0) { t.skip('Docker Compose indisponível'); return; }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'filtro-signature-limit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'backend'));
  for (const name of ['production', 'staging', 'docker.local']) {
    await fs.writeFile(path.join(root, 'backend', `.env.${name}`), 'ASSINATURAS_MAX_PDF_MB=20\n');
  }
  for (const name of ['prod', 'staging', 'local']) {
    const file = `docker-compose.${name}.yml`;
    await fs.copyFile(new URL(`../../${file}`, import.meta.url), path.join(root, file));
    const result = spawnSync('docker', ['compose', '--project-directory', root, '-f', path.join(root, file), 'config', '--format', 'json'], {
      encoding: 'utf8', env: { ...process.env, POSTGRES_PASSWORD: 'test-only', STAGING_POSTGRES_PASSWORD: 'test-only' }
    });
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(result.stdout);
    for (const service of name === 'prod' ? ['backend', 'worker'] : ['backend']) {
      assert.equal(config.services[service].environment.ASSINATURAS_MAX_PDF_MB, '200', `${name}/${service}`);
    }
  }
});
