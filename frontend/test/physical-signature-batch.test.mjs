import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
  server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' });
const batch = await server.ssrLoadModule('/src/pages/gestor/physicalSignatureBatch.ts');
await server.close();

function report(id, code = '5724', sequenceNumber = 12, reportDate = '2026-10-01') {
  return { id, projectId: `project-${code}`, project: { code, name: 'Projeto' },
    reportType: 'RDO', status: 'APPROVED', sequenceNumber, reportDate };
}

function entry(id, target, overrides = {}) {
  return { id, file: { name: `${id}.pdf`, size: 100 }, projectId: target.projectId,
    reportId: target.id, status: 'pending', suggested: false, ...overrides };
}

test('standard, underscored, ISO and legacy RDO filenames identify the correct mission and report', () => {
  const reports = [report('a'), report('b', '5807'), report('c', '5724', 13)];
  for (const fileName of [
    'Missão 5724 Cliente - RDO 12 - 01-10-2026 - quinta-feira assinado.pdf',
    'Missao_5724_RDO_012_2026-10-01.pdf',
    'Projeto 5724 - RDO Nº 012 - 1.10.2026.pdf',
    'Missão 5724 - RDO-012.pdf'
  ]) assert.deepEqual(batch.suggestPhysicalSignatureReport(fileName, reports, 'project-5724'), { projectId: 'project-5724', reportId: 'a' });
});

test('the selected project disambiguates equal RDO numbers across projects', () => {
  const reports = [report('a'), report('b', '5807'), report('c', '5724', 13)];
  assert.deepEqual(batch.suggestPhysicalSignatureReport('RDO 12.pdf', reports, 'project-5724'), { projectId: 'project-5724', reportId: 'a' });
  assert.deepEqual(batch.suggestPhysicalSignatureReport('RDO 12.pdf', reports, 'project-5807'), { projectId: 'project-5807', reportId: 'b' });
  assert.equal(batch.suggestPhysicalSignatureReport('assinado 01-10-2026.pdf', reports, 'project-5724').reportId, '');
  assert.equal(batch.suggestPhysicalSignatureReport('RDO 12.pdf', reports, '').reportId, '');
});

test('date disambiguates numbers and conflicting or unknown mission metadata never falls back', () => {
  const reports = [report('a'), report('b', '5724', 12, '2026-10-02'), report('c', '5807', 14)];
  assert.equal(batch.suggestPhysicalSignatureReport('RDO 12 - 02-10-2026.pdf', reports, 'project-5724').reportId, 'b');
  for (const name of ['Missão 9999 - RDO 12.pdf', 'Missão 5807 - RDO 12.pdf', 'RDO 14.pdf', 'documento.pdf']) {
    assert.equal(batch.suggestPhysicalSignatureReport(name, reports, 'project-5724').reportId, '');
  }
});

test('service filenames and already signed, unapproved or deleted RDOs are never suggested', () => {
  const target = report('a');
  for (const name of ['RTP 12 - 01-10-2026.pdf', 'RLQ Nº 12 - 01-10-2026.pdf', 'RCPU_12_01-10-2026.pdf']) {
    assert.equal(batch.suggestPhysicalSignatureReport(name, [target], target.projectId).reportId, '');
  }
  for (const patch of [{ status: 'SIGNED' }, { status: 'PENDING' }, { reportType: 'RLQ' },
    { physicalSignedAt: '2026-10-03' }, { deletedAt: '2026-10-03' },
    { project: { ...target.project, deletedAt: '2026-10-03' } }, { reportSignatures: [{ status: 'SIGNED' }] },
    { specialConditions: { __clientRejectedAt: '2026-10-03' } }]) {
    assert.equal(batch.suggestPhysicalSignatureReport('RDO 12.pdf', [{ ...target, ...patch }], target.projectId).reportId, '');
  }
  assert.equal(batch.canReceivePhysicalSignature({ ...target,
    specialConditions: { __clientRejectedAt: '2026-10-03', __clientRejectionResolvedAt: '2026-10-04' } }), true);
});

