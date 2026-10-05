import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream
} from 'pdf-lib';

import {
  buildFinalPdfBytes,
  normalizedFieldToPdfRect
} from '../src/lib/assinaturas/final-pdf.js';
import {
  persistFinalBytes,
  processDocumentFinalization,
  processPendingFinalizations
} from '../src/lib/assinaturas/jobs.js';
import {
  createStandaloneValidationCode,
  validateByCode
} from '../src/lib/assinaturas/service.js';

const signatureImageDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

function pageContent(pdf, page) {
  const contents = page.node.Contents();
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  return refs.filter(Boolean).map(ref => {
    const stream = pdf.context.lookup(ref, PDFRawStream);
    return Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
  }).join('\n');
}

function finalizingDocument(overrides = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    status: 'FINALIZANDO',
    finalizationClaimedAt: null,
    finalizationAttempts: 0,
    sourceStoragePath: 'Assinaturas/Documentos/source.pdf',
    sourceDocumentHash: 'a'.repeat(64),
    signers: [],
    fields: [],
    owner: { email: 'owner@example.com', notifySignaturesByEmail: true },
    ...overrides
  };
}

function finalizationClient(initialDocument) {
  const state = { document: initialDocument, audits: [], notifications: [] };
  const client = {
    signatureDocument: {
      async updateMany({ where, data }) {
        const document = state.document;
        if (where.id !== document.id || (where.status && where.status !== document.status)) return { count: 0 };
        if (data.finalizationAttempts) {
          const staleBoundary = where.OR?.find(item => item.finalizationClaimedAt?.lte)?.finalizationClaimedAt?.lte;
          const claimAvailable = document.finalizationClaimedAt == null
            || (staleBoundary && new Date(document.finalizationClaimedAt).getTime() <= new Date(staleBoundary).getTime());
          if (!claimAvailable) return { count: 0 };
          document.finalizationAttempts += data.finalizationAttempts.increment;
        }
        for (const [key, value] of Object.entries(data)) {
          if (key !== 'finalizationAttempts') document[key] = value;
        }
        return { count: 1 };
      },
      async findUnique({ select } = {}) {
        if (select?.finalizationAttempts) return { finalizationAttempts: state.document.finalizationAttempts };
        return state.document;
      }
    },
    signatureDocumentAuditLog: {
      async create({ data }) {
        state.audits.push(data);
        return data;
      }
    },
    signatureDocumentCompletionNotification: {
      async upsert({ create }) {
        if (!state.notifications.some(item => item.documentId === create.documentId)) state.notifications.push(create);
        return create;
      }
    },
    async $transaction(operation) {
      return operation(client);
    }
  };
  return { client, state };
}

test('transformação afim cobre 0, 90, 180 e 270 graus com CropBox', () => {
  const field = { x: 0.1, y: 0.2, width: 0.3, height: 0.1 };
  const geometry = { x: 10, y: 20, width: 600, height: 800 };

  assert.deepEqual(normalizedFieldToPdfRect(field, { ...geometry, rotation: 0 }), {
    x: 70, y: 580, width: 180, height: 80
  });
  assert.deepEqual(normalizedFieldToPdfRect(field, { ...geometry, rotation: 90 }), {
    x: 130, y: 100, width: 60, height: 240
  });
  assert.deepEqual(normalizedFieldToPdfRect(field, { ...geometry, rotation: 180 }), {
    x: 370, y: 180, width: 180, height: 80
  });
  assert.deepEqual(normalizedFieldToPdfRect(field, { ...geometry, rotation: 270 }), {
    x: 430, y: 500, width: 60, height: 240
  });
});

