import assert from 'node:assert/strict';
import test from 'node:test';
import AdmZip from 'adm-zip';
import { createPublicSignatureFiles, signedReportArchive } from '../src/lib/reports/public-signature-files.js';

function fixture(id) {
  return {
    id, status: 'SIGNED', signerEmail: 'signer@example.com', signerName: 'Pessoa Responsável',
    version: { finalDocumentHash: 'final-hash' },
    report: { id: `report-${id}`, reportType: 'RDO', sequenceNumber: Number(id), reportDate: '2026-10-26', project: { code: '5800', name: 'Projeto Exemplo' } }
  };
}

function setup(overrides = {}) {
  const messages = [];
  const loadedIds = [];
  const files = createPublicSignatureFiles({
    async loadSignature(token, id) { assert.equal(token, 'opaque-token'); loadedIds.push(id); return fixture(id); },
    async getPdfDownload(signature) { return { buffer: Buffer.from(`signed-pdf-${signature.id}`) }; },
    async mailer(message) { messages.push(message); return { accepted: [message.to] }; },
    emailsEnabled: () => true,
    ...overrides
  });
  return { files, messages, loadedIds };
}

test('signed copy email attaches a single PDF to the stored signer email', async () => {
  const { files, messages, loadedIds } = setup();
  assert.deepEqual(await files.sendSignedCopies('opaque-token', ['1']), { status: 'sent', reportCount: 1 });
  assert.deepEqual(loadedIds, ['1']);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].to, 'signer@example.com');
  assert.equal(messages[0].attachments.length, 1);
  const attachment = messages[0].attachments[0];
  assert.equal(attachment.contentType, 'application/pdf');
  assert.match(attachment.filename, /RDO 1.*\.pdf$/);
  assert.equal(attachment.content.toString(), 'signed-pdf-1');
  assert.match(messages[0].text, /PDF assinado está anexo/);
});

test('batch copy email attaches every successful signed PDF in one ZIP and deduplicates ids', async () => {
  const { files, messages, loadedIds } = setup();
  assert.deepEqual(await files.sendSignedCopies('opaque-token', ['1', '2', '1']), { status: 'sent', reportCount: 2 });
  assert.deepEqual(loadedIds, ['1', '2']);
  const attachment = messages[0].attachments[0];
  assert.equal(attachment.contentType, 'application/zip');
  const entries = new AdmZip(attachment.content).getEntries();
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map(entry => entry.getData().toString()).sort(), ['signed-pdf-1', 'signed-pdf-2']);
  assert.match(messages[0].text, /ZIP anexo/);
});

test('email copies identify partial signatures and escape signer and project names', async () => {
  const { files, messages } = setup({
    async loadSignature() { const signature = fixture('1'); signature.version.finalDocumentHash = null; signature.declaredSignerName = '<Pessoa>'; signature.report.project.name = '<Projeto>'; return signature; }
  });
  await files.sendSignedCopies('opaque-token', ['1']);
  assert.match(messages[0].text, /aguardam outros signatários/);
  assert.match(messages[0].html, /&lt;Pessoa&gt;/);
  assert.match(messages[0].html, /&lt;Projeto&gt;/);
});

test('mail failure is reported separately from persisted signatures', async () => {
  const { files } = setup({ mailer: async () => { throw new Error('SMTP indisponível'); } });
  assert.deepEqual(await files.sendSignedCopies('opaque-token', ['1']), { status: 'failed' });
});

test('pending reports and different signers cannot be included in the copy email', async () => {
  for (const change of ['pending', 'different-email']) {
    const { files, messages } = setup({
      async loadSignature(_token, id) {
        const signature = fixture(id);
        if (id === '2' && change === 'pending') signature.status = 'PENDING';
        if (id === '2' && change === 'different-email') signature.signerEmail = 'other@example.com';
        return signature;
      }
    });
    assert.deepEqual(await files.sendSignedCopies('opaque-token', ['1', '2']), { status: 'failed' });
    assert.equal(messages.length, 0);
  }
});

test('disabled email and empty selections send nothing', async () => {
  const { files, messages, loadedIds } = setup({ emailsEnabled: () => false });
  assert.deepEqual(await files.sendSignedCopies('opaque-token', ['1']), { status: 'skipped' });
  assert.deepEqual(await setup().files.sendSignedCopies('opaque-token', []), { status: 'skipped' });
  assert.equal(messages.length, 0);
  assert.equal(loadedIds.length, 0);
});

test('archive keeps PDFs with colliding file names instead of overwriting them', () => {
  const archive = signedReportArchive([
    { fileName: 'RDO.pdf', buffer: Buffer.from('first') },
    { fileName: 'RDO.pdf', buffer: Buffer.from('second') }
  ], { code: '5800' });
  const entries = new AdmZip(archive.buffer).getEntries();
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map(entry => entry.getData().toString()).sort(), ['first', 'second']);
});
