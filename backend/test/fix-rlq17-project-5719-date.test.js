import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CORRECT_DATE, OLD_DATE, SOURCE_SHA256, parseArgs, runCorrection } from '../scripts/fix-rlq17-project-5719-date.js';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rlq17-date-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const original = Buffer.from('%PDF-1.7\nDocumento sintético para teste');
  const signed = Buffer.from('%PDF-1.7\nDocumento sintético assinado');
  await writeFile(path.join(dir, 'original.pdf'), original);
  await writeFile(path.join(dir, 'assinado.pdf'), signed);
  const state = {
    project: { id: 'production-project-id', code: '5719', name: 'Ilha Solteira', deletedAt: null },
    report: {
      id: 'production-report-id', projectId: 'production-project-id', reportType: 'RLQ', sequenceNumber: 17,
      reportDate: new Date(OLD_DATE), updatedAt: new Date('2026-06-22T14:04:48.294Z'), deletedAt: null,
      status: 'SIGNED', specialConditions: { source: 'MANUAL_UPLOAD', serviceOnly: true },
      services: [], attachments: [], auditLogs: [], collaborators: [],
      versions: [{ id: 'version-1', status: 'ACTIVE', sourcePdfUrl: 'original.pdf', finalPdfUrl: 'assinado.pdf', sourceDocumentHash: sha(original), finalDocumentHash: sha(signed) }],
      reportSignatures: [{ id: 'signature-1', versionId: 'version-1', status: 'SIGNED', signerName: 'Sigilo', tokenEncrypted: 'nao-exportar-este-token', signatureImageDataUrl: 'nao-exportar-esta-imagem' }]
    },
    transactions: 0, writes: 0, committed: false, log: []
  };
  const models = {
    project: { findUnique: async ({ where }) => { assert.deepEqual(where, { code: '5719' }); return structuredClone(state.project); } },
    report: {
      findUnique: async ({ where }) => {
        assert.deepEqual(where.projectId_reportType_sequenceNumber, { projectId: state.project.id, reportType: 'RLQ', sequenceNumber: 17 });
        return structuredClone(state.report);
      },
      updateMany: async ({ where, data }) => {
        state.writes++;
        assert.deepEqual(data, { reportDate: new Date(CORRECT_DATE) });
        if (state.updateCountZero || !Object.entries(where).every(([key, value]) => JSON.stringify(state.report[key]) === JSON.stringify(value))) return { count: 0 };
        state.report.reportDate = data.reportDate;
        state.report.updatedAt = new Date('2026-09-14T15:00:00Z');
        state.afterUpdate?.();
        return { count: 1 };
      }
    }
  };
  const client = {
    ...models,
    $transaction: async (callback, options) => {
      state.transactions++;
      assert.equal(options.isolationLevel, 'Serializable');
      state.beforeTransaction?.();
      const previous = structuredClone(state.report);
      try {
        const result = await callback(models);
        state.committed = true;
        state.afterCommit?.();
        return result;
      } catch (error) { state.report = previous; throw error; }
    }
  };
  const options = { client, reportsDir: dir, expectedSourceSha256: sha(original), log: text => state.log.push(text) };
  return { dir, state, options };
}

test('CLI simula por padrão e exige modos/argumentos explícitos', () => {
  assert.deepEqual(parseArgs([]), { apply: false, help: false });
  assert.equal(parseArgs(['--dry-run']).apply, false);
  assert.equal(parseArgs(['--apply']).apply, true);
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['--backup-dir=/data/auditoria']).backupDir, '/data/auditoria');
  for (const args of [['--apply', '--dry-run'], ['--apply', '--apply'], ['--force'], ['--expected-source-sha=outro'], ['--backup-dir=relativo']]) {
    assert.throws(() => parseArgs(args));
  }
});

test('dry-run não altera o banco nem cria arquivos de auditoria', async t => {
  const { dir, state, options } = await fixture(t);
  const before = structuredClone(state.report);
  const result = await runCorrection(options);
  assert.equal(result.status, 'READY');
  assert.equal(state.transactions, 0);
  assert.equal(state.writes, 0);
  assert.deepEqual(state.report, before);
  assert.deepEqual((await readdir(dir)).sort(), ['assinado.pdf', 'original.pdf']);
});

test('apply corrige somente reportDate/updatedAt, preserva PDFs/assinaturas e é idempotente', async t => {
  const { state, options } = await fixture(t);
  const original = structuredClone(state.report);
  const result = await runCorrection({ ...options, apply: true });
  assert.equal(result.status, 'CORRECTED');
  assert.equal(result.updatedRecords, 1);
  assert.equal(state.report.reportDate.toISOString(), CORRECT_DATE);
  assert.deepEqual(state.report, { ...original, reportDate: new Date(CORRECT_DATE), updatedAt: state.report.updatedAt });
  assert.equal(result.after.integrityHash, result.before.integrityHash);
  assert.deepEqual(result.after.files, result.before.files);
  const receiptText = await readFile(path.join(result.receiptDir, 'result.json'), 'utf8');
  assert.equal(JSON.parse(receiptText).state, 'COMMITTED_VERIFIED');
  assert.equal(JSON.parse(await readFile(path.join(result.receiptDir, 'before.json'), 'utf8')).before.reportDate, OLD_DATE);
  for (const secret of ['Sigilo', 'nao-exportar-este-token', 'nao-exportar-esta-imagem']) {
    assert.ok(!receiptText.includes(secret));
    assert.ok(!state.log.join('\n').includes(secret));
  }
  assert.equal((await runCorrection({ ...options, apply: true })).status, 'ALREADY_CORRECT');
  assert.equal(state.transactions, 1);
  assert.equal(state.writes, 1);
});