test('builder recusa hash-base divergente e gera PDF com evidências', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  const sourceBytes = Buffer.from(await pdf.save());
  const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
  const snapshot = {
    id: 'document-1',
    title: 'Contrato',
    originalFileName: 'contrato.pdf',
    requesterNameSnapshot: 'Pedro Paulo',
    validationCode: 'validation-code-123456789',
    sourceDocumentHash: sourceHash,
    signers: [{
      id: 'signer-1',
      name: 'Maria Silva',
      email: null,
      declaredSignerName: 'Maria Silva',
      signatureImageDataUrl,
      signedAt: new Date('2026-08-28T12:00:00.000Z'),
      ipAddress: '127.0.0.1',
      userAgent: 'Unit Test'
    }],
    fields: [{
      signerId: 'signer-1', pageNumber: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.1
    }]
  };

  await assert.rejects(
    () => buildFinalPdfBytes({ ...snapshot, sourceDocumentHash: '0'.repeat(64) }, sourceBytes),
    error => error?.statusCode === 409
  );
  const finalBytes = await buildFinalPdfBytes(snapshot, sourceBytes);
  const finalPdf = await PDFDocument.load(finalBytes);
  assert.equal(finalPdf.getPageCount(), 2);
  const documentPageContent = pageContent(finalPdf, finalPdf.getPage(0));
  assert.match(documentPageContent, /\/Image-[^\s]+ Do/);
  const imageTransform = [...documentPageContent.matchAll(/([\d.]+) 0 0 ([\d.]+) 0 0 cm/g)]
    .find(match => Number(match[1]) > 1 && Number(match[2]) > 1);
  assert.ok(imageTransform, 'a assinatura deve ser desenhada no campo do documento');
  assert.ok(Math.abs(Number(imageTransform[1]) - 183.6) < 0.001, 'a largura deve preencher o campo');
  assert.ok(Math.abs(Number(imageTransform[2]) - 79.2) < 0.001, 'a altura deve preencher o campo');
  assert.doesNotMatch(documentPageContent, /1 1 1 rg|0\.15 0\.35 0\.55 RG|417373696E61646F20706F72/);

  const evidencePage = finalPdf.getPages().at(-1);
  assert.ok(evidencePage.node.Annots()?.size() >= 1);
  const xObjects = evidencePage.node.Resources()?.lookup(PDFName.of('XObject'), PDFDict);
  assert.ok(xObjects?.keys().length >= 2, 'a página de evidências deve incorporar logo e assinatura');

  const finalPdfSource = await fs.readFile(new URL('../src/lib/assinaturas/final-pdf.js', import.meta.url), 'utf8');
  assert.match(finalPdfSource, /ASSINATURA ELETRONICA - FILTROVALI/);
  assert.match(finalPdfSource, /LOGO_COLORIDO\.png/);
});

test('PDF concluído contém apenas a assinatura realizada, ignorando campos e evidência do convite revogado', async () => {
  const source = await PDFDocument.create();
  source.addPage([612, 792]);
  const sourceBytes = Buffer.from(await source.save());
  const signed = { id: 'signed', name: 'Maria Silva', status: 'ASSINADO', signatureImageDataUrl, signedAt: new Date('2026-08-28T12:00:00Z') };
  const field = { signerId: 'signed', pageNumber: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.1 };
  const snapshot = {
    title: 'Contrato', sourceDocumentHash: createHash('sha256').update(sourceBytes).digest('hex'),
    signers: [signed, { id: 'revoked', name: 'Carlos Revogado', status: 'REVOGADO', signatureImageDataUrl: null }],
    fields: [field, { ...field, signerId: 'revoked', y: 0.4 }]
  };
  const actual = await PDFDocument.load(await buildFinalPdfBytes(snapshot, sourceBytes));
  const expected = await PDFDocument.load(await buildFinalPdfBytes({ ...snapshot, signers: [signed], fields: [field] }, sourceBytes));
  assert.equal(actual.getPageCount(), 2);
  for (let index = 0; index < 2; index++) {
    assert.equal(pageContent(actual, actual.getPages()[index]), pageContent(expected, expected.getPages()[index]));
  }
});

test('job recupera documentos já presos em pendência depois da revogação e conclui o PDF', async () => {
  const document = finalizingDocument({ status: 'AGUARDANDO_ASSINATURAS', deletedAt: null,
    signers: [{ status: 'ASSINADO', isRequired: true }, { status: 'REVOGADO', isRequired: true }] });
  const { client, state } = finalizationClient(document);
  client.signatureDocumentSigner = { count: async ({ where }) => document.signers.filter(signer =>
    typeof where.status === 'string' ? signer.status === where.status : !where.status.notIn.includes(signer.status)).length };
  client.signatureDocument.findMany = async ({ where }) => {
    if (where.status !== document.status) return [];
    if (where.status === 'AGUARDANDO_ASSINATURAS') {
      assert.deepEqual(where.signers, { some: { status: 'ASSINADO' }, none: { isRequired: true, status: { notIn: ['ASSINADO', 'REVOGADO'] } } });
    }
    return [{ id: document.id }];
  };
  const result = await processPendingFinalizations(client, {
    loadSource: async () => Buffer.from('source'), buildBytes: async () => Buffer.from('signed-pdf'),
    persistBytes: async () => ({ relativePath: 'Assinaturas/Assinados/document-assinado.pdf', hash: 'final-hash' }),
    deliverCompletion: async () => {}
  });
  assert.deepEqual(result, { found: 1, completed: 1 });
  assert.equal(document.status, 'CONCLUIDO');
  assert.equal(document.finalStoragePath, 'Assinaturas/Assinados/document-assinado.pdf');
  assert.equal(state.audits.filter(event => event.action === 'DOCUMENTO_CONCLUIDO').length, 1);
});

