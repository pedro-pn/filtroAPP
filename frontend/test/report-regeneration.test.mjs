import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

async function loadModule() {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true }, appType: 'custom' });
  try { return await server.ssrLoadModule('/src/utils/reportRegeneration.ts'); }
  finally { await server.close(); }
}

test('bulk regeneration processes all selected reports once, reports progress and continues after failures', async () => {
  const { regenerateSelectedReports, reportRegenerationMessage } = await loadModule();
  const calls = [];
  const progress = [];
  let active = false;
  const result = await regenerateSelectedReports(['a', 'b', 'a', 'c'], async id => {
    assert.equal(active, false, 'PDF conversions must run sequentially');
    active = true;
    await Promise.resolve();
    calls.push(id);
    active = false;
    if (id === 'b') throw new Error('Relatório assinado.');
  }, (completed, total) => progress.push([completed, total]));
  assert.deepEqual(calls, ['a', 'b', 'c']);
  assert.deepEqual(result.savedIds, ['a', 'c']);
  assert.deepEqual(result.errors, [{ id: 'b', message: 'Relatório assinado.' }]);
  assert.deepEqual(progress, [[0, 3], [1, 3], [2, 3], [3, 3]]);
  assert.match(reportRegenerationMessage(result), /2 relatórios reemitidos.*1 não reemitido.*Relatório assinado/);
});

test('individual regeneration is available for generated reports without registered signatures', async () => {
  const { canRegenerateReport } = await loadModule();
  assert.equal(canRegenerateReport({ status: 'PENDING' }), true);
  assert.equal(canRegenerateReport({ status: 'APPROVED', reportSignatures: [{ status: 'PENDING' }] }), true);
  assert.equal(canRegenerateReport({ status: 'SIGNED' }), false);
  assert.equal(canRegenerateReport({ status: 'APPROVED', physicalSignedAt: '2026-10-05' }), false);
  assert.equal(canRegenerateReport({ status: 'APPROVED', reportSignatures: [{ status: 'SIGNED' }] }), false);
  assert.equal(canRegenerateReport({ status: 'APPROVED', specialConditions: { __manualUpload: { uploadedAt: '2026-10-05' } } }), false);
});