test('recusa identidade, data, origem, serviços ou assinatura incompatíveis antes de gravar', async t => {
  const cases = [
    ['projeto ausente', state => { state.project = null; }],
    ['projeto diferente', state => { state.project.name = 'Outro projeto'; }],
    ['projeto excluído', state => { state.project.deletedAt = new Date(); }],
    ['relatório ausente', state => { state.report = null; }],
    ['relatório excluído', state => { state.report.deletedAt = new Date(); }],
    ['data inesperada', state => { state.report.reportDate = new Date('2026-04-02'); }],
    ['relatório nativo', state => { state.report.specialConditions.source = 'NATIVE'; }],
    ['derivado de RDO', state => { state.report.specialConditions.parentRdoId = 'rdo'; }],
    ['serviços existentes', state => { state.report.services.push({ id: 'service' }); }],
    ['não assinado', state => { state.report.status = 'APPROVED'; }],
    ['assinatura ausente', state => { state.report.reportSignatures = []; }],
    ['PDF assinado ausente', state => { state.report.versions[0].finalPdfUrl = null; }],
    ['duas versões ativas', state => { state.report.versions.push({ ...state.report.versions[0], id: 'version-2' }); }]
  ];
  for (const [name, mutate] of cases) await t.test(name, async subtest => {
    const { state, options } = await fixture(subtest);
    mutate(state);
    await assert.rejects(runCorrection({ ...options, apply: true }));
    assert.equal(state.writes, 0);
    assert.equal(state.transactions, 0);
  });
});

test('exige o PDF original conferido; não basta número/data coincidirem', async t => {
  const { state, options } = await fixture(t);
  await assert.rejects(runCorrection({ ...options, apply: true, expectedSourceSha256: SOURCE_SHA256 }), /SHA-256 divergente/);
  assert.equal(state.writes, 0);
});

test('PDF alterado ou indisponível impede gravações', async t => {
  const { dir, state, options } = await fixture(t);
  await writeFile(path.join(dir, 'assinado.pdf'), 'PDF adulterado');
  await assert.rejects(runCorrection({ ...options, apply: true }), /Hash do PDF diverge/);
  await rm(path.join(dir, 'original.pdf'));
  await assert.rejects(runCorrection({ ...options, apply: true }), /ENOENT/);
  assert.equal(state.writes, 0);
});

test('não lê PDFs fora de REPORTS_DIR, incluindo links simbólicos', async t => {
  const { dir, state, options } = await fixture(t);
  state.report.versions[0].sourcePdfUrl = '../outro.pdf';
  await assert.rejects(runCorrection(options), /fora de REPORTS_DIR/);
  state.report.versions[0].sourcePdfUrl = '/outro.pdf';
  await assert.rejects(runCorrection(options), /PDF local relativo/);
  await symlink(os.tmpdir(), path.join(dir, 'externo.pdf'));
  state.report.versions[0].sourcePdfUrl = 'externo.pdf';
  await assert.rejects(runCorrection(options), /fora de REPORTS_DIR/);
  assert.equal(state.writes, 0);
});

test('falha na auditoria prévia impede iniciar a transação', async t => {
  const { dir, state, options } = await fixture(t);
  await assert.rejects(runCorrection({ ...options, apply: true, backupDir: path.join(dir, 'original.pdf') }));
  assert.equal(state.transactions, 0);
  assert.equal(state.writes, 0);
});

test('alteração entre a prévia e a transação aborta sem sobrescrever', async t => {
  const { state, options } = await fixture(t);
  state.beforeTransaction = () => { state.report.updatedAt = new Date('2026-09-14T14:59:00Z'); };
  await assert.rejects(runCorrection({ ...options, apply: true }), /mudaram desde a conferência/);
  assert.equal(state.report.reportDate.toISOString(), OLD_DATE);
  assert.equal(state.writes, 0);
});

test('update otimista sem correspondência aborta a transação', async t => {
  const { state, options } = await fixture(t);
  state.updateCountZero = true;
  await assert.rejects(runCorrection({ ...options, apply: true }), /concorrente/);
  assert.equal(state.committed, false);
  assert.equal(state.report.reportDate.toISOString(), OLD_DATE);
});

test('mudança em assinatura dentro da transação provoca rollback da correção', async t => {
  const { state, options } = await fixture(t);
  state.afterUpdate = () => { state.report.reportSignatures[0].signerName = 'Alterado'; };
  await assert.rejects(runCorrection({ ...options, apply: true }), /integridade falhou/);
  assert.equal(state.committed, false);
  assert.equal(state.report.reportDate.toISOString(), OLD_DATE);
  assert.equal(state.report.reportSignatures[0].signerName, 'Sigilo');
});

test('falha posterior ao commit não é apresentada como rollback', async t => {
  const { state, options } = await fixture(t);
  state.afterCommit = () => { state.report.updatedAt = new Date('2026-09-14T15:01:00Z'); };
  await assert.rejects(runCorrection({ ...options, apply: true }), /A data FOI corrigida.*--dry-run/);
  assert.equal(state.committed, true);
  assert.equal(state.report.reportDate.toISOString(), CORRECT_DATE);
});
