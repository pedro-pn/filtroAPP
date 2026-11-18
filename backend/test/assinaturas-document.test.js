import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { degrees, PDFDocument } from 'pdf-lib';

import { jsonBodyLimitForRequest } from '../src/app.js';
import {
  createDocument,
  finalPdfBuffer,
  pdfMetadata,
  parsePdfUpload,
  sourcePdfBuffer,
  storeSourcePdf
} from '../src/lib/assinaturas/document.js';

function dataUrl(bytes, mimeType = 'application/pdf') {
  return `data:${mimeType};base64,${bytes.toString('base64')}`;
}

test('parser reserva 30 MB só para o upload e mantém 3 MB nas rotas públicas', () => {
  assert.equal(jsonBodyLimitForRequest('POST', '/api/assinaturas/documentos'), '30mb');
  assert.equal(jsonBodyLimitForRequest('GET', '/api/assinaturas/documentos'), '1mb');
  assert.equal(jsonBodyLimitForRequest('POST', '/api/assinaturas/publico/assinar'), '3mb');
  assert.equal(jsonBodyLimitForRequest('GET', '/api/assinaturas/publico'), '3mb');
});

async function samplePdf() {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  const rotated = pdf.addPage([595, 842]);
  rotated.setRotation(degrees(90));
  return Buffer.from(await pdf.save());
}

test('parsePdfUpload valida MIME, magic bytes e limite bruto configurado', () => {
  assert.throws(() => parsePdfUpload('arquivo.pdf', 'data:text/plain;base64,WA=='), /PDF/);
  assert.throws(() => parsePdfUpload('arquivo.pdf', dataUrl(Buffer.from('ZIP!'))), /PDF inválido/);

  const atLimit = Buffer.alloc(20 * 1024 * 1024);
  atLimit.write('%PDF');
  assert.equal(parsePdfUpload('limite.pdf', dataUrl(atLimit)).bytes.length, atLimit.length);

  const aboveLimit = Buffer.alloc((20 * 1024 * 1024) + 1);
  aboveLimit.write('%PDF');
  assert.throws(() => parsePdfUpload('grande.pdf', dataUrl(aboveLimit)), /20 MB/);
});

test('pdfMetadata lê páginas e rotações e rejeita conteúdo ilegível', async () => {
  const bytes = await samplePdf();
  const metadata = await pdfMetadata(bytes);

  assert.equal(metadata.pageCount, 2);
  assert.deepEqual(metadata.pageDimensions.map(page => page.rotation), [0, 90]);
  assert.equal(metadata.pageDimensions[0].widthPt, 612);
  await assert.rejects(() => pdfMetadata(Buffer.from('%PDF-invalido')), /PDF inválido/);
});

test('storage da assinatura fica sob Assinaturas e revalida o hash', async t => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'assinaturas-document-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const bytes = await samplePdf();
  const storagePath = await storeSourcePdf({
    fileName: 'contrato.pdf',
    bytes,
    rootDir,
    token: 'document-1'
  });
  const hash = createHash('sha256').update(bytes).digest('hex');

  assert.match(storagePath, /^Assinaturas\/Documentos\//);
  assert.deepEqual(await sourcePdfBuffer({ sourceStoragePath: storagePath, sourceDocumentHash: hash }, { rootDir }), bytes);
  await assert.rejects(
    () => sourcePdfBuffer({ sourceStoragePath: storagePath, sourceDocumentHash: '0'.repeat(64) }, { rootDir }),
    error => error?.statusCode === 409
  );
  await assert.rejects(
    () => sourcePdfBuffer({ sourceStoragePath: '../fora.pdf', sourceDocumentHash: hash }, { rootDir }),
    error => error?.statusCode === 404
  );

  const finalRelativePath = 'Assinaturas/Assinados/document-1-assinado.pdf';
  const finalPath = path.join(rootDir, ...finalRelativePath.split('/'));
  await fs.mkdir(path.dirname(finalPath), { recursive: true });
  await fs.writeFile(finalPath, bytes);
  assert.deepEqual(await finalPdfBuffer({
    status: 'CONCLUIDO',
    finalStoragePath: finalRelativePath,
    finalDocumentHash: hash
  }, { rootDir }), bytes);
  await fs.writeFile(finalPath, Buffer.from('adulterado'));
  await assert.rejects(() => finalPdfBuffer({
    status: 'CONCLUIDO',
    finalStoragePath: finalRelativePath,
    finalDocumentHash: hash
  }, { rootDir }), error => error?.statusCode === 409);
});

test('createDocument compensa o arquivo quando a criação no banco falha', async () => {
  const bytes = await samplePdf();
  let removedPath = null;
  const client = {
    async $transaction(callback) {
      return callback({
        signatureDocument: {
          async create() {
            throw new Error('database unavailable');
          }
        }
      });
    }
  };

  await assert.rejects(
    () => createDocument(client, {
      ownerUserId: 'user-1',
      requesterNameSnapshot: 'Maria Souza',
      fileName: 'contrato.pdf',
      pdfDataUrl: dataUrl(bytes)
    }, {
      storeSourcePdf: async () => 'Assinaturas/Documentos/contrato.pdf',
      removeStoredPdf: async storagePath => {
        removedPath = storagePath;
      }
    }),
    /database unavailable/
  );

  assert.equal(removedPath, 'Assinaturas/Documentos/contrato.pdf');
});
