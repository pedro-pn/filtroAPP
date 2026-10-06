import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildReportFileName } from '../src/lib/report-filename.js';
import { assertReportCanRegenerate, createReportRegenerator } from '../src/lib/reports/regeneration.js';

function report(overrides = {}) {
  return {
    id: 'report-1', reportType: 'RDO', status: 'PENDING', sequenceNumber: 1,
    reportDate: '2026-10-05', updatedAt: new Date('2026-10-05T12:00:00Z'),
    project: { code: 'P-100', name: 'Nome atualizado' },
    versions: [], reportSignatures: [], ...overrides
  };
}

async function fixture(t, initial = report(), options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'report-regeneration-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const canonical = path.join(root, buildReportFileName(initial, 'pdf'));
  await fs.writeFile(canonical, 'PDF anterior');
  const updates = [];
  let current = initial;
  const tx = {
    $queryRawUnsafe: async (_query, id) => assert.equal(id, initial.id),
    report: { findUniqueOrThrow: async () => current },
    reportVersion: { update: async args => updates.push(['version', args]) },
    reportSignature: { updateMany: async args => updates.push(['signatures', args]) }
  };
  const regenerate = createReportRegenerator({
    database: { report: { findUniqueOrThrow: async () => initial }, $transaction: async callback => callback(tx) },
    include: {}, isUnavailable: item => Boolean(item.deletedAt || item.project?.deletedAt),
    generatePdf: async item => {
      options.onGenerate?.(item);
      if (options.generateError) throw options.generateError;
      const fileName = buildReportFileName(item, 'pdf');
      assert.notEqual(fileName, path.basename(canonical));
      const targetPath = path.join(root, fileName);
      await fs.writeFile(targetPath, `PDF ${item.project.name}`);
      await fs.writeFile(targetPath.replace(/\.pdf$/, '.docx'), `DOCX ${item.project.name}`);
      current = options.currentAfterGenerate || initial;
      return { targetPath, fileName, publicUrl: `/relatorios/${encodeURIComponent(fileName)}` };
    },
    writeMetadata: async (file, item) => fs.writeFile(`${file}.meta.json`, JSON.stringify({ reportId: item.id })),
    pdfTarget: () => ({ targetPath: canonical }),
    replaceSignatureRound: options.replaceSignatureRound || (async () => null),
    notifySignatureRound: options.notifySignatureRound || (async () => ({ ok: true }))
  });
  return { regenerate, canonical, root, updates };
}

test('regeneration replaces pending PDF and DOCX with the current project name without changing status', async t => {
  const initial = report();
  const { regenerate, canonical, root, updates } = await fixture(t, initial);
  assert.deepEqual(await regenerate(initial.id), { id: initial.id });
  assert.equal(await fs.readFile(canonical, 'utf8'), 'PDF Nome atualizado');
  assert.equal(await fs.readFile(canonical.replace(/\.pdf$/, '.docx'), 'utf8'), 'DOCX Nome atualizado');
  assert.equal(initial.status, 'PENDING');
  assert.equal((await fs.readdir(root)).length, 3);
  assert.deepEqual(updates, []);
});

test('regeneration replaces the unsigned signature round before notifying new signers', async t => {
  const initial = report({ status: 'APPROVED', versions: [{ id: 'version-1', status: 'ACTIVE' }] });
  const calls = [];
  const { regenerate, canonical, root } = await fixture(t, initial, {
    replaceSignatureRound: async (_tx, current, saved, hash, context) => {
      assert.equal(current.versions[0].id, 'version-1');
      assert.equal(context.userId, 'admin-1');
      calls.push(['replace', saved.publicUrl, hash]);
      return { tokens: ['new-token'] };
    },
    notifySignatureRound: async round => {
      assert.deepEqual(round.tokens, ['new-token']);
      calls.push(['notify']);
      return { ok: true };
    }
  });
  await regenerate(initial.id, { userId: 'admin-1' });
  assert.equal(await fs.readFile(canonical, 'utf8'), 'PDF anterior');
  const generatedFile = (await fs.readdir(root)).find(file => file.endsWith('.pdf') && file !== path.basename(canonical));
  const expectedHash = createHash('sha256').update(await fs.readFile(path.join(root, generatedFile))).digest('hex');
  assert.deepEqual(calls, [['replace', `/relatorios/${encodeURIComponent(generatedFile)}`, expectedHash], ['notify']]);
});

test('email delivery failure reports a warning without undoing a successful reissue', async t => {
  const { regenerate } = await fixture(t, report(), {
    replaceSignatureRound: async () => ({ tokens: ['new-token'] }),
    notifySignatureRound: async () => ({ ok: false })
  });
  const response = await regenerate('report-1');
  assert.equal(response.id, 'report-1');
  assert.match(response.warning, /não foi possível enviar os novos links/);
});

