import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { PDFDocument, PDFName, PDFDict, StandardFonts } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PGlite } from '@electric-sql/pglite';

import {
  appendEpiEvidencePages, epiEvidenceGroups, epiSha256,
  epiSignatureImageHash, epiValidationUrl
} from '../src/lib/epi/evidence-pdf.js';
import {
  confirmPublicEpiSignatureRequest, createSignedPublicPdfArtifact,
  publicEpiValidationPayload
} from '../src/routes/resources/epis.js';

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
const signedAt = new Date('2026-10-05T12:00:00Z');
const code = 'A'.repeat(24);

function record(id, request, overrides = {}) {
  return {
    id, epiName: `Capacete ${id}`, ca: '12345', quantity: 1,
    lendDate: new Date('2026-10-01T15:00:00Z'), createdAt: new Date('2026-10-01T15:00:00Z'),
    signedAt, signatureRequestId: request?.id, signatureRequest: request,
    ...overrides
  };
}

function request(id = 'request-1', overrides = {}) {
  return {
    id, status: 'SIGNED', signedAt, signatureSignerName: 'João da Silva',
    signatureImageDataUrl: image, ipAddress: '203.0.113.10', userAgent: 'Test Browser',
    createdAt: new Date('2026-10-01T12:00:00Z'),
    sourceDocumentHash: 'b'.repeat(64), signedPdfHash: 'c'.repeat(64), validationCode: code,
    privacyNoticeVersion: 'signature_epi_v1', privacyNoticeAcceptedAt: signedAt,
    auditLogs: [{ action: 'VIEWED', createdAt: signedAt }, { action: 'PDF_DOWNLOADED', createdAt: signedAt }],
    ...overrides
  };
}

async function basePdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText('Ficha de Controle de EPIs', { x: 42, y: 780, font, size: 12 });
  return Buffer.from(await pdf.save());
}

async function pageTexts(bytes) {
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes), useSystemFonts: false, isEvalSupported: false,
    standardFontDataUrl: fileURLToPath(new URL('./standard_fonts/', import.meta.resolve('pdfjs-dist/package.json')))
  });
  try {
    const pdf = await task.promise;
    const texts = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      texts.push(content.items.map(item => item.str).join('\n'));
      for (const item of content.items) {
        if (!item.str) continue;
        assert.ok(item.transform[4] >= 41 && item.transform[4] + item.width <= 554,
          `Text stays inside horizontal margins: ${item.str}`);
        assert.ok(item.transform[5] >= 27, `Text stays above page footer: ${item.str}`);
      }
    }
    return texts;
  } finally { await task.destroy(); }
}

test('unsigned sheets have no evidence appendix', async () => {
  const source = await basePdf();
  const result = await appendEpiEvidencePages(source, { name: 'Colaborador', epiRecords: [record('unsigned', null, { signedAt: null })] });
  assert.equal(result.bytes, source);
  assert.equal(result.signedPdfHash, epiSha256(source));
});

test('multiple items and successive signatures share one compact appendix with audit, hashes and validation links', async () => {
  const first = request();
  const second = request('request-2', { signedAt: new Date('2026-10-05T13:00:00Z'), validationCode: 'B'.repeat(24) });
  const unsigned = record('unsigned', null, { signedAt: null });
  const records = [record('r2', first), record('r1', first), record('r3', second), unsigned];
  const source = await basePdf();
  const result = await appendEpiEvidencePages(source, { name: 'João', epiRecords: records });
  const texts = await pageTexts(result.bytes);
  assert.equal(texts.length, 2, 'one sheet plus one consolidated evidence page');
  const appendix = texts[1];
  assert.equal((appendix.match(/Assinatura \d \|/g) || []).length, 2);
  for (const value of ['Linha 1: Capacete r1', 'Linha 2: Capacete r2', 'Linha 3: Capacete r3', '203.0.113.10',
    'Test Browser', '2026-10-05T12:00:00.000Z', 'Visualizações: 1', 'Downloads: 1',
    first.sourceDocumentHash, first.signedPdfHash, epiSignatureImageHash(image), epiSha256(source)]) {
    assert.ok(appendix.includes(value), `Appendix includes ${value}`);
  }
  assert.equal(appendix.includes('Capacete unsigned'), false);
  assert.equal(result.signedPdfHash, epiSha256(result.bytes));
  const pdf = await PDFDocument.load(result.bytes);
  const links = pdf.getPage(1).node.Annots().asArray().map(ref => {
    const annotation = pdf.context.lookup(ref, PDFDict);
    return annotation.lookup(PDFName.of('A'), PDFDict).get(PDFName.of('URI')).decodeText();
  });
  assert.deepEqual(links, [epiValidationUrl(code), epiValidationUrl(second.validationCode)]);

  const next = await appendEpiEvidencePages(source, { name: 'João', epiRecords: [...records, record('r4', request('request-3'))] });
  assert.equal((await PDFDocument.load(next.bytes)).getPageCount(), 2, 'reissuing adds entries, without accumulating prior appendices');
});