test('PDF validation rejects non-PDF, empty and oversize files while allowing the 50 MB limit', () => {
  assert.equal(batch.validatePhysicalSignatureFile({ name: 'RDO.PDF', size: 50 * 1024 * 1024 }), '');
  for (const file of [{ name: 'foto.png', size: 100 }, { name: 'rdo.pdf', size: 0 }, { name: 'rdo.pdf', size: 50 * 1024 * 1024 + 1 }]) {
    assert.ok(batch.validatePhysicalSignatureFile(file));
  }
});

test('validation prevents missing targets, cross-project assignments and duplicate RDOs including saved files', () => {
  const a = report('a');
  const b = report('b', '5807');
  const files = [entry('one', a), entry('two', a), entry('three', b, { reportId: '' }), entry('four', a, { projectId: b.projectId })];
  const errors = batch.physicalSignatureBatchErrors(files, [a, b], a.projectId);
  assert.equal(Object.keys(errors).length, 4);
  assert.match(errors.one, /outro arquivo/);
  assert.match(errors.four, /Selecione/);
  files[0].status = 'success';
  assert.equal(batch.physicalSignatureBatchErrors(files, [a, b], a.projectId).one, undefined);
  assert.match(batch.physicalSignatureBatchErrors(files, [a, b], a.projectId).two, /outro arquivo/);
});

test('batch validates all associations before any file read or request', async () => {
  const a = report('a');
  await assert.rejects(batch.uploadPhysicalSignatureBatch([entry('one', a), entry('two', a)], [a], a.projectId,
    async () => assert.fail('must not upload'), () => {}, async () => assert.fail('must not read')), /Revise/);
});

test('a batch cannot send a file to a different project, even when that RDO is in the candidate data', async () => {
  const a = report('a');
  const b = report('b', '5807');
  await assert.rejects(batch.uploadPhysicalSignatureBatch([entry('one', a), entry('two', b)], [a, b], a.projectId,
    async () => assert.fail('must not upload'), () => {}, async () => assert.fail('must not read')), /Revise/);
});

test('batch sends one file at a time, continues after failures and retries only unsuccessful files', async () => {
  const reports = [report('a'), report('b', '5724', 13), report('c', '5724', 14)];
  const files = reports.map((target, i) => entry(String(i), target));
  const calls = [];
  const updates = [];
  const update = (id, patch) => { updates.push([id, patch.status]); Object.assign(files.find(file => file.id === id), patch); };
  let active = false;
  const upload = async payload => {
    assert.equal(active, false);
    active = true;
    await Promise.resolve();
    calls.push(payload);
    active = false;
    if (payload.id === 'b') throw new Error('Falha de conexão');
  };
  assert.deepEqual(await batch.uploadPhysicalSignatureBatch(files, reports, reports[0].projectId, upload, update, async file => `data:${file.name}`), { saved: 2, failed: 1 });
  assert.deepEqual(calls.map(call => call.id), ['a', 'b', 'c']);
  assert.deepEqual(calls[0], { id: 'a', fileName: '0.pdf', pdfDataUrl: 'data:0.pdf' });
  assert.deepEqual(updates, [['0', 'uploading'], ['0', 'success'], ['1', 'uploading'], ['1', 'error'], ['2', 'uploading'], ['2', 'success']]);
  assert.equal(files[1].error, 'Falha de conexão');
  assert.deepEqual(await batch.uploadPhysicalSignatureBatch(files, reports, reports[0].projectId, async payload => { calls.push(payload); }, update, async () => 'data:retry'), { saved: 1, failed: 0 });
  assert.deepEqual(calls.map(call => call.id), ['a', 'b', 'c', 'b']);
  assert.equal(files[1].error, undefined);
});

test('file read failures are shown for the file and do not prevent subsequent uploads', async () => {
  const reports = [report('a'), report('b', '5724', 13)];
  const files = reports.map((target, i) => entry(String(i), target));
  const uploaded = [];
  const updated = [];
  const result = await batch.uploadPhysicalSignatureBatch(files, reports, reports[0].projectId, async payload => { uploaded.push(payload.id); },
    (id, patch) => updated.push({ id, ...patch }), async file => { if (file.name === '0.pdf') throw new Error('Leitura falhou'); return 'data:pdf'; });
  assert.deepEqual(result, { saved: 1, failed: 1 });
  assert.deepEqual(uploaded, ['b']);
  assert.ok(updated.some(update => update.id === '0' && update.error === 'Leitura falhou'));
});
