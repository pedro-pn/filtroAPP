import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

// Upload manual de RDO em multipart (spec 042, D3): a camada da API converte o
// data URL que as telas guardam em arquivo e manda os campos como JSON.

async function loadReportsApi(t) {
  const server = await createServer({ configFile: false, root: new URL('..', import.meta.url).pathname,
    server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
  t.after(() => server.close());
  return server.ssrLoadModule('/src/api/reports.ts');
}

test('data URL do PDF vira Blob com os mesmos bytes', async t => {
  const { pdfDataUrlToBlob } = await loadReportsApi(t);
  const bytes = Buffer.from('%PDF-1.7 conteúdo');
  const blob = pdfDataUrlToBlob(`data:application/pdf;base64,${bytes.toString('base64')}`);
  assert.equal(blob.type, 'application/pdf');
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), bytes);
  assert.throws(() => pdfDataUrlToBlob('não é data url'), /PDF inválido/);
});

test('formulário leva os campos em payload (JSON) e o PDF na parte pdf, sem base64', async t => {
  const { manualReportFormData } = await loadReportsApi(t);
  const pdf = Buffer.from('%PDF-1.4 x');
  const form = manualReportFormData({ projectId: 'p1', reportDate: '2026-11-17', operationalData: { collaboratorIds: ['a'] } },
    `data:application/pdf;base64,${pdf.toString('base64')}`, 'rdo-17.pdf');
  assert.deepEqual(JSON.parse(form.get('payload')), { projectId: 'p1', reportDate: '2026-11-17', operationalData: { collaboratorIds: ['a'] } });
  const file = form.get('pdf');
  assert.equal(file.name, 'rdo-17.pdf');
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), pdf);
  assert.ok(!form.get('payload').includes('base64'));

  const metadataOnly = manualReportFormData({ fileName: 'x.pdf' });
  assert.equal(metadataOnly.get('pdf'), null);
});