test('regeneration rejects signed, manual and external-signature documents before rendering', async t => {
  for (const overrides of [
    { status: 'SIGNED' }, { physicalSignedAt: new Date() },
    { reportSignatures: [{ status: 'SIGNED' }] }, { versions: [{ finalPdfUrl: '/signed.pdf' }] },
    { specialConditions: { __manualUpload: { uploadedAt: '2026-10-05' } } },
    { zapsignDocToken: 'external-token' }
  ]) {
    const initial = report(overrides);
    assert.throws(() => assertReportCanRegenerate(initial), { statusCode: 409 });
    const { regenerate } = await fixture(t, initial, { onGenerate: () => assert.fail('must reject before rendering') });
    await assert.rejects(regenerate(initial.id), { statusCode: 409 });
  }
});

test('a signature or content change during conversion preserves the previous PDF and removes generated files', async t => {
  for (const currentAfterGenerate of [
    report({ reportSignatures: [{ status: 'SIGNED' }] }),
    report({ updatedAt: new Date('2026-10-05T13:00:00Z') }),
    report({ project: { code: 'P-100', name: 'Outra alteração' } })
  ]) {
    const { regenerate, canonical, root, updates } = await fixture(t, report(), { currentAfterGenerate });
    await assert.rejects(regenerate('report-1'), { statusCode: 409 });
    assert.equal(await fs.readFile(canonical, 'utf8'), 'PDF anterior');
    assert.deepEqual(await fs.readdir(root), [path.basename(canonical)]);
    assert.deepEqual(updates, []);
  }
});

test('failed conversion leaves the previous PDF intact and releases the generation lock', async t => {
  const { regenerate, canonical } = await fixture(t, report(), { generateError: new Error('conversion failed') });
  await assert.rejects(regenerate('report-1'), /conversion failed/);
  await assert.rejects(regenerate('report-1'), /conversion failed/);
  assert.equal(await fs.readFile(canonical, 'utf8'), 'PDF anterior');
});

test('reissue cancels the old signature tokens and creates a new active version and signature links', async () => {
  const { recreateReportSignatureRound } = await import('../src/routes/resources/report-regeneration-routes.js');
  const oldSignature = { id: 'old-signature', status: 'PENDING', tokenHash: 'old-token', signerEmail: 'client@example.com' };
  const oldVersion = { id: 'old-version', versionNumber: 1, status: 'ACTIVE', signatures: [oldSignature] };
  const versions = [oldVersion];
  const audit = [];
  const tx = {
    $queryRawUnsafe: async () => [],
    reportVersion: {
      findFirst: async () => versions.find(item => item.status === 'ACTIVE') || null,
      aggregate: async () => ({ _max: { versionNumber: 1 } }),
      update: async ({ where, data }) => Object.assign(versions.find(item => item.id === where.id), data),
      create: async ({ data }) => {
        const version = { ...data, id: 'new-version', status: 'ACTIVE', signatures: data.signatures.create.map(signature => ({ ...signature, id: 'new-signature' })) };
        versions.push(version);
        return version;
      }
    },
    reportSignature: {
      updateMany: async ({ where, data }) => {
        assert.equal(where.versionId, 'old-version');
        Object.assign(oldSignature, data);
        return { count: 1 };
      },
      update: async ({ where, data }) => {
        assert.equal(where.id, 'new-signature');
        Object.assign(versions[1].signatures[0], data);
      }
    },
    reportAuditLog: { create: async ({ data }) => audit.push(data) }
  };
  const initial = report({ status: 'APPROVED', project: { code: 'P-100', name: 'Atualizado', clientEmailPrimary: 'client@example.com' } });
  const round = await recreateReportSignatureRound(tx, initial, { publicUrl: '/relatorios/new.pdf' }, 'new-pdf-hash', { userId: 'admin-1', evidence: {} }, item => item.status === 'APPROVED');
  assert.equal(oldVersion.status, 'SUPERSEDED');
  assert.equal(oldSignature.status, 'INVALIDATED');
  assert.ok(oldSignature.invalidatedAt);
  assert.equal(versions[1].versionNumber, 2);
  assert.equal(versions[1].sourcePdfUrl, '/relatorios/new.pdf');
  assert.equal(versions[1].sourceDocumentHash, 'new-pdf-hash');
  assert.equal(round.tokens.length, 1);
  assert.equal(round.tokens[0].signatureId, 'new-signature');
  assert.ok(versions[1].signatures[0].tokenHash);
  assert.notEqual(versions[1].signatures[0].tokenHash, oldSignature.tokenHash);
  assert.deepEqual(audit.map(item => item.action), ['SIGNATURES_INVALIDATED', 'VERSION_CREATED', 'SIGNATURE_ROUND_CREATED']);
});