test('builder assina a página 100 e preserva o documento completo com evidências', async () => {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < 100; index += 1) pdf.addPage([612, 792]);
  const sourceBytes = Buffer.from(await pdf.save());
  const snapshot = {
    id: 'document-100-pages',
    title: 'Contrato extenso',
    originalFileName: 'contrato.pdf',
    requesterNameSnapshot: 'Pedro Paulo',
    validationCode: 'validation-code-100-pages',
    sourceDocumentHash: createHash('sha256').update(sourceBytes).digest('hex'),
    signers: [{
      id: 'signer-1',
      name: 'Maria Silva',
      declaredSignerName: 'Maria Silva',
      signatureImageDataUrl,
      signedAt: new Date('2026-08-28T12:00:00.000Z')
    }],
    fields: [{
      signerId: 'signer-1', pageNumber: 100, x: 0.1, y: 0.2, width: 0.3, height: 0.1
    }]
  };

  const finalPdf = await PDFDocument.load(await buildFinalPdfBytes(snapshot, sourceBytes));

  assert.equal(finalPdf.getPageCount(), 101);
  assert.match(pageContent(finalPdf, finalPdf.getPage(99)), /\/Image-[^\s]+ Do/);
  assert.ok(finalPdf.getPage(100).node.Annots()?.size() >= 1);
});

test('código de validação é aleatório, único e resolve somente documento concluído', async () => {
  const first = createStandaloneValidationCode();
  const second = createStandaloneValidationCode();
  assert.match(first, /^[A-Za-z0-9_-]{24}$/);
  assert.notEqual(first, second);

  const completed = {
    id: 'document-validated',
    ownerUserId: null,
    requesterNameSnapshot: 'Solicitante histórico',
    title: 'Contrato',
    originalFileName: 'contrato.pdf',
    validationCode: first,
    sourceDocumentHash: 'a'.repeat(64),
    finalDocumentHash: 'b'.repeat(64),
    status: 'CONCLUIDO',
    completedAt: new Date('2026-08-28T15:00:00.000Z'),
    signers: [{
      name: 'Maria Silva', email: 'privado@example.com', declaredSignerName: 'Maria Silva',
      status: 'ASSINADO', signedAt: new Date('2026-08-28T14:00:00.000Z'), ipAddress: '203.0.113.10'
    }]
  };
  const client = {
    signatureDocument: {
      async findUnique({ where }) { return where.validationCode === first ? completed : null; }
    }
  };
  const payload = await validateByCode(client, first);
  assert.equal(payload.status, 'VALID');
  assert.equal(payload.document.requesterNameSnapshot, 'Solicitante histórico');
  assert.equal(JSON.stringify(payload).includes('privado@example.com'), false);
  assert.equal(JSON.stringify(payload).includes('203.0.113.10'), false);
  assert.equal(await validateByCode(client, 'codigo-inexistente-123456'), null);
  completed.status = 'FINALIZANDO';
  assert.equal(await validateByCode(client, first), null);
});

test('finalização promove caminho e hash juntos, audita uma vez e é idempotente', async () => {
  const document = finalizingDocument();
  const { client, state } = finalizationClient(document);
  const now = new Date('2026-08-28T15:00:00.000Z');
  const result = await processDocumentFinalization(client, document.id, {
    now,
    loadSource: async () => Buffer.from('source'),
    buildBytes: async () => Buffer.from('final'),
    persistBytes: async () => ({ relativePath: 'Assinaturas/Assinados/final.pdf', hash: 'b'.repeat(64) })
  });

  assert.equal(result.status, 'CONCLUIDO');
  assert.equal(state.document.finalStoragePath, 'Assinaturas/Assinados/final.pdf');
  assert.equal(state.document.finalDocumentHash, 'b'.repeat(64));
  assert.equal(state.document.completedAt, now);
  assert.deepEqual(state.audits.map(item => item.action), ['PDF_FINAL_GERADO', 'DOCUMENTO_CONCLUIDO']);
  assert.equal(state.notifications.length, 1);

  await processDocumentFinalization(client, document.id, {
    now,
    loadSource: async () => { throw new Error('não deveria reler'); }
  });
  assert.equal(state.audits.length, 2);
  assert.equal(state.notifications.length, 1);
});