test('grouping uses the signature request, even when different requests use the same image', () => {
  const first = request();
  const second = request('request-2');
  const groups = epiEvidenceGroups([record('r1', first), record('r2', first), record('r3', second)]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map(group => group.records.length), [2, 1]);
  assert.equal(epiSignatureImageHash(image), crypto.createHash('sha256').update(Buffer.from(image.split(',')[1], 'base64')).digest('hex'));
});

test('large batches and long user input paginate without dropping any item or overflowing margins', async () => {
  const batch = request('large', {
    signatureSignerName: 'João 😀 ' + 'Nome '.repeat(30), userAgent: 'Browser '.repeat(125)
  });
  const records = Array.from({ length: 100 }, (_, index) => record(`r-${String(index).padStart(3, '0')}`, batch, {
    epiName: `Equipamento ${index} ` + 'Proteção '.repeat(25),
    devolutionDate: new Date('2026-10-04T15:00:00Z')
  }));
  const result = await appendEpiEvidencePages(await basePdf(), { name: 'João 😀', epiRecords: records });
  const texts = await pageTexts(result.bytes);
  assert.ok(texts.length > 2);
  const all = texts.slice(1).join('\n');
  for (let index = 0; index < 100; index++) assert.ok(all.includes(`Equipamento ${index} `), `Item ${index} retained`);
  assert.ok(all.includes('(continuação)'));
  assert.ok(all.includes('Devolução: 04/10/2026'));
  assert.equal((all.match(/Assinatura 1 \|/g) || []).length, 1);
});

test('legacy signatures show missing evidence explicitly and remain separate from pending records', async () => {
  const source = await basePdf();
  const legacy = record('legacy', null, { signatureImageDataUrl: image, signatureSignerName: 'Legado', signedAt: null });
  const pending = record('pending', { id: 'pending', status: 'PENDING' }, { signedAt: null });
  const result = await appendEpiEvidencePages(source, { name: 'Colaborador', epiRecords: [legacy, pending] });
  const text = (await pageTexts(result.bytes))[1];
  assert.ok(text.includes('Legado'));
  assert.ok(text.includes('Não registrado (assinatura anterior)'));
  assert.ok(text.includes('IP: Não registrado'));
  assert.equal(text.includes('Capacete pending'), false);
});

test('new signed artifacts receive audit evidence and persist the exact final PDF hash', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'epi-evidence-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const source = await basePdf();
  const pdfPath = path.join(directory, 'signed.pdf');
  let rendered;
  let result;
  const input = request('new', { status: 'PENDING', signedAt: null, sourceDocumentHash: null, signedPdfHash: null, validationCode: null });
  input.collaborator = { name: 'João', cpf: 'sensitive-cpf' };
  input.records = [record('r1', null, { signedAt: null })];
  const signing = { signerName: 'João', signatureImageDataUrl: image, signedAt,
    evidence: { ipAddress: '203.0.113.7', userAgent: 'Signer Browser' }, privacyNoticeVersion: 'signature_epi_v1' };
  const artifact = await createSignedPublicPdfArtifact(input, signing, {
    savePdf: async (collaborator, options) => {
      assert.equal(options.redactCollaboratorFields, true);
      rendered = collaborator;
      result = await appendEpiEvidencePages(source, collaborator);
      await fs.writeFile(pdfPath, result.bytes);
      return { pdfPath, fileName: 'signed.pdf', sourceDocumentHash: result.sourceDocumentHash };
    }
  });
  const evidence = rendered.epiRecords[0].signatureRequest;
  assert.equal(evidence.ipAddress, signing.evidence.ipAddress);
  assert.equal(evidence.userAgent, signing.evidence.userAgent);
  assert.equal(evidence.privacyNoticeAcceptedAt, signedAt);
  assert.match(artifact.validationCode, /^[A-Za-z0-9_-]{24}$/);
  assert.equal(artifact.validationCode, evidence.validationCode);
  assert.equal(artifact.sourceDocumentHash, epiSha256(source));
  assert.equal(artifact.signatureImageHash, epiSignatureImageHash(image));
  assert.equal(artifact.signedPdfHash, epiSha256(await fs.readFile(pdfPath)));
  const text = (await pageTexts(result.bytes))[1];
  assert.ok(text.includes('Disponível na validação online'));
  assert.ok(text.includes(`SHA-256 do PDF-base da solicitação, sem anexo: ${epiSha256(source)}`));
});

