import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createStockItemDocument,
  removeStockItemDocument,
  resolvePublicStockAttachment,
  serializeStockItemDocument,
  stockAttachmentFileName
} from '../src/lib/estoque/stock-attachments.js';

function pdfUpload(fileName = 'FDS produto.pdf') {
  const bytes = Buffer.from('%PDF-1.4\n% documento de teste\n');
  return {
    fileName,
    dataUrl: `data:application/pdf;base64,${bytes.toString('base64')}`
  };
}

function documentClient(initialDocument = null) {
  let current = initialDocument;
  return {
    stockItemDocument: {
      async create({ data }) {
        current = {
          id: 'document-1',
          createdAt: new Date('2026-08-20T12:00:00.000Z'),
          ...data
        };
        return current;
      },
      async findFirst({ where }) {
        return current?.id === where.id && current?.itemId === where.itemId ? current : null;
      },
      async findUnique({ where }) {
        return current?.publicToken === where.publicToken
          ? { ...current, item: { id: current.itemId, code: 'PQ-001', name: 'Produto químico' } }
          : null;
      },
      async delete({ where }) {
        const removed = current?.id === where.id ? current : null;
        current = null;
        return removed;
      }
    }
  };
}

test('documentos de itens do estoque são gravados, expostos e removidos com o arquivo físico', async t => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'estoque-documentos-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const client = documentClient();

  const document = await createStockItemDocument(
    client,
    { itemId: 'item-1', upload: pdfUpload() },
    { rootDir }
  );

  assert.equal(document.fileName, 'FDS produto.pdf');
  assert.match(document.storagePath, /^Estoque\/Documentos\//);
  assert.equal((await fs.readFile(path.join(rootDir, document.storagePath))).subarray(0, 4).toString(), '%PDF');

  const serialized = serializeStockItemDocument(document);
  assert.equal(serialized.fileName, 'FDS produto.pdf');
  assert.match(serialized.publicUrl, /\/api\/estoque-anexos\//);

  const resolved = await resolvePublicStockAttachment(document.publicToken, client, { rootDir });
  assert.equal(resolved.targetPath, path.join(rootDir, document.storagePath));
  assert.equal(stockAttachmentFileName(resolved), 'FDS produto.pdf');

  const removed = await removeStockItemDocument(
    client,
    { itemId: 'item-1', documentId: document.id },
    { rootDir }
  );
  assert.equal(removed.id, document.id);
  await assert.rejects(fs.access(path.join(rootDir, document.storagePath)));
});

test('documentos do estoque rejeitam arquivos que não são PDFs válidos', async t => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'estoque-documentos-invalidos-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const client = documentClient();

  await assert.rejects(
    createStockItemDocument(client, {
      itemId: 'item-1',
      upload: {
        fileName: 'ficha.txt',
        dataUrl: `data:text/plain;base64,${Buffer.from('texto').toString('base64')}`
      }
    }, { rootDir }),
    /PDF/
  );
});

test('FISPQs migradas continuam resolvendo o arquivo armazenado na pasta legada', async t => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'estoque-fispq-legada-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const publicToken = 'legacy-public-token';
  const legacyDir = path.join(rootDir, 'Estoque', 'FISPQ');
  const legacyPath = path.join(legacyDir, `FISPQ-${publicToken}.pdf`);
  await fs.mkdir(legacyDir, { recursive: true });
  await fs.writeFile(legacyPath, Buffer.from('%PDF-1.4\n% legado\n'));
  const client = documentClient({
    id: 'legacy-document-1',
    itemId: 'item-1',
    fileName: 'FISPQ antiga.pdf',
    mimeType: 'application/pdf',
    storagePath: null,
    publicToken,
    createdAt: new Date('2026-07-09T12:00:00.000Z')
  });

  const resolved = await resolvePublicStockAttachment(publicToken, client, { rootDir });

  assert.equal(resolved.targetPath, legacyPath);
  assert.equal(stockAttachmentFileName(resolved), 'FISPQ antiga.pdf');
});