test('claim impede duas finalizações concorrentes e claim vencido pode ser retomado', async () => {
  let releaseBuild;
  const buildGate = new Promise(resolve => { releaseBuild = resolve; });
  let builds = 0;
  const now = new Date('2026-08-28T15:00:00.000Z');
  const document = finalizingDocument({ finalizationClaimedAt: new Date(now.getTime() - 10 * 60_000) });
  const { client, state } = finalizationClient(document);
  const dependencies = {
    now,
    loadSource: async () => Buffer.from('source'),
    buildBytes: async () => { builds += 1; await buildGate; return Buffer.from('final'); },
    persistBytes: async () => ({ relativePath: 'Assinaturas/Assinados/final.pdf', hash: 'c'.repeat(64) })
  };

  const first = processDocumentFinalization(client, document.id, dependencies);
  await new Promise(resolve => setImmediate(resolve));
  const second = await processDocumentFinalization(client, document.id, dependencies);
  assert.equal(second.status, 'FINALIZANDO');
  assert.equal(builds, 1);
  releaseBuild();
  await first;

  assert.equal(state.document.status, 'CONCLUIDO');
  assert.equal(state.document.finalizationAttempts, 1);
  assert.deepEqual(state.audits.map(item => item.action), ['PDF_FINAL_GERADO', 'DOCUMENTO_CONCLUIDO']);
});

test('falha mantém FINALIZANDO, libera claim e agenda retry sem persistir detalhe sensível', async () => {
  const now = new Date('2026-08-28T15:00:00.000Z');
  const document = finalizingDocument();
  const { client, state } = finalizationClient(document);

  await assert.rejects(() => processDocumentFinalization(client, document.id, {
    now,
    loadSource: async () => Buffer.from('source'),
    buildBytes: async () => { throw new Error('segredo-do-provider'); }
  }), /segredo-do-provider/);

  assert.equal(state.document.status, 'FINALIZANDO');
  assert.equal(state.document.finalizationClaimedAt, null);
  assert.ok(state.document.finalizationNextAttemptAt > now);
  assert.equal(state.document.finalizationLastError, 'Falha ao gerar ou persistir o PDF final.');
  assert.equal(state.document.finalizationLastError.includes('segredo-do-provider'), false);
  assert.deepEqual(state.audits.map(item => item.action), ['FINALIZACAO_FALHOU']);
});

test('persistência final é atômica e um retry produz um único arquivo íntegro', async t => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'assinaturas-final-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const documentId = '00000000-0000-4000-8000-000000000001';
  const first = await persistFinalBytes(documentId, Buffer.from('primeira-versao'), rootDir);
  const second = await persistFinalBytes(documentId, Buffer.from('versao-recuperada'), rootDir);
  const target = path.join(rootDir, ...second.relativePath.split('/'));
  const files = await fs.readdir(path.dirname(target));

  assert.equal(first.relativePath, second.relativePath);
  assert.deepEqual(files, [path.basename(target)]);
  assert.equal((await fs.readFile(target)).toString(), 'versao-recuperada');
  assert.equal(second.hash, createHash('sha256').update('versao-recuperada').digest('hex'));
});

test('falhas antes e depois do temporário não promovem PDF parcial', async t => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'assinaturas-final-failure-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const documentId = '00000000-0000-4000-8000-000000000002';
  const failingWrite = {
    ...fs,
    async writeFile() { throw new Error('falha antes do temporário'); }
  };
  await assert.rejects(
    () => persistFinalBytes(documentId, Buffer.from('final'), rootDir, { fileSystem: failingWrite }),
    /antes do temporário/
  );

  const failingRename = {
    ...fs,
    async rename() { throw new Error('falha depois do temporário'); }
  };
  await assert.rejects(
    () => persistFinalBytes(documentId, Buffer.from('final'), rootDir, { fileSystem: failingRename }),
    /depois do temporário/
  );
  const directory = path.join(rootDir, 'Assinaturas', 'Assinados');
  assert.deepEqual(await fs.readdir(directory), []);
});

test('queda após rename deixa bytes íntegros e o retry conclui com o mesmo alvo', async t => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'assinaturas-final-crash-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const documentId = '00000000-0000-4000-8000-000000000003';
  await assert.rejects(() => persistFinalBytes(documentId, Buffer.from('final'), rootDir, {
    afterRename: async () => { throw new Error('queda após rename'); }
  }), /queda após rename/);

  const recovered = await persistFinalBytes(documentId, Buffer.from('final'), rootDir);
  const target = path.join(rootDir, ...recovered.relativePath.split('/'));
  assert.equal((await fs.readFile(target)).toString(), 'final');
  assert.deepEqual(await fs.readdir(path.dirname(target)), [path.basename(target)]);
});