test('public validation stays available after signing link expiry and exposes only validation data', async () => {
  const signed = request('signed', {
    expiresAt: new Date('2020-01-01'), collaborator: { name: 'João', cpf: 'sensitive-cpf' },
    records: [{ epiName: 'Capacete', ca: '123', quantity: 1, lendDate: signedAt, devolutionDate: null }],
    tokenHash: 'secret-token-hash', signedPdfPath: '/private/signed.pdf'
  });
  const client = { epiSignatureRequest: { findUnique: async args => {
    assert.deepEqual(args.where, { validationCode: code });
    assert.equal('tokenHash' in args.select, false);
    assert.equal('ipAddress' in args.select, false);
    return signed;
  } } };
  const payload = await publicEpiValidationPayload(code, client);
  assert.equal(payload.status, 'VALID');
  assert.equal(payload.finalDocumentHash, signed.signedPdfHash);
  assert.equal(payload.epi.collaboratorName, 'João');
  const serialized = JSON.stringify(payload);
  for (const value of ['sensitive-cpf', 'secret-token-hash', '/private/', '203.0.113', 'Test Browser']) {
    assert.equal(serialized.includes(value), false);
  }
  assert.deepEqual(await publicEpiValidationPayload('bad', client), { status: 'INVALID' });
  assert.deepEqual(await publicEpiValidationPayload(code, { epiSignatureRequest: { findUnique: async () => null } }), { status: 'INVALID' });
  for (const overrides of [{ status: 'PENDING' }, { signedPdfHash: null }, { records: [] }]) {
    assert.deepEqual(await publicEpiValidationPayload(code, { epiSignatureRequest: { findUnique: async () => ({ ...signed, ...overrides }) } }), { status: 'UNAVAILABLE' });
  }
});

test('signature confirmation rejects source changes during PDF generation before persisting evidence', async () => {
  const before = request('pending', { status: 'PENDING', signedAt: null, expiresAt: new Date(Date.now() + 60_000),
    collaborator: { id: 'c1', name: 'João' }, records: [record('r1', null, { signedAt: null })] });
  const after = { ...before, records: [{ ...before.records[0], updatedAt: new Date() }] };
  let updated = false;
  const client = {
    epiSignatureRequest: { findUnique: async () => before },
    $transaction: async callback => callback({
      epiSignatureRequest: { findUnique: async () => after },
      epiRecord: { updateMany: async () => { updated = true; return { count: 1 }; } }
    })
  };
  await assert.rejects(() => confirmPublicEpiSignatureRequest({
    token: 'token', client, body: { signerName: 'João', signatureImageDataUrl: image,
      privacyNoticeAccepted: true, privacyNoticeVersion: 'signature_epi_v1' },
    pdfArtifactFactory: async () => ({ signedPdfHash: 'hash' })
  }), error => error.statusCode === 409 && /alterada/.test(error.message));
  assert.equal(updated, false);
});

test('evidence migration preserves legacy artifacts and prevents duplicate verification codes', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec('CREATE TABLE "EpiSignatureRequest" ("id" TEXT PRIMARY KEY, "signedPdfHash" TEXT)');
  await db.exec("INSERT INTO \"EpiSignatureRequest\" VALUES ('legacy', 'preserved')");
  await db.exec(await fs.readFile(new URL('../prisma/migrations/20261005120000_epi_signature_evidence/migration.sql', import.meta.url), 'utf8'));
  const { rows } = await db.query('SELECT * FROM "EpiSignatureRequest"');
  assert.equal(rows[0].signedPdfHash, 'preserved');
  assert.equal(rows[0].validationCode, null);
  assert.equal(rows[0].sourceDocumentHash, null);
  await db.query('INSERT INTO "EpiSignatureRequest" ("id", "validationCode") VALUES ($1, $2)', ['new', code]);
  await assert.rejects(() => db.query('INSERT INTO "EpiSignatureRequest" ("id", "validationCode") VALUES ($1, $2)', ['duplicate', code]), /unique constraint/);
});
